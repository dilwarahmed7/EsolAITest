using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace backend.Models
{
    public class FeedbackReview
    {
        [Key]
        public int Id { get; set; }

        [ForeignKey(nameof(QuestionResponse))]
        public int QuestionResponseId { get; set; }

        public QuestionResponse QuestionResponse { get; set; } = null!;

        public string? AiCorrections { get; set; }

        public string? AiFeedback { get; set; }

        public string? TeacherFeedback { get; set; }

        public int? TeacherScore { get; set; }

        public bool ApprovedByTeacher { get; set; } = false;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public DateTime? ReviewedAt { get; set; }
    }
}
