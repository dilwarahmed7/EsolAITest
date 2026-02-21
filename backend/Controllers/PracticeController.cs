using System.Security.Claims;
using backend.Data;
using backend.Models;
using backend.Models.DTOs;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers
{
    [ApiController]
    [Route("api/practice")]
    [Authorize]
    public class PracticeController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly ICorrectionClient _correctionClient;

        public PracticeController(AppDbContext context, ICorrectionClient correctionClient)
        {
            _context = context;
            _correctionClient = correctionClient;
        }

        [HttpGet("l1-errors")]
        public async Task<IActionResult> GetTopL1Errors()
        {
            var userId = GetUserIdFromJwt();
            if (userId == null)
                return Unauthorized();

            var student = await _context.Students
                .FirstOrDefaultAsync(s => s.UserId == userId.Value);

            if (student == null)
                return Unauthorized();

            var errors = await _context.L1ErrorTypes
                .Where(e => e.FirstLanguage == student.FirstLanguage)
                .OrderByDescending(e => e.Weight)
                .Take(5)
                .Select(e => e.ErrorType)
                .ToListAsync();

            return Ok(errors);
        }

        [HttpPost("l1-errors/start")]
        public async Task<IActionResult> StartL1Practice(
            [FromBody] StartPracticeRequest request,
            [FromServices] backend.Services.Interfaces.IQuestionGeneratorService questionGenerator)
        {
            if (string.IsNullOrWhiteSpace(request.ErrorType))
                return BadRequest("ErrorType is required.");

            var userId = GetUserIdFromJwt();
            if (userId == null)
                return Unauthorized();

            var student = await _context.Students
                .FirstOrDefaultAsync(s => s.UserId == userId.Value);

            if (student == null)
                return Unauthorized();

            var generationRequest = new QuestionGenerationRequest
            {
                ErrorType = request.ErrorType,
                FirstLanguage = student.FirstLanguage,
                Age = student.Age,
                Level = student.Level
            };

            var response = await questionGenerator.GenerateAsync(generationRequest);

            return Ok(response);
        }

        [HttpGet("personalised")]
        public async Task<IActionResult> GetPersonalisedQueue()
        {
            var userId = GetUserIdFromJwt();
            if (userId == null)
                return Unauthorized();

            var student = await _context.Students
                .FirstOrDefaultAsync(s => s.UserId == userId.Value);

            if (student == null)
                return Unauthorized();

            var unresolvedQuestionIds = await _context.StudentErrors
                .Where(se =>
                    se.StudentId == student.Id &&
                    !se.Resolved &&
                    (
                        se.QuestionResponse.LessonQuestion.Type == QuestionType.Reading ||
                        se.QuestionResponse.LessonAttempt.TeacherReviewCompleted ||
                        !se.QuestionResponse.LessonAttempt.NeedsTeacherReview
                    ))
                .Select(se => se.QuestionResponse.LessonQuestionId)
                .ToListAsync();

            if (unresolvedQuestionIds.Count == 0)
                return Ok(new List<PersonalisedErrorDto>());

            var responses = await _context.QuestionResponses
                .Include(r => r.LessonQuestion)
                    .ThenInclude(q => q.AnswerOptions)
                .Include(r => r.LessonAttempt)
                    .ThenInclude(a => a.Lesson)
                .Where(r =>
                    r.LessonAttempt.StudentId == student.Id &&
                    (
                        r.LessonQuestion.Type == QuestionType.Reading ||
                        r.LessonAttempt.TeacherReviewCompleted ||
                        !r.LessonAttempt.NeedsTeacherReview
                    ) &&
                    unresolvedQuestionIds.Contains(r.LessonQuestionId))
                .ToListAsync();

            var grouped = responses
                .GroupBy(r => r.LessonQuestionId)
                .Select(g =>
                {
                    var question = g.First().LessonQuestion;
                    var hasPerfect = question.Type == QuestionType.Reading
                        ? g.Any(x => x.IsCorrect == true)
                        : g.Any(x => (x.Score >= 10));

                    if (hasPerfect)
                        return null;

                    var firstMiss = g
                        .Where(x => question.Type == QuestionType.Reading
                            ? x.IsCorrect == false
                            : x.Score < 10)
                        .OrderBy(x => x.LessonAttempt.SubmittedAt ?? x.LessonAttempt.StartedAt)
                        .FirstOrDefault();

                    if (firstMiss == null)
                        return null;

                    return new PersonalisedErrorDto
                    {
                        QuestionId = question.Id,
                        LessonTitle = firstMiss.LessonAttempt.Lesson.Title,
                        Type = question.Type.ToString(),
                        Prompt = question.Prompt,
                        ReadingSnippet = question.ReadingSnippet,
                        AnswerOptions = question.Type == QuestionType.Reading
                            ? question.AnswerOptions.Select(o => new BasicAnswerOptionDto
                            {
                                Id = o.Id,
                                Text = o.Text
                            }).ToList()
                            : new List<BasicAnswerOptionDto>(),
                        CreatedAt = firstMiss.LessonAttempt.SubmittedAt ?? firstMiss.LessonAttempt.StartedAt
                    };
                })
                .Where(x => x != null)
                .OrderBy(x => x!.CreatedAt)
                .ToList();

            return Ok(grouped);
        }

        [HttpPost("personalised/answer")]
        public async Task<IActionResult> SubmitPersonalisedAnswer([FromBody] PersonalisedAnswerRequest request)
        {
            if (request == null || request.QuestionId <= 0)
                return BadRequest("QuestionId is required.");

            var userId = GetUserIdFromJwt();
            if (userId == null)
                return Unauthorized();

            var student = await _context.Students
                .FirstOrDefaultAsync(s => s.UserId == userId.Value);

            if (student == null)
                return Unauthorized();

            var question = await _context.LessonQuestions
                .Include(q => q.AnswerOptions)
                .FirstOrDefaultAsync(q => q.Id == request.QuestionId);

            if (question == null)
                return NotFound("Question not found.");

            var relevantResponses = await _context.QuestionResponses
                .Include(r => r.LessonAttempt)
                .Where(r =>
                    r.LessonQuestionId == question.Id &&
                    r.LessonAttempt.StudentId == student.Id &&
                    (
                        r.LessonQuestion.Type == QuestionType.Reading ||
                        r.LessonAttempt.TeacherReviewCompleted ||
                        !r.LessonAttempt.NeedsTeacherReview
                    ))
                .ToListAsync();

            if (relevantResponses.Count == 0)
                return Forbid("This question is not available for personalised practice.");

            var hasPerfect = question.Type == QuestionType.Reading
                ? relevantResponses.Any(r => r.IsCorrect == true)
                : relevantResponses.Any(r => r.Score >= 10);

            if (hasPerfect)
                return BadRequest("This question has already been mastered.");

            bool correct = false;
            int score = 0;
            string feedback = string.Empty;
            string correctedText = string.Empty;

            List<CorrectionChange> changes = new();

            if (question.Type == QuestionType.Reading)
            {
                var correctOptionId = question.AnswerOptions.FirstOrDefault(o => o.IsCorrect)?.Id;
                correct = request.SelectedOptionId != null && request.SelectedOptionId == correctOptionId;
                score = correct ? 10 : 0;
                feedback = correct ? "Correct choice!" : "Try again. Review the passage and attempt once more.";
            }
            else
            {
                var responseText = (request.ResponseText ?? string.Empty).Trim();
                if (string.IsNullOrWhiteSpace(responseText))
                    return BadRequest("ResponseText is required for this question.");

                try
                {
                    var nlp = await _correctionClient.CorrectAsync(
                        studentInput: responseText,
                        prompt: question.Prompt ?? string.Empty,
                        maxLength: 256);

                    score = Math.Clamp(nlp.Score, 0, 10);
                    correctedText = nlp.Corrected ?? string.Empty;
                    changes = nlp.Changes ?? new List<CorrectionChange>();
                    feedback = nlp.Changes != null && nlp.Changes.Count > 0
                        ? $"Errors: {nlp.NumErrors}. Provisional score: {score}/10."
                        : $"Provisional score: {score}/10.";
                    correct = score >= 10;
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[Personalised Practice] Correction failed: {ex.Message}");
                    return StatusCode(500, "Could not score this response. Please try again.");
                }
            }

            if (correct)
            {
                var errors = await _context.StudentErrors
                    .Include(se => se.QuestionResponse)
                    .Where(se =>
                        se.StudentId == student.Id &&
                        se.QuestionResponse.LessonQuestionId == question.Id &&
                        !se.Resolved)
                    .ToListAsync();

                foreach (var err in errors)
                    err.Resolved = true;

                await _context.SaveChangesAsync();
            }

            return Ok(new PersonalisedAnswerResponse
            {
                Correct = correct,
                Score = score,
                Feedback = feedback,
                CorrectedText = correctedText,
                Changes = changes
            });
        }

        private int? GetUserIdFromJwt()
        {
            var idClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

            if (string.IsNullOrWhiteSpace(idClaim))
                return null;

            return int.TryParse(idClaim, out int userId)
                ? userId
                : null;
        }
    }

}
