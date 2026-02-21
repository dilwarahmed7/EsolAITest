using backend.Models;

namespace backend.Models.DTOs
{
    public class CreateLessonRequest
    {
        public string Title { get; set; } = string.Empty;
        public DateTime? DueDate { get; set; }
    }

    public class UpdateLessonRequest
    {
        public string? Title { get; set; }
        public DateTime? DueDate { get; set; }
        public LessonStatus? Status { get; set; }
    }

    public class AssignLessonRequest
    {
        public List<int> ClassIds { get; set; } = new();
    }

    public class UpsertLessonQuestionsRequest
    {
        public List<UpsertLessonQuestionDto> Questions { get; set; } = new();
    }

    public class UpsertLessonQuestionDto
    {
        public QuestionType Type { get; set; }
        public int Order { get; set; }
        public string? ReadingSnippet { get; set; }
        public string Prompt { get; set; } = string.Empty;
        public List<UpsertAnswerOptionDto>? AnswerOptions { get; set; }
    }

    public class UpsertAnswerOptionDto
    {
        public string Text { get; set; } = string.Empty;
        public bool IsCorrect { get; set; }
    }
}
