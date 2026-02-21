using System.Text.Json.Serialization;

namespace backend.Models.DTOs
{
    public class CorrectionRequest
    {
        [JsonPropertyName("student_input")]
        public string StudentInput { get; set; } = "";

        [JsonPropertyName("prompt")]
        public string Prompt { get; set; } = "";

        [JsonPropertyName("max_length")]
        public int MaxLength { get; set; } = 256;
    }

    public class CorrectionChange
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "";

        [JsonPropertyName("from")]
        public string? From { get; set; }

        [JsonPropertyName("to")]
        public string? To { get; set; }

        [JsonPropertyName("error_type")]
        public string? ErrorType { get; set; }

        [JsonPropertyName("micro_feedback")]
        public string? MicroFeedback { get; set; }
    }

    public class CorrectionResponse
    {
        [JsonPropertyName("original")]
        public string Original { get; set; } = "";

        [JsonPropertyName("corrected")]
        public string Corrected { get; set; } = "";

        [JsonPropertyName("prompt")]
        public string Prompt { get; set; } = "";

        [JsonPropertyName("num_errors")]
        public int NumErrors { get; set; }

        [JsonPropertyName("score")]
        public int Score { get; set; }

        [JsonPropertyName("changes")]
        public List<CorrectionChange> Changes { get; set; } = new();

        [JsonPropertyName("has_errors")]
        public bool HasErrors { get; set; }
    }
}
