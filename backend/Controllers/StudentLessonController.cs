using backend.Data;
using backend.Models;
using backend.Models.DTOs;
using backend.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.Json;

namespace backend.Controllers
{
    [ApiController]
    [Route("api/student/lessons")]
    [Authorize(Roles = "Student")]
    public class StudentLessonController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly ICorrectionClient _correctionClient;

        public StudentLessonController(AppDbContext db, ICorrectionClient correctionClient)
        {
            _db = db;
            _correctionClient = correctionClient;
        }

        private int GetUserId()
            => int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private async Task<Student?> GetStudentAsync()
        {
            var userId = GetUserId();
            return await _db.Students.FirstOrDefaultAsync(s => s.UserId == userId);
        }

        [HttpGet]
        public async Task<IActionResult> GetMyLessons()
        {
            var student = await GetStudentAsync();
            if (student == null)
                return Unauthorized("Student profile not found.");

            if (student.ClassId == null)
                return Ok(new List<object>());

            var classId = student.ClassId.Value;

            var lessons = await _db.Lessons
                .Where(l =>
                    l.Status == LessonStatus.Published &&
                    l.Assignments.Any(a => a.ClassId == classId))
                .OrderByDescending(l => l.UpdatedAt)
                .Select(l => new
                {
                    l.Id,
                    l.Title,
                    Status = l.Status.ToString(),
                    l.DueDate,
                    l.UpdatedAt
                })
                .ToListAsync();

            var lessonIds = lessons.Select(l => l.Id).ToList();

            var attempts = await _db.LessonAttempts
                .Where(a => a.StudentId == student.Id && lessonIds.Contains(a.LessonId))
                .Include(a => a.Responses)
                    .ThenInclude(r => r.LessonQuestion)
                .Include(a => a.Responses)
                    .ThenInclude(r => r.FeedbackReview)
                .ToListAsync();

            var payload = lessons.Select(lesson =>
            {
                var perLesson = attempts.Where(a => a.LessonId == lesson.Id).ToList();
                var active = perLesson.FirstOrDefault(a => a.SubmittedAt == null);
                var hasSubmitted = perLesson.Any(a => a.SubmittedAt != null);
                var hasRetried = perLesson.Any(a => a.IsRetry && a.SubmittedAt != null);
                var submitted = perLesson
                    .Where(a => a.SubmittedAt != null)
                    .OrderBy(a => a.SubmittedAt)
                    .ToList();

                var latestSubmitted = submitted.LastOrDefault();
                var originalSubmitted = submitted.FirstOrDefault(a => !a.IsRetry) ?? submitted.FirstOrDefault();
                var retrySubmitted = submitted.FirstOrDefault(a => a.IsRetry);

                LessonAttemptSummaryDto? summary = null;
                if (latestSubmitted != null)
                    summary = BuildAttemptSummary(latestSubmitted);

                LessonAttemptSummaryDto? original = null;
                if (originalSubmitted != null)
                    original = BuildAttemptSummary(originalSubmitted);

                LessonAttemptSummaryDto? retry = null;
                if (retrySubmitted != null)
                    retry = BuildAttemptSummary(retrySubmitted);

                return new
                {
                    lesson.Id,
                    lesson.Title,
                    lesson.Status,
                    lesson.DueDate,
                    lesson.UpdatedAt,
                    ActiveAttempt = active != null ? new { AttemptId = active.Id, active.StartedAt } : null,
                    LatestAttempt = summary,
                    OriginalAttempt = original,
                    RetryAttempt = retry,
                    RetryAllowed = hasSubmitted && !hasRetried && active == null,
                    ScoreOutOf = 22
                };
            }).ToList();

            return Ok(payload);
        }

