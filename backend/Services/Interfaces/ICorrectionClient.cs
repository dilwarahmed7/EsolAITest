using backend.Models.DTOs;

namespace backend.Services.Interfaces
{
    public interface ICorrectionClient
    {
        Task<CorrectionResponse> CorrectAsync(string studentInput, string prompt = "", int maxLength = 256);
    }
}