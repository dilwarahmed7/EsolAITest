namespace backend.Models.DTOs
{
    public class StartPracticeRequest
    {
        public string ErrorType { get; set; } = string.Empty;
    }

    public class QuestionGenerationRequest
    {
        public string ErrorType { get; set; } = string.Empty;
        public string FirstLanguage { get; set; } = string.Empty;
        public int Age { get; set; }
        public string Level { get; set; } = string.Empty;
        public string? Seed { get; set; }
    }

    public class PracticeQuestion
    {
        public string QuestionText { get; set; } = string.Empty;
        public List<string> Answers { get; set; } = new();
    }

    public class PracticeQuestionResponse
    {
        public List<PracticeQuestion> Questions { get; set; } = new();
        public string? ModelUsed { get; set; }
    }

    public class BasicAnswerOptionDto
    {
        public int Id { get; set; }
        public string Text { get; set; } = string.Empty;
    }

    public class PersonalisedErrorDto
    {
        public int QuestionId { get; set; }
        public string LessonTitle { get; set; } = string.Empty;
        public string Type { get; set; } = string.Empty;
        public string? Prompt { get; set; }
        public string? ReadingSnippet { get; set; }
        public List<BasicAnswerOptionDto> AnswerOptions { get; set; } = new();
        public DateTime CreatedAt { get; set; }
    }

    public class PersonalisedAnswerRequest
    {
        public int QuestionId { get; set; }
        public int? SelectedOptionId { get; set; }
        public string? ResponseText { get; set; }
    }

    public class PersonalisedAnswerResponse
    {
        public bool Correct { get; set; }
        public int Score { get; set; }
        public string Feedback { get; set; } = string.Empty;
        public string? CorrectedText { get; set; }
        public List<CorrectionChange> Changes { get; set; } = new();
    }
}
