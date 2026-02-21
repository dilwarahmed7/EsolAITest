using System.Net.Http.Json;
using backend.Models.DTOs;
using backend.Services.Interfaces;

namespace backend.Services
{
    public class CorrectionClient : ICorrectionClient
    {
        private readonly HttpClient _http;

        public CorrectionClient(HttpClient http)
        {
            _http = http;
        }

        public async Task<CorrectionResponse> CorrectAsync(string studentInput, string prompt = "", int maxLength = 256)
        {
            var req = new CorrectionRequest
            {
                StudentInput = studentInput,
                Prompt = prompt,
                MaxLength = maxLength
            };

            var res = await _http.PostAsJsonAsync("/correct", req);

            if (!res.IsSuccessStatusCode)
            {
                var body = await res.Content.ReadAsStringAsync();
                throw new Exception($"NLP /correct failed: {(int)res.StatusCode} {body}");
            }

            var parsed = await res.Content.ReadFromJsonAsync<CorrectionResponse>();
            if (parsed == null) throw new Exception("NLP response was empty");

            return parsed;
        }
    }
}
