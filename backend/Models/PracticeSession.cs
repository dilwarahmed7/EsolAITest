using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace backend.Models
{
    public class PracticeSession
    {
        [Key]
        public int Id { get; set; }

        [ForeignKey(nameof(Student))]
        public int StudentId { get; set; }

        [Required]
        public string ErrorType { get; set; } = string.Empty;

        [Required]
        public string PracticeSource { get; set; } = "L1_COMMON";

        public int TotalQuestions { get; set; }

        public int CorrectAnswers { get; set; }

        public int Score { get; set; }

        public DateTime CompletedAt { get; set; } = DateTime.UtcNow;

        public Student Student { get; set; } = null!;
    }
}
