using backend.Data;
using backend.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace backend.Controllers
{
    [ApiController]
    [Route("api/teacher/dashboard")]
    [Authorize(Roles = "Teacher")]
    public class TeacherDashboardController : ControllerBase
    {
        private readonly AppDbContext _db;

        public TeacherDashboardController(AppDbContext db)
        {
            _db = db;
        }

        private int GetUserId() => int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private async Task<Teacher?> GetTeacherAsync()
        {
            var userId = GetUserId();
            return await _db.Teachers.FirstOrDefaultAsync(t => t.UserId == userId);
        }

        [HttpGet("summary")]
        public async Task<IActionResult> GetSummary()
        {
            var teacher = await GetTeacherAsync();
            if (teacher == null)
                return Unauthorized("Teacher profile not found.");

            var classIds = await _db.Classes
                .Where(c => c.TeacherId == teacher.Id)
                .Select(c => c.Id)
                .ToListAsync();

            var activeStudents = await _db.Students
                .Where(s => s.ClassId != null && classIds.Contains(s.ClassId.Value))
                .CountAsync();

            var lessonsInProgress = await _db.Lessons
                .Where(l => l.TeacherId == teacher.Id && l.Status == LessonStatus.Published)
                .CountAsync();

            int ResolveScore(LessonAttempt attempt, QuestionType type, int fallback)
            {
                var response = attempt.Responses.FirstOrDefault(r => r.LessonQuestion.Type == type);
                if (response == null)
                    return fallback;

                if (response.FeedbackReview?.TeacherScore != null)
                    return response.FeedbackReview.TeacherScore.Value;
                if (!response.NeedsReview || attempt.TeacherReviewCompleted)
                    return response.Score;
                if (response.AiScore != null)
                    return response.AiScore.Value;

                return fallback;
            }

            var attempts = await _db.LessonAttempts
                .Where(a =>
                    a.IsRetry == false &&
                    a.SubmittedAt != null &&
                    a.Lesson.TeacherId == teacher.Id &&
                    a.Lesson.Status == LessonStatus.Published &&
                    a.Lesson.Assignments.Any(assign => classIds.Contains(assign.ClassId)))
                .Include(a => a.Responses)
                    .ThenInclude(r => r.FeedbackReview)
                .Include(a => a.Responses)
                    .ThenInclude(r => r.LessonQuestion)
                .ToListAsync();

            double avgScorePercent = 0;
            string? avgTrend = null;
            if (attempts.Count > 0)
            {
                var scored = attempts
                    .Select(attempt =>
                    {
                        var writing = ResolveScore(attempt, QuestionType.Writing, attempt.WritingScore);
                        var speaking = ResolveScore(attempt, QuestionType.Speaking, attempt.SpeakingScore);
                        return new
                        {
                            Total = (double)(attempt.ReadingScore + writing + speaking),
                            attempt.SubmittedAt
                        };
                    })
                    .Where(x => x.SubmittedAt != null)
                    .OrderByDescending(x => x.SubmittedAt)
                    .ToList();

                if (scored.Count > 0)
                {
                    var avgRaw = scored.Average(x => x.Total);
                    avgScorePercent = Math.Round((avgRaw / 22.0) * 100.0, 1);
                }

                if (scored.Count >= 2)
                {
                    var latest = scored[0];
                    var prevAvgRaw = scored.Skip(1).Average(x => x.Total);
                    var latestPct = (latest.Total / 22.0) * 100.0;
                    var prevPct = (prevAvgRaw / 22.0) * 100.0;
                    var delta = latestPct - prevPct;
                    if (Math.Abs(delta) < 0.05)
                        avgTrend = "flat";
                    else
                        avgTrend = delta > 0 ? "up" : "down";
                }
            }

            return Ok(new
            {
                ActiveStudents = activeStudents,
                LessonsInProgress = lessonsInProgress,
                AverageScorePercent = avgScorePercent,
                AverageTrend = avgTrend
            });
        }
    }
}
