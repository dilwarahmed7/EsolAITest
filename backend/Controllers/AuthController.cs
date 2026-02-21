using backend.Data;
using backend.Models;
using backend.Models.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;

namespace backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AuthController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly IConfiguration _config;
        private readonly IWebHostEnvironment _env;

        public AuthController(AppDbContext db, IConfiguration config, IWebHostEnvironment env)
        {
            _db = db;
            _config = config;
            _env = env;
        }

        [HttpPost("register")]
        public async Task<IActionResult> Register(RegisterDto dto)
        {
            if (await _db.Users.AnyAsync(u => u.Email == dto.Email))
                return BadRequest("Email already in use");

            var passwordHash = BCrypt.Net.BCrypt.HashPassword(dto.Password);

            var user = new User
            {
                Email = dto.Email,
                PasswordHash = passwordHash,
                Role = dto.Role
            };

            _db.Users.Add(user);
            await _db.SaveChangesAsync();

            if (dto.Role == "Student")
            {
                if (!dto.DateOfBirth.HasValue)
                    return BadRequest("Date of birth is required for students.");

                var today = DateTime.UtcNow.Date;
                var dob = dto.DateOfBirth.Value.Date;
                if (dob > today)
                    return BadRequest("Date of birth cannot be in the future.");

                var age = today.Year - dob.Year;
                if (dob > today.AddYears(-age)) age--;
                if (age <= 0 || age > 120)
                    return BadRequest("Invalid age derived from date of birth.");

                var student = new Student
                {
                    UserId = user.Id,
                    FullName = dto.FullName,
                    Age = age,
                    FirstLanguage = dto.FirstLanguage,
                    Level = dto.Level
                };
                _db.Students.Add(student);
            }
            else if (dto.Role == "Teacher")
            {
                var teacher = new Teacher
                {
                    UserId = user.Id,
                    FullName = dto.FullName
                };
                _db.Teachers.Add(teacher);
            }
            else
            {
                return BadRequest("Invalid role specified. Must be 'Student' or 'Teacher'.");
            }

            await _db.SaveChangesAsync();
            return Ok("User registered successfully");
        }

        [HttpPost("login")]
        public async Task<IActionResult> Login(LoginDto dto)
        {
            var user = await _db.Users
                .Include(u => u.StudentProfile)
                .Include(u => u.TeacherProfile)
                .FirstOrDefaultAsync(u => u.Email == dto.Email);

            if (user?.StudentProfile != null)
            {
                await _db.Entry(user.StudentProfile)
                    .Reference(s => s.Class)
                    .LoadAsync();
            }

            if (user == null || !BCrypt.Net.BCrypt.Verify(dto.Password, user.PasswordHash))
                return Unauthorized("Invalid credentials");

            var token = GenerateJwtToken(user);

            var profile = new
            {
                fullName = user.StudentProfile?.FullName ?? user.TeacherProfile?.FullName,
                firstLanguage = user.StudentProfile?.FirstLanguage,
                age = user.StudentProfile?.Age,
                level = user.StudentProfile?.Level,
                classId = user.StudentProfile?.ClassId,
                className = user.StudentProfile?.Class?.Name
            };

            return Ok(new
            {
                token,
                role = user.Role,
                profile
            });
        }

        [HttpPost("forgot-password")]
        public async Task<IActionResult> ForgotPassword(ForgotPasswordDto dto)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            var normalised = dto.Email.Trim().ToLowerInvariant();
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Email.ToLower() == normalised);

            var token = GenerateResetToken();
            if (user != null)
            {
                user.ResetTokenHash = HashToken(token);
                user.ResetTokenExpiresAt = DateTime.UtcNow.AddHours(1);
                await _db.SaveChangesAsync();
            }

            var response = new
            {
                message = "If an account exists for that email, we have sent password reset instructions.",
                resetToken = _env.IsDevelopment() ? token : null,
                resetUrl = _env.IsDevelopment() ? $"http://localhost:3000/reset-password?token={token}" : null
            };

            return Ok(response);
        }

        [HttpPost("reset-password")]
        public async Task<IActionResult> ResetPassword(ResetPasswordDto dto)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            if (dto.NewPassword != dto.ConfirmPassword)
                return BadRequest("New password and confirmation do not match.");

            var tokenHash = HashToken(dto.Token);
            var user = await _db.Users.FirstOrDefaultAsync(u =>
                u.ResetTokenHash == tokenHash &&
                u.ResetTokenExpiresAt.HasValue &&
                u.ResetTokenExpiresAt.Value > DateTime.UtcNow);

            if (user == null)
                return BadRequest("Reset token is invalid or expired.");

            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.NewPassword);
            user.ResetTokenHash = null;
            user.ResetTokenExpiresAt = null;
            await _db.SaveChangesAsync();

            return Ok("Password reset successfully.");
        }

        [Authorize]
        [HttpGet("me")]
        public async Task<IActionResult> GetCurrentUser()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim))
                return Unauthorized("User ID missing in token.");

            if (!int.TryParse(userIdClaim, out var userId))
                return Unauthorized("Invalid user ID in token.");

            var user = await _db.Users
                .Include(u => u.StudentProfile)
                .Include(u => u.TeacherProfile)
                .FirstOrDefaultAsync(u => u.Id == userId);

            if (user?.StudentProfile != null)
            {
                await _db.Entry(user.StudentProfile)
                    .Reference(s => s.Class)
                    .LoadAsync();
            }

            if (user == null)
                return NotFound("User not found");

            var fullName = user.Role == "Teacher"
                ? user.TeacherProfile?.FullName
                : user.StudentProfile?.FullName;

            return Ok(new
            {
                fullName = fullName ?? string.Empty,
                role = user.Role,
                email = user.Email,
                age = user.StudentProfile?.Age,
                firstLanguage = user.StudentProfile?.FirstLanguage,
                level = user.StudentProfile?.Level,
                classId = user.StudentProfile?.ClassId,
                className = user.StudentProfile?.Class?.Name
            });
        }

        [Authorize]
        [HttpPut("change-password")]
        public async Task<IActionResult> ChangePassword(ChangePasswordDto dto)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            if (dto.NewPassword != dto.ConfirmPassword)
                return BadRequest("New password and confirmation do not match.");
            if (dto.NewPassword == dto.CurrentPassword)
                return BadRequest("New password cannot be the same as the current password.");

            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !int.TryParse(userIdClaim, out var userId))
                return Unauthorized("Invalid user ID in token.");

            var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
            if (user == null)
                return NotFound("User not found");

            var currentValid = BCrypt.Net.BCrypt.Verify(dto.CurrentPassword, user.PasswordHash);
            if (!currentValid)
                return BadRequest("Current password is incorrect.");

            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.NewPassword);
            await _db.SaveChangesAsync();

            return Ok("Password updated successfully.");
        }

        [Authorize]
        [HttpPut("me")]
        public async Task<IActionResult> UpdateProfile(UpdateProfileDto dto)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !int.TryParse(userIdClaim, out var userId))
                return Unauthorized("Invalid user ID in token.");

            var user = await _db.Users
                .Include(u => u.StudentProfile)
                .Include(u => u.TeacherProfile)
                .FirstOrDefaultAsync(u => u.Id == userId);

            if (user == null)
                return NotFound("User not found");

            if (user.Role == "Teacher")
            {
                if (user.TeacherProfile == null)
                    return BadRequest("Teacher profile not found.");

                user.TeacherProfile.FullName = dto.FullName;
            }
            else if (user.Role == "Student")
            {
                if (user.StudentProfile == null)
                    return BadRequest("Student profile not found.");

                user.StudentProfile.FullName = dto.FullName;
                if (dto.Age.HasValue)
                    user.StudentProfile.Age = dto.Age.Value;
                if (!string.IsNullOrWhiteSpace(dto.FirstLanguage))
                    user.StudentProfile.FirstLanguage = dto.FirstLanguage;
                if (!string.IsNullOrWhiteSpace(dto.Level))
                    user.StudentProfile.Level = dto.Level;
            }
            else
            {
                return BadRequest("Unsupported role.");
            }

            await _db.SaveChangesAsync();

            return Ok(new
            {
                fullName = dto.FullName,
                role = user.Role,
                email = user.Email
            });
        }

        private string GenerateJwtToken(User user)
        {
            var jwtKey = _config["JWT_KEY"] ?? _config["Jwt:Key"];
            if (string.IsNullOrWhiteSpace(jwtKey))
                throw new Exception("JWT_KEY / Jwt:Key is missing in configuration");

            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));
            var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

            var claims = new[]
            {
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Role, user.Role),
                new Claim(ClaimTypes.Email, user.Email)
            };

            var token = new JwtSecurityToken(
                issuer: _config["Jwt:Issuer"],
                audience: _config["Jwt:Audience"],
                claims: claims,
                expires: DateTime.UtcNow.AddDays(7),
                signingCredentials: creds
            );

            return new JwtSecurityTokenHandler().WriteToken(token);
        }

        private static string GenerateResetToken()
        {
            var bytes = RandomNumberGenerator.GetBytes(32);
            return Convert.ToBase64String(bytes)
                .TrimEnd('=')
                .Replace('+', '-')
                .Replace('/', '_');
        }

        private static string HashToken(string token)
        {
            using var sha = SHA256.Create();
            var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(token));
            return Convert.ToBase64String(bytes);
        }
    }
}
