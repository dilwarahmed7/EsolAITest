using System.Threading.Tasks;

namespace backend.Services.Interfaces
{
    public interface IGeminiClient
    {
        Task<(string Output, string ModelUsed)> GenerateTextAsync(string prompt, string? model = null, string? seed = null);
    }
}
