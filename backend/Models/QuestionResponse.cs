using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace backend.Models
{
    public class QuestionResponse
    {
        [Key]
        public int Id { get; set; }

        [ForeignKey(nameof(LessonAttempt))]
        public int LessonAttemptId { get; set; }
        public LessonAttempt LessonAttempt { get; set; } = null!;

        [ForeignKey(nameof(LessonQuestion))]
        public int LessonQuestionId { get; set; }
        public LessonQuestion LessonQuestion { get; set; } = null!;

        public string? ResponseText { get; set; }
        public int? SelectedOptionId { get; set; }

        public bool? IsCorrect { get; set; }
        public int Score { get; set; } = 0;

        public int? AiScore { get; set; }
        public bool NeedsReview { get; set; } = false;
        public FeedbackReview? FeedbackReview { get; set; }
    }
}
