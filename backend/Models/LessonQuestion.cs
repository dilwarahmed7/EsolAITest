using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace backend.Models
{
    public class LessonQuestion
    {
        [Key]
        public int Id { get; set; }

        [ForeignKey(nameof(Lesson))]
        public int LessonId { get; set; }
        public Lesson Lesson { get; set; } = null!;

        public QuestionType Type { get; set; }

        public int Order { get; set; }

        public string? ReadingSnippet { get; set; }

        [Required]
        public string Prompt { get; set; } = string.Empty;

        public int? CorrectAnswerOptionId { get; set; }

        public ICollection<AnswerOption> AnswerOptions { get; set; } = new List<AnswerOption>();
    }
}
