using backend.Data;
using backend.Models;
using backend.Models.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace backend.Controllers
{
    [ApiController]
    [Route("api/teacher/lessons")]
    [Authorize(Roles = "Teacher")]
    public class TeacherLessonController : ControllerBase
    {
        private readonly AppDbContext _db;

        public TeacherLessonController(AppDbContext db)
        {
            _db = db;
        }

        private int GetUserId()
        {
            return int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        }

        private async Task<Teacher?> GetTeacherAsync()
        {
            var userId = GetUserId();
            return await _db.Teachers.FirstOrDefaultAsync(t => t.UserId == userId);
        }

        [HttpPost]
        public async Task<IActionResult> CreateDraft([FromBody] CreateLessonRequest dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.Title))
                return BadRequest("Title is required.");
            if (dto.DueDate == null)
                return BadRequest("Due date is required.");

            var teacher = await GetTeacherAsync();
            if (teacher == null)
                return Unauthorized("Teacher profile not found.");

            var lesson = new Lesson
            {
                TeacherId = teacher.Id,
                Title = dto.Title.Trim(),
                DueDate = dto.DueDate,
                Status = LessonStatus.Draft,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            _db.Lessons.Add(lesson);
            await _db.SaveChangesAsync();

            return Ok(new
            {
                lesson.Id,
                lesson.Title,
                lesson.Status,
                lesson.DueDate
            });
        }

        [HttpGet]
        public async Task<IActionResult> GetMyLessons([FromQuery] int? classId = null)
        {
            var teacher = await GetTeacherAsync();
            if (teacher == null)
                return Unauthorized("Teacher profile not found.");

            var lessons = await _db.Lessons
                .Include(l => l.Assignments)
                    .ThenInclude(a => a.Class)
                .Where(l => l.TeacherId == teacher.Id)
                .Where(l => !classId.HasValue || l.Assignments.Any(a => a.ClassId == classId.Value))
                .OrderByDescending(l => l.UpdatedAt)
                .Select(l => new
                {
                    l.Id,
                    l.Title,
                    Status = l.Status.ToString(),
                    l.DueDate,
                    l.CreatedAt,
                    l.UpdatedAt,
                    Classes = l.Assignments
                        .Select(a => new
                        {
                            a.ClassId,
                            ClassName = a.Class != null ? a.Class.Name : string.Empty
                        })
                })
                .ToListAsync();

            return Ok(lessons);
        }

        [HttpGet("{lessonId:int}")]
        public async Task<IActionResult> GetLesson(int lessonId)
        {
            var teacher = await GetTeacherAsync();
            if (teacher == null)
                return Unauthorized("Teacher profile not found.");

            var lesson = await _db.Lessons
                .Include(l => l.Questions)
                    .ThenInclude(q => q.AnswerOptions)
                .Include(l => l.Assignments)
                .FirstOrDefaultAsync(l => l.Id == lessonId && l.TeacherId == teacher.Id);

            if (lesson == null)
                return NotFound("Lesson not found.");

            return Ok(new
            {
                lesson.Id,
                lesson.Title,
                Status = lesson.Status.ToString(),
                lesson.DueDate,
                Questions = lesson.Questions
                    .OrderBy(q => q.Order)
                    .Select(q => new
                    {
                        q.Id,
                        Type = q.Type.ToString(),
                        q.Order,
                        q.ReadingSnippet,
                        q.Prompt,
                        AnswerOptions = q.AnswerOptions
                            .Select(o => new { o.Id, o.Text, o.IsCorrect })
                    }),
                AssignedClassIds = lesson.Assignments.Select(a => a.ClassId).ToList()
            });
        }

        [HttpPut("{lessonId:int}")]
        public async Task<IActionResult> UpdateLesson(int lessonId, [FromBody] UpdateLessonRequest dto)
        {
            var teacher = await GetTeacherAsync();
            if (teacher == null)
                return Unauthorized("Teacher profile not found.");

            var lesson = await _db.Lessons
                .FirstOrDefaultAsync(l => l.Id == lessonId && l.TeacherId == teacher.Id);

            if (lesson == null)
                return NotFound("Lesson not found.");

            if (!string.IsNullOrWhiteSpace(dto.Title))
                lesson.Title = dto.Title.Trim();

            if (dto.DueDate == null)
                return BadRequest("Due date is required.");

            lesson.DueDate = dto.DueDate;

            if (dto.Status.HasValue && dto.Status.Value != LessonStatus.Published)
                lesson.Status = dto.Status.Value;

            lesson.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync();

            return Ok(new
            {
                lesson.Id,
                lesson.Title,
                Status = lesson.Status.ToString(),
                lesson.DueDate
            });
        }

        [HttpPut("{lessonId:int}/questions")]
        public async Task<IActionResult> UpsertQuestions(int lessonId, [FromBody] UpsertLessonQuestionsRequest dto)
        {
            if (dto?.Questions == null || dto.Questions.Count == 0)
                return BadRequest("Questions are required.");

            var teacher = await GetTeacherAsync();
            if (teacher == null)
                return Unauthorized("Teacher profile not found.");

            var lesson = await _db.Lessons
                .Include(l => l.Questions)
                    .ThenInclude(q => q.AnswerOptions)
                .FirstOrDefaultAsync(l => l.Id == lessonId && l.TeacherId == teacher.Id);

            if (lesson == null)
                return NotFound("Lesson not found.");

            foreach (var existingQ in lesson.Questions)
            {
                _db.AnswerOptions.RemoveRange(existingQ.AnswerOptions);
            }
            _db.LessonQuestions.RemoveRange(lesson.Questions);

            var newQuestions = new List<LessonQuestion>();

            foreach (var q in dto.Questions)
            {
                if (string.IsNullOrWhiteSpace(q.Prompt))
                    return BadRequest("Every question must have a Prompt.");

                var type = q.Type;
                var order = q.Order;

                var entity = new LessonQuestion
                {
                    LessonId = lesson.Id,
                    Type = type,
                    Order = order,
                    Prompt = q.Prompt.Trim(),
                    ReadingSnippet = string.IsNullOrWhiteSpace(q.ReadingSnippet) ? null : q.ReadingSnippet.Trim()
                };

                if (type == QuestionType.Reading)
                {
                    if (string.IsNullOrWhiteSpace(entity.ReadingSnippet))
                        return BadRequest("Reading questions must include ReadingSnippet.");

                    if (q.AnswerOptions == null || q.AnswerOptions.Count < 2)
                        return BadRequest("Reading questions must have at least 2 answer options.");

                    var correctCount = q.AnswerOptions.Count(o => o.IsCorrect);
                    if (correctCount != 1)
                        return BadRequest("Each reading question must have exactly ONE correct option.");

                    foreach (var opt in q.AnswerOptions)
                    {
                        if (string.IsNullOrWhiteSpace(opt.Text))
                            return BadRequest("Answer option text cannot be empty.");

                        entity.AnswerOptions.Add(new AnswerOption
                        {
                            Text = opt.Text.Trim(),
                            IsCorrect = opt.IsCorrect
                        });
                    }
                }
                else
                {

                }

                newQuestions.Add(entity);
            }

            lesson.Questions = newQuestions;
            lesson.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync();

            return Ok(new
            {
                lesson.Id,
                QuestionsSaved = lesson.Questions.Count
            });
        }

        [HttpPost("{lessonId:int}/assign")]
        public async Task<IActionResult> AssignToClasses(int lessonId, [FromBody] AssignLessonRequest dto)
        {
            if (dto?.ClassIds == null)
                return BadRequest("ClassIds are required.");

            var teacher = await GetTeacherAsync();
            if (teacher == null)
                return Unauthorized("Teacher profile not found.");

            var lesson = await _db.Lessons
                .Include(l => l.Assignments)
                .FirstOrDefaultAsync(l => l.Id == lessonId && l.TeacherId == teacher.Id);

            if (lesson == null)
                return NotFound("Lesson not found.");

            var distinctClassIds = dto.ClassIds.Distinct().ToList();

            var ownedClassIds = await _db.Classes
                .Where(c => c.TeacherId == teacher.Id && distinctClassIds.Contains(c.Id))
                .Select(c => c.Id)
                .ToListAsync();

            if (ownedClassIds.Count != distinctClassIds.Count)
                return BadRequest("One or more class IDs are invalid or not owned by this teacher.");

            _db.LessonAssignments.RemoveRange(lesson.Assignments);

            foreach (var classId in distinctClassIds)
            {
                lesson.Assignments.Add(new LessonAssignment
                {
                    LessonId = lesson.Id,
                    ClassId = classId,
                    AssignedAt = DateTime.UtcNow
                });
            }

            lesson.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            return Ok(new
            {
                lesson.Id,
                AssignedClassIds = lesson.Assignments.Select(a => a.ClassId).ToList()
            });
        }

        [HttpPost("{lessonId:int}/publish")]
        public async Task<IActionResult> Publish(int lessonId)
        {
            var teacher = await GetTeacherAsync();
            if (teacher == null)
                return Unauthorized("Teacher profile not found.");

            var lesson = await _db.Lessons
                .Include(l => l.Questions)
                    .ThenInclude(q => q.AnswerOptions)
                .Include(l => l.Assignments)
                .FirstOrDefaultAsync(l => l.Id == lessonId && l.TeacherId == teacher.Id);

            if (lesson == null)
                return NotFound("Lesson not found.");

            if (lesson.Assignments.Count == 0)
                return BadRequest("Lesson must be assigned to at least one class before publishing.");

            var questions = lesson.Questions;

            if (questions.Count != 4)
                return BadRequest("Lesson must have exactly 4 questions (2 reading, 1 writing, 1 speaking).");

            var readingCount = questions.Count(q => q.Type == QuestionType.Reading);
            var writingCount = questions.Count(q => q.Type == QuestionType.Writing);
            var speakingCount = questions.Count(q => q.Type == QuestionType.Speaking);

            if (readingCount != 2 || writingCount != 1 || speakingCount != 1)
                return BadRequest("Lesson must have 2 Reading, 1 Writing, and 1 Speaking question.");

            foreach (var rq in questions.Where(q => q.Type == QuestionType.Reading))
            {
                if (string.IsNullOrWhiteSpace(rq.ReadingSnippet))
                    return BadRequest("Reading questions must have a snippet.");

                if (rq.AnswerOptions.Count < 2)
                    return BadRequest("Reading questions must have at least 2 answer options.");

                var correctCount = rq.AnswerOptions.Count(o => o.IsCorrect);
                if (correctCount != 1)
                    return BadRequest("Each reading question must have exactly ONE correct option.");
            }

            lesson.Status = LessonStatus.Published;
            lesson.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync();

            return Ok(new
            {
                lesson.Id,
                lesson.Title,
                Status = lesson.Status.ToString()
            });
        }
    }

}
