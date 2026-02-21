namespace backend.Models.DTOs
{
    public class CreateClassRequest
    {
        public string Name { get; set; } = string.Empty;
    }

    public class AddStudentToClassRequest
    {
        public string Email { get; set; } = string.Empty;
    }

    public class UpdateStudentLevelRequest
    {
        public string Level { get; set; } = string.Empty;
    }
}
