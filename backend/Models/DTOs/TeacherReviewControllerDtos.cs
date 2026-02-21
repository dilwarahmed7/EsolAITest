namespace backend.Models.DTOs
{
    public class CompleteReviewRequest
    {
        public List<TeacherReviewResponseDto> Responses { get; set; } = new();
    }

    public class TeacherReviewResponseDto
    {
        public int QuestionResponseId { get; set; }
        public string? CorrectedText { get; set; }
        public string? TeacherFeedback { get; set; }
        public int? TeacherScore { get; set; }
        public List<CorrectionChange>? Changes { get; set; }
    }
}
