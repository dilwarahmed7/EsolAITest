using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace backend.Models
{
    public class LessonAttempt
    {
        [Key]
        public int Id { get; set; }

        [ForeignKey(nameof(Lesson))]
        public int LessonId { get; set; }
        public Lesson Lesson { get; set; } = null!;

        [ForeignKey(nameof(Student))]
        public int StudentId { get; set; }
        public Student Student { get; set; } = null!;

        public bool IsRetry { get; set; } = false;

        public DateTime StartedAt { get; set; } = DateTime.UtcNow;
        public DateTime? SubmittedAt { get; set; }

        // Scores
        public int ReadingScore { get; set; } = 0;
        public int WritingScore { get; set; } = 0;
        public int SpeakingScore { get; set; } = 0;

        public int TotalScore { get; set; } = 0;

        public bool NeedsTeacherReview { get; set; } = true;
        public bool TeacherReviewCompleted { get; set; } = false;

        public ICollection<QuestionResponse> Responses { get; set; } = new List<QuestionResponse>();
    }
}
