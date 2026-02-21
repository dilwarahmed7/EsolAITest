using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace backend.Models
{
    public class Student
    {
        [Key]
        public int Id { get; set; }

        [ForeignKey(nameof(User))]
        public int UserId { get; set; }

        public User User { get; set; } = null!;

        [Required]
        public string FullName { get; set; } = string.Empty;

        public int Age { get; set; }

        [Required]
        public string FirstLanguage { get; set; } = string.Empty;

        public string Level { get; set; } = string.Empty;

        [ForeignKey(nameof(Class))]
        public int? ClassId { get; set; }

        public Class? Class { get; set; }
    }
}
