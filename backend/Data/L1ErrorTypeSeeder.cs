using backend.Models;
using Microsoft.EntityFrameworkCore;

namespace backend.Data
{
    public static class L1ErrorTypeSeeder
    {
        public static async Task SeedAsync(AppDbContext context)
        {
            if (await context.L1ErrorTypes.AnyAsync())
                return;

            var filePath = "/Users/dilwar/Desktop/dxa213/backend/data/l1_errors.csv";

            if (!File.Exists(filePath))
                throw new FileNotFoundException("L1 error CSV not found", filePath);

            var lines = await File.ReadAllLinesAsync(filePath);

            foreach (var line in lines.Skip(1))
            {
                var parts = line.Split(',');

                if (parts.Length != 3)
                    continue;

                context.L1ErrorTypes.Add(new L1ErrorType
                {
                    FirstLanguage = parts[0].Trim(),
                    ErrorType = parts[1].Trim(),
                    Weight = double.Parse(parts[2])
                });
            }

            await context.SaveChangesAsync();
        }
    }
}
