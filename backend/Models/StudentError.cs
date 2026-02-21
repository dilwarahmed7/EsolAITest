using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace backend.Models
{
    public class StudentError
    {
        [Key]
        public int Id { get; set; }

        [ForeignKey(nameof(Student))]
        public int StudentId { get; set; }
        public Student Student { get; set; } = null!;

        [ForeignKey(nameof(QuestionResponse))]
        public int QuestionResponseId { get; set; }
        public QuestionResponse QuestionResponse { get; set; } = null!;

        public string ErrorType { get; set; } = string.Empty;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public bool Resolved { get; set; } = false;
    }
}
