using System.ComponentModel.DataAnnotations.Schema;

namespace backend.Models
{
    public class LessonAssignment
    {
        public int LessonId { get; set; }
        public Lesson Lesson { get; set; } = null!;

        public int ClassId { get; set; }
        public Class Class { get; set; } = null!;

        public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
    }
}
