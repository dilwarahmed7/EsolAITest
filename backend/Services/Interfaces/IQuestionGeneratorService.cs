using backend.Models.DTOs;
using System.Threading.Tasks;

namespace backend.Services.Interfaces
{
    public interface IQuestionGeneratorService
    {
        Task<PracticeQuestionResponse> GenerateAsync(QuestionGenerationRequest request);
    }
}