        [HttpGet("{lessonId:int}")]
        public async Task<IActionResult> GetLesson(int lessonId)
        {
            var student = await GetStudentAsync();
            if (student == null)
                return Unauthorized("Student profile not found.");

            if (student.ClassId == null)
                return Unauthorized("Student is not assigned to a class.");

            var classId = student.ClassId.Value;

            var lesson = await _db.Lessons
                .Include(l => l.Questions)
                    .ThenInclude(q => q.AnswerOptions)
                .Include(l => l.Assignments)
                .FirstOrDefaultAsync(l =>
                    l.Id == lessonId &&
                    l.Status == LessonStatus.Published &&
                    l.Assignments.Any(a => a.ClassId == classId));

            if (lesson == null)
                return NotFound("Lesson not found or not assigned to your class.");

            return Ok(new
            {
                lesson.Id,
                lesson.Title,
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
                        AnswerOptions = q.Type == QuestionType.Reading
                            ? q.AnswerOptions
                                .Select(o => new AnswerOptionPublicDto { Id = o.Id, Text = o.Text })
                                .ToList()
                            : new List<AnswerOptionPublicDto>()
                    })
            });
        }

        [HttpPost("{lessonId:int}/start")]
        public async Task<IActionResult> StartAttempt(int lessonId)
        {
            var student = await GetStudentAsync();
            if (student == null)
                return Unauthorized("Student profile not found.");

            if (student.ClassId == null)
                return Unauthorized("Student is not assigned to a class.");

            var classId = student.ClassId.Value;

            var lessonExists = await _db.Lessons.AnyAsync(l =>
                l.Id == lessonId &&
                l.Status == LessonStatus.Published &&
                l.Assignments.Any(a => a.ClassId == classId));

            if (!lessonExists)
                return NotFound("Lesson not found or not assigned to your class.");

            var hasRetriedAlready = await _db.LessonAttempts.AnyAsync(a =>
                a.LessonId == lessonId &&
                a.StudentId == student.Id &&
                a.IsRetry &&
                a.SubmittedAt != null);

            if (hasRetriedAlready)
                return BadRequest("Retry limit reached for this lesson.");

            var existingActive = await _db.LessonAttempts.FirstOrDefaultAsync(a =>
                a.LessonId == lessonId &&
                a.StudentId == student.Id &&
                a.SubmittedAt == null);

            if (existingActive != null)
            {
                return Ok(new
                {
                    AttemptId = existingActive.Id,
                    existingActive.LessonId,
                    existingActive.StartedAt,
                    existingActive.IsRetry,
                    ReusedExisting = true
                });
            }

            var hasSubmittedBefore = await _db.LessonAttempts.AnyAsync(a =>
                a.LessonId == lessonId &&
                a.StudentId == student.Id &&
                a.SubmittedAt != null);

            var attempt = new LessonAttempt
            {
                LessonId = lessonId,
                StudentId = student.Id,
                IsRetry = hasSubmittedBefore,
                StartedAt = DateTime.UtcNow,
                NeedsTeacherReview = true,
                TeacherReviewCompleted = false
            };

            _db.LessonAttempts.Add(attempt);
            await _db.SaveChangesAsync();

            return Ok(new
            {
                AttemptId = attempt.Id,
                attempt.LessonId,
                attempt.StartedAt,
                attempt.IsRetry,
                ReusedExisting = false
            });
        }

        [HttpPost("{lessonId:int}/progress")]
        public async Task<IActionResult> SaveProgress(int lessonId, [FromBody] SaveLessonProgressRequest dto)
        {
            if (dto == null || dto.AttemptId <= 0)
                return BadRequest("Invalid save payload.");

            var student = await GetStudentAsync();
            if (student == null)
                return Unauthorized("Student profile not found.");

            var attempt = await _db.LessonAttempts
                .Include(a => a.Responses)
                .FirstOrDefaultAsync(a =>
                    a.Id == dto.AttemptId &&
                    a.LessonId == lessonId &&
                    a.StudentId == student.Id &&
                    a.SubmittedAt == null);

            if (attempt == null)
                return NotFound("Active attempt not found.");

            var lesson = await _db.Lessons
                .Include(l => l.Questions)
                .FirstOrDefaultAsync(l => l.Id == lessonId);

            if (lesson == null)
                return NotFound("Lesson not found.");

            var questionIds = lesson.Questions.Select(q => q.Id).ToHashSet();
            var responses = dto.Responses ?? new List<SubmitQuestionResponseDto>();

            foreach (var incoming in responses)
            {
                if (!questionIds.Contains(incoming.LessonQuestionId))
                    continue;

                var question = lesson.Questions.First(q => q.Id == incoming.LessonQuestionId);
                var existing = attempt.Responses.FirstOrDefault(r => r.LessonQuestionId == question.Id);
                if (existing == null)
                {
                    existing = new QuestionResponse
                    {
                        LessonAttemptId = attempt.Id,
                        LessonQuestionId = question.Id,
                        NeedsReview = question.Type != QuestionType.Reading
                    };
                    attempt.Responses.Add(existing);
                }

                if (question.Type == QuestionType.Reading)
                {
                    existing.SelectedOptionId = incoming.SelectedOptionId;
                    existing.IsCorrect = null;
                    existing.Score = 0;
                    existing.AiScore = null;
                }
                else
                {
                    existing.ResponseText = (incoming.ResponseText ?? string.Empty).Trim();
                    existing.Score = 0;
                    existing.AiScore = null;
                    existing.NeedsReview = true;
                }
            }

            await _db.SaveChangesAsync();

            return Ok(new
            {
                attempt.Id,
                attempt.LessonId,
                SavedResponses = attempt.Responses.Count,
                SavedAt = DateTime.UtcNow
            });
        }

        [HttpGet("{lessonId:int}/attempts/{attemptId:int}")]
        public async Task<IActionResult> GetAttempt(int lessonId, int attemptId)
        {
            var student = await GetStudentAsync();
            if (student == null)
                return Unauthorized("Student profile not found.");

            var attempt = await GetAttemptWithDetailsAsync(attemptId);
            if (attempt == null || attempt.StudentId != student.Id || attempt.LessonId != lessonId)
                return NotFound("Attempt not found.");

            return Ok(BuildAttemptDetail(attempt));
        }

        [HttpPost("{lessonId:int}/submit")]
        public async Task<IActionResult> SubmitAttempt(int lessonId, [FromBody] SubmitLessonRequest dto)
        {
            if (dto == null || dto.AttemptId <= 0 || dto.Responses == null)
                return BadRequest("Invalid submission payload.");

            var student = await GetStudentAsync();
            if (student == null)
                return Unauthorized("Student profile not found.");

            var attempt = await _db.LessonAttempts
                .Include(a => a.Responses)
                .FirstOrDefaultAsync(a =>
                    a.Id == dto.AttemptId &&
                    a.LessonId == lessonId &&
                    a.StudentId == student.Id);

            if (attempt == null)
                return NotFound("Attempt not found.");

            if (attempt.SubmittedAt != null)
                return BadRequest("Attempt already submitted.");

            var lesson = await _db.Lessons
                .Include(l => l.Questions)
                    .ThenInclude(q => q.AnswerOptions)
                .FirstOrDefaultAsync(l => l.Id == lessonId);

            if (lesson == null)
                return NotFound("Lesson not found.");

            var questionIds = lesson.Questions.Select(q => q.Id).ToHashSet();
            foreach (var r in dto.Responses)
            {
                if (!questionIds.Contains(r.LessonQuestionId))
                    return BadRequest($"Response includes invalid LessonQuestionId: {r.LessonQuestionId}");
            }

            if (attempt.Responses.Count > 0)
            {
                _db.QuestionResponses.RemoveRange(attempt.Responses);
                attempt.Responses.Clear();
            }

            int readingScore = 0;
            int provisionalWriting = 0;
            int provisionalSpeaking = 0;
            bool needsTeacherReview = false;

            foreach (var q in lesson.Questions.OrderBy(q => q.Order))
            {
                var submitted = dto.Responses.FirstOrDefault(x => x.LessonQuestionId == q.Id);
                if (submitted == null)
                    return BadRequest($"Missing response for questionId={q.Id}");

                if (q.Type == QuestionType.Reading)
                {
                    if (submitted.SelectedOptionId == null)
                        return BadRequest($"Reading question {q.Id} requires SelectedOptionId.");

                    var selectedOptionId = submitted.SelectedOptionId.Value;

                    var correct = q.AnswerOptions.Any(o => o.Id == selectedOptionId && o.IsCorrect);
                    var score = correct ? 1 : 0;
                    readingScore += score;

                    var resp = new QuestionResponse
                    {
                        LessonAttemptId = attempt.Id,
                        LessonQuestionId = q.Id,
                        SelectedOptionId = selectedOptionId,
                        IsCorrect = correct,
                        Score = score,
                        NeedsReview = false
                    };

                    attempt.Responses.Add(resp);

                    if (!correct)
                    {
                        _db.StudentErrors.Add(new StudentError
                        {
                            StudentId = student.Id,
                            QuestionResponse = resp,
                            ErrorType = "Reading",
                            CreatedAt = DateTime.UtcNow,
                            Resolved = false
                        });
                    }
                }
                else if (q.Type == QuestionType.Writing || q.Type == QuestionType.Speaking)
                {
                    var text = (submitted.ResponseText ?? string.Empty).Trim();
                    if (string.IsNullOrWhiteSpace(text))
                        return BadRequest($"{q.Type} question {q.Id} requires ResponseText.");

                    needsTeacherReview = true;

                    CorrectionResponse nlp;
                    try
                    {
                        nlp = await _correctionClient.CorrectAsync(studentInput: text, prompt: q.Prompt ?? string.Empty, maxLength: 256);
                    }
                    catch (Exception ex)
                    {
                        nlp = new CorrectionResponse
                        {
                            Original = text,
                            Corrected = text,
                            Prompt = q.Prompt ?? "",
                            NumErrors = 0,
                            Score = 0,
                            Changes = new List<CorrectionChange>(),
                            HasErrors = false
                        };

                        Console.WriteLine($"[NLP] Failed: {ex.Message}");
                    }

                    int aiScore = Math.Clamp(nlp.Score, 0, 10);
                    bool hasErrors = nlp.HasErrors || aiScore < 10;

                    var resp = new QuestionResponse
                    {
                        LessonAttemptId = attempt.Id,
                        LessonQuestionId = q.Id,
                        ResponseText = text,

                        Score = 0,

                        AiScore = aiScore,
                        NeedsReview = true
                    };

                    var changesJson = nlp.Changes != null && nlp.Changes.Count > 0
                        ? JsonSerializer.Serialize(nlp.Changes)
                        : null;

                    resp.FeedbackReview = new FeedbackReview
                    {
                        AiCorrections = nlp.Corrected,
                        AiFeedback = $"Errors: {nlp.NumErrors}. Provisional score: {aiScore}/10.",
                        TeacherFeedback = null,
                        TeacherScore = null,
                        ApprovedByTeacher = false,
                        CreatedAt = DateTime.UtcNow
                    };

                    if (!string.IsNullOrWhiteSpace(changesJson))
                        resp.FeedbackReview.AiFeedback += $" Changes: {changesJson}";

                    attempt.Responses.Add(resp);

                    if (hasErrors)
                    {
                        _db.StudentErrors.Add(new StudentError
                        {
                            StudentId = student.Id,
                            QuestionResponse = resp,
                            ErrorType = q.Type.ToString(),
                            CreatedAt = DateTime.UtcNow,
                            Resolved = false
                        });
                    }
                    if (q.Type == QuestionType.Writing)
                        provisionalWriting = aiScore;
                    else if (q.Type == QuestionType.Speaking)
                        provisionalSpeaking = aiScore;
                }
            }

            attempt.ReadingScore = Math.Clamp(readingScore, 0, 2);

            attempt.WritingScore = provisionalWriting;
            attempt.SpeakingScore = provisionalSpeaking;

            attempt.TotalScore = attempt.ReadingScore + attempt.WritingScore + attempt.SpeakingScore;

            attempt.NeedsTeacherReview = needsTeacherReview;
            attempt.TeacherReviewCompleted = false;
            attempt.SubmittedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync();

            var hydrated = await GetAttemptWithDetailsAsync(attempt.Id);
            if (hydrated == null)
                return Ok(new { attempt.Id, attempt.LessonId, attempt.SubmittedAt });

            return Ok(BuildAttemptDetail(hydrated));
        }

        private async Task<LessonAttempt?> GetAttemptWithDetailsAsync(int attemptId)
        {
            return await _db.LessonAttempts
                .Include(a => a.Lesson)
                    .ThenInclude(l => l.Questions)
                        .ThenInclude(q => q.AnswerOptions)
                .Include(a => a.Responses)
                    .ThenInclude(r => r.FeedbackReview)
                .Include(a => a.Responses)
                    .ThenInclude(r => r.LessonQuestion)
                .FirstOrDefaultAsync(a => a.Id == attemptId);
        }

        private LessonAttemptSummaryDto BuildAttemptSummary(LessonAttempt attempt)
        {
            int ResolveScore(QuestionType type, int fallback)
            {
                var response = attempt.Responses.FirstOrDefault(r => r.LessonQuestion.Type == type);
                if (response == null)
                    return fallback;

                // Prefer explicit teacher score, then the stored score after review, then AI score.
                if (response.FeedbackReview?.TeacherScore != null)
                    return response.FeedbackReview.TeacherScore.Value;
                if (!response.NeedsReview || attempt.TeacherReviewCompleted)
                    return response.Score;
                if (response.AiScore != null)
                    return response.AiScore.Value;

                return fallback;
            }

            var writing = ResolveScore(QuestionType.Writing, attempt.WritingScore);
            var speaking = ResolveScore(QuestionType.Speaking, attempt.SpeakingScore);
            var total = attempt.ReadingScore + writing + speaking;

            return new LessonAttemptSummaryDto
            {
                AttemptId = attempt.Id,
                SubmittedAt = attempt.SubmittedAt,
                ReadingScore = attempt.ReadingScore,
                WritingScore = writing,
                SpeakingScore = speaking,
                TotalScore = total,
                NeedsTeacherReview = attempt.NeedsTeacherReview,
                TeacherReviewCompleted = attempt.TeacherReviewCompleted,
                ReviewStatus = attempt.TeacherReviewCompleted
                    ? "Reviewed"
                    : attempt.NeedsTeacherReview ? "Pending" : "Reviewed"
            };
        }

        private object BuildAttemptDetail(LessonAttempt attempt)
        {
            var includeCorrectAnswers = attempt.SubmittedAt != null;
            var summary = BuildAttemptSummary(attempt);

            var questions = attempt.Lesson.Questions
                .OrderBy(q => q.Order)
                .Select(q =>
                {
                    var resp = attempt.Responses.FirstOrDefault(r => r.LessonQuestionId == q.Id);
                    return new
                    {
                        q.Id,
                        Type = q.Type.ToString(),
                        q.Order,
                        q.ReadingSnippet,
                        q.Prompt,
                        AnswerOptions = q.Type == QuestionType.Reading
                            ? q.AnswerOptions
                                .Select(o => new AnswerOptionPublicDto { Id = o.Id, Text = o.Text })
                                .ToList()
                            : new List<AnswerOptionPublicDto>(),
                        CorrectOptionId = includeCorrectAnswers && q.Type == QuestionType.Reading
                            ? q.AnswerOptions.FirstOrDefault(o => o.IsCorrect)?.Id
                            : null,
                        Response = resp == null
                            ? null
                            : new
                            {
                                resp.Id,
                                resp.SelectedOptionId,
                                resp.ResponseText,
                                resp.IsCorrect,
                                resp.AiScore,
                                resp.Score,
                                Feedback = resp.FeedbackReview == null
                                    ? null
                                    : new
                                    {
                                        resp.FeedbackReview.AiCorrections,
                                        resp.FeedbackReview.AiFeedback,
                                        resp.FeedbackReview.TeacherFeedback,
                                        resp.FeedbackReview.TeacherScore,
                                        resp.FeedbackReview.ApprovedByTeacher,
                                        Changes = ExtractChangesFromFeedback(resp.FeedbackReview.AiFeedback)
                                    }
                            }
                    };
                })
                .ToList();

            return new
            {
                Attempt = new
                {
                    summary.AttemptId,
                    attempt.LessonId,
                    summary.SubmittedAt,
                    attempt.StartedAt,
                    summary.TotalScore,
                    ScoreOutOf = 22,
                    summary.ReviewStatus,
                    summary.ReadingScore,
                    summary.WritingScore,
                    summary.SpeakingScore,
                    attempt.NeedsTeacherReview,
                    attempt.TeacherReviewCompleted
                },
                Lesson = new
                {
                    attempt.Lesson.Id,
                    attempt.Lesson.Title,
                    attempt.Lesson.DueDate
                },
                Questions = questions
            };
        }

        private List<CorrectionChange> ExtractChangesFromFeedback(string? aiFeedback)
        {
            if (string.IsNullOrWhiteSpace(aiFeedback))
                return new List<CorrectionChange>();

            const string marker = "Changes:";
            var idx = aiFeedback.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
            if (idx < 0)
                return new List<CorrectionChange>();

            var json = aiFeedback[(idx + marker.Length)..].Trim();
            try
            {
                var parsed = JsonSerializer.Deserialize<List<CorrectionChange>>(json);
                return parsed ?? new List<CorrectionChange>();
            }
            catch
            {
                return new List<CorrectionChange>();
            }
        }
    }

}
