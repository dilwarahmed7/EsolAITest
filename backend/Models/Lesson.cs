using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace backend.Models
{
    public class Lesson
    {
        [Key]
        public int Id { get; set; }

        [ForeignKey(nameof(Teacher))]
        public int TeacherId { get; set; }
        public Teacher Teacher { get; set; } = null!;

        [Required]
        public string Title { get; set; } = string.Empty;

        public LessonStatus Status { get; set; } = LessonStatus.Draft;

        public DateTime? DueDate { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public ICollection<LessonQuestion> Questions { get; set; } = new List<LessonQuestion>();
        public ICollection<LessonAssignment> Assignments { get; set; } = new List<LessonAssignment>();
    }
}
