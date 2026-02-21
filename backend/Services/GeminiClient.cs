using backend.Services.Interfaces;
using System.Net;
using System.Text;
using System.Text.Json;

namespace backend.Services
{
    public class GeminiClient : IGeminiClient
    {
        private readonly HttpClient _httpClient;
        private readonly string _apiKey;

        private static readonly Dictionary<string, int> _dailyUsage = new();

        private readonly List<string> _fallbackModels = new()
        {
            "gemma-3-4b-it",
            "gemma-3-12b-it",
            "gemma-3-27b-it",
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
            "gemini-1.5-flash"
        };

        public GeminiClient(IConfiguration config)
        {
            _httpClient = new HttpClient();
            _apiKey = config["GEMINI_API_KEY"]
                     ?? throw new InvalidOperationException("GEMINI_API_KEY missing.");
        }

        public async Task<(string Output, string ModelUsed)> GenerateTextAsync(string prompt, string? model = null, string? seed = null)
        {
            var requestSeed = seed ?? Guid.NewGuid().ToString("N");

            prompt += $"\n\nREQUEST_SEED: {requestSeed}";

            var modelToUse = model ?? "gemma-3-4b-it";

            var modelsToTry = new List<string> { modelToUse };
            modelsToTry.AddRange(_fallbackModels.Where(m => m != modelToUse));

            foreach (var m in modelsToTry)
            {
                if (_dailyUsage.TryGetValue(m, out var count) && count >= 19)
                    continue;

                Console.WriteLine($"[GeminiClient] Trying model: {m} (Seed: {requestSeed})");

                try
                {
                    string output = await CallModelApi(prompt, m);

                    _dailyUsage[m] = _dailyUsage.GetValueOrDefault(m) + 1;

                    Console.WriteLine($"[GeminiClient] SUCCESS using model: {m}");

                    return (output, m);
                }
                catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.TooManyRequests)
                {
                    Console.WriteLine($"[GeminiClient] 429 for model {m}, falling back...");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[GeminiClient] Model {m} failed: {ex.Message}. Falling back...");
                }
            }

            throw new Exception("All AI models are unavailable right now.");
        }

        private async Task<string> CallModelApi(string prompt, string model)
        {
            bool isGemma = model.StartsWith("gemma");

            string url = isGemma
                ? $"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={_apiKey}"
                : $"https://generativelanguage.googleapis.com/v1/models/{model}:generateContent?key={_apiKey}";

            var jsonBody = JsonSerializer.Serialize(new
            {
                contents = new[]
                {
                    new {
                        parts = new[]
                        {
                            new { text = prompt }
                        }
                    }
                },
                generationConfig = new
                {
                    temperature = 1.25,
                    topP = 0.92,
                    topK = 30,
                    maxOutputTokens = 512
                }
            });

            var response = await _httpClient.PostAsync(url,
                new StringContent(jsonBody, Encoding.UTF8, "application/json"));

            if (response.StatusCode == HttpStatusCode.TooManyRequests)
                throw new HttpRequestException("429", null, HttpStatusCode.TooManyRequests);

            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadAsStringAsync();
            var doc = JsonDocument.Parse(json);

            return doc.RootElement
                      .GetProperty("candidates")[0]
                      .GetProperty("content")
                      .GetProperty("parts")[0]
                      .GetProperty("text")
                      .GetString()!;
        }

        public static IReadOnlyDictionary<string, int> GetUsage() => _dailyUsage;
    }
}
