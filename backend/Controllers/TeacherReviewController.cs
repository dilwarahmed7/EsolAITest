using backend.Data;
using backend.Models;
using backend.Models.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.Json;

namespace backend.Controllers
{
    [ApiController]
    [Route("api/teacher/reviews")]
    [Authorize(Roles = "Teacher")]
    public class TeacherReviewController : ControllerBase
    {
        private readonly AppDbContext _db;

        public TeacherReviewController(AppDbContext db)
        {
            _db = db;
        }

        private int GetUserId() => int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private async Task<Teacher?> GetTeacherAsync()
        {
            var userId = GetUserId();
            return await _db.Teachers.FirstOrDefaultAsync(t => t.UserId == userId);
        }

        [HttpGet]
        public async Task<IActionResult> GetPendingQueue()
        {
            var teacher = await GetTeacherAsync();
            if (teacher == null)
                return Unauthorized("Teacher profile not found.");

            var teacherClassIds = await _db.Classes
                .Where(c => c.TeacherId == teacher.Id)
                .Select(c => c.Id)
                .ToListAsync();

            var attempts = await _db.LessonAttempts
                .Include(a => a.Lesson)
                    .ThenInclude(l => l.Assignments)
                .Include(a => a.Student)
                .Include(a => a.Responses)
                    .ThenInclude(r => r.FeedbackReview)
                .Include(a => a.Responses)
                    .ThenInclude(r => r.LessonQuestion)
                .Where(a =>
                    a.NeedsTeacherReview &&
                    !a.TeacherReviewCompleted &&
                    a.SubmittedAt != null &&
                    a.Lesson.Assignments.Any(assign => teacherClassIds.Contains(assign.ClassId)))
                .OrderBy(a => a.SubmittedAt)
                .ToListAsync();

            var queue = attempts.Select(a => new
            {
                a.Id,
                a.LessonId,
                LessonTitle = a.Lesson.Title,
                a.SubmittedAt,
                StudentName = a.Student.FullName,
                Responses = a.Responses
                    .Where(r => r.LessonQuestion.Type == QuestionType.Writing || r.LessonQuestion.Type == QuestionType.Speaking)
                    .Select(r => new
                    {
                        QuestionResponseId = r.Id,
                        QuestionId = r.LessonQuestionId,
                        Type = r.LessonQuestion.Type.ToString(),
                        Prompt = r.LessonQuestion.Prompt,
                        StudentAnswer = r.ResponseText,
                        AiCorrections = r.FeedbackReview?.AiCorrections,
                        AiFeedback = r.FeedbackReview?.AiFeedback,
                        AiScore = r.AiScore,
                        TeacherFeedback = r.FeedbackReview?.TeacherFeedback,
                        TeacherScore = r.FeedbackReview?.TeacherScore
                    })
            }).ToList();

            return Ok(queue);
        }

        [HttpPost("{attemptId:int}/complete")]
        public async Task<IActionResult> CompleteReview(int attemptId, [FromBody] CompleteReviewRequest dto)
        {
            if (dto == null || dto.Responses == null || dto.Responses.Count == 0)
                return BadRequest("No responses to review.");

            var teacher = await GetTeacherAsync();
            if (teacher == null)
                return Unauthorized("Teacher profile not found.");

            var teacherClassIds = await _db.Classes
                .Where(c => c.TeacherId == teacher.Id)
                .Select(c => c.Id)
                .ToListAsync();

            var attempt = await _db.LessonAttempts
                .Include(a => a.Lesson)
                    .ThenInclude(l => l.Assignments)
                .Include(a => a.Responses)
                    .ThenInclude(r => r.FeedbackReview)
                .Include(a => a.Responses)
                    .ThenInclude(r => r.LessonQuestion)
                .FirstOrDefaultAsync(a => a.Id == attemptId);

            if (attempt == null)
                return NotFound("Attempt not found.");

            var isTeacherLesson = attempt.Lesson.Assignments.Any(a => teacherClassIds.Contains(a.ClassId));
            if (!isTeacherLesson)
                return Forbid("Attempt does not belong to your classes.");

            foreach (var incoming in dto.Responses)
            {
                var resp = attempt.Responses.FirstOrDefault(r => r.Id == incoming.QuestionResponseId);
                if (resp == null)
                    return BadRequest($"Invalid QuestionResponseId: {incoming.QuestionResponseId}");

                if (resp.LessonQuestion.Type != QuestionType.Writing && resp.LessonQuestion.Type != QuestionType.Speaking)
                    return BadRequest("Only writing/speaking responses can be reviewed.");

                var review = resp.FeedbackReview ?? new FeedbackReview
                {
                    QuestionResponseId = resp.Id,
                    CreatedAt = DateTime.UtcNow
                };
                if (resp.FeedbackReview == null)
                    _db.FeedbackReviews.Add(review);

                if (!string.IsNullOrWhiteSpace(incoming.CorrectedText))
                    review.AiCorrections = incoming.CorrectedText.Trim();

                if (!string.IsNullOrWhiteSpace(incoming.TeacherFeedback))
                    review.TeacherFeedback = incoming.TeacherFeedback.Trim();

                if (incoming.Changes != null)
                {
                    var baseFeedback = review.AiFeedback ?? string.Empty;
                    var markerIndex = baseFeedback.IndexOf("Changes:", StringComparison.OrdinalIgnoreCase);
                    if (markerIndex >= 0)
                        baseFeedback = baseFeedback[..markerIndex].Trim();

                    var cleaned = incoming.Changes
                        .Where(c =>
                            !string.IsNullOrWhiteSpace(c.From) ||
                            !string.IsNullOrWhiteSpace(c.To) ||
                            !string.IsNullOrWhiteSpace(c.ErrorType) ||
                            !string.IsNullOrWhiteSpace(c.MicroFeedback))
                        .ToList();

                    if (cleaned.Count > 0)
                    {
                        var changesJson = JsonSerializer.Serialize(cleaned);
                        review.AiFeedback = string.IsNullOrWhiteSpace(baseFeedback)
                            ? $"Changes: {changesJson}"
                            : $"{baseFeedback} Changes: {changesJson}";
                    }
                    else
                    {
                        review.AiFeedback = baseFeedback;
                    }
                }

                var finalScore = incoming.TeacherScore ?? resp.AiScore ?? resp.Score;
                var boundedScore = Math.Clamp(finalScore, 0, 10);
                review.TeacherScore = boundedScore;
                resp.Score = boundedScore;

                if (resp.LessonQuestion.Type == QuestionType.Writing)
                    attempt.WritingScore = boundedScore;
                else if (resp.LessonQuestion.Type == QuestionType.Speaking)
                    attempt.SpeakingScore = boundedScore;

                review.ApprovedByTeacher = true;
                review.ReviewedAt = DateTime.UtcNow;
                resp.NeedsReview = false;
                resp.FeedbackReview = review;
            }

            attempt.NeedsTeacherReview = false;
            attempt.TeacherReviewCompleted = true;
            attempt.TotalScore = attempt.ReadingScore + attempt.WritingScore + attempt.SpeakingScore;

            await _db.SaveChangesAsync();

            return Ok(new
            {
                attempt.Id,
                attempt.LessonId,
                attempt.TotalScore,
                attempt.TeacherReviewCompleted
            });
        }
    }

}
