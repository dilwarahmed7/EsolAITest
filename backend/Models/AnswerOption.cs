using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace backend.Models
{
    public class AnswerOption
    {
        [Key]
        public int Id { get; set; }

        [ForeignKey(nameof(LessonQuestion))]
        public int LessonQuestionId { get; set; }
        public LessonQuestion LessonQuestion { get; set; } = null!;

        [Required]
        public string Text { get; set; } = string.Empty;

        public bool IsCorrect { get; set; }
    }
}
