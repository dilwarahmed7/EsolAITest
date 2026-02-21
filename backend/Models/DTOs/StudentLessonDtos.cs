namespace backend.Models.DTOs
{
    public class AnswerOptionPublicDto
    {
        public int Id { get; set; }
        public string Text { get; set; } = string.Empty;
    }

    public class SubmitLessonRequest
    {
        public int AttemptId { get; set; }
        public List<SubmitQuestionResponseDto> Responses { get; set; } = new();
    }

    public class SubmitQuestionResponseDto
    {
        public int LessonQuestionId { get; set; }
        public int? SelectedOptionId { get; set; }
        public string? ResponseText { get; set; }
    }

    public class SaveLessonProgressRequest
    {
        public int AttemptId { get; set; }
        public List<SubmitQuestionResponseDto> Responses { get; set; } = new();
    }

    public class LessonAttemptSummaryDto
    {
        public int AttemptId { get; set; }
        public DateTime? SubmittedAt { get; set; }
        public int ReadingScore { get; set; }
        public int WritingScore { get; set; }
        public int SpeakingScore { get; set; }
        public int TotalScore { get; set; }
        public bool NeedsTeacherReview { get; set; }
        public bool TeacherReviewCompleted { get; set; }
        public string ReviewStatus { get; set; } = "Pending";
    }
}
