using System.ComponentModel.DataAnnotations;

namespace backend.Models
{
    public class L1ErrorType
    {
        [Key]
        public int Id { get; set; }

        [Required]
        public string FirstLanguage { get; set; } = string.Empty;

        [Required]
        public string ErrorType { get; set; } = string.Empty;

        public double Weight { get; set; }
    }
}
