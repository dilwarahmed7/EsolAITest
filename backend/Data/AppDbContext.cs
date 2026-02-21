using Microsoft.EntityFrameworkCore;
using backend.Models;

namespace backend.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options)
            : base(options)
        {
        }

        public DbSet<User> Users { get; set; } = null!;
        public DbSet<Student> Students { get; set; } = null!;
        public DbSet<Teacher> Teachers { get; set; } = null!;

        public DbSet<L1ErrorType> L1ErrorTypes { get; set; } = null!;
        public DbSet<PracticeSession> PracticeSessions { get; set; } = null!;

        public DbSet<Class> Classes { get; set; } = null!;

        public DbSet<Lesson> Lessons { get; set; } = null!;
        public DbSet<LessonQuestion> LessonQuestions { get; set; } = null!;
        public DbSet<AnswerOption> AnswerOptions { get; set; } = null!;
        public DbSet<LessonAssignment> LessonAssignments { get; set; } = null!;
        public DbSet<LessonAttempt> LessonAttempts { get; set; } = null!;
        public DbSet<QuestionResponse> QuestionResponses { get; set; } = null!;
        public DbSet<FeedbackReview> FeedbackReviews { get; set; } = null!;
        public DbSet<StudentError> StudentErrors { get; set; } = null!;

        protected override void OnModelCreating(ModelBuilder builder)
        {
            base.OnModelCreating(builder);

            builder.Entity<User>()
                .HasIndex(u => u.Email)
                .IsUnique();

            builder.Entity<User>()
                .HasOne(u => u.StudentProfile)
                .WithOne(s => s.User)
                .HasForeignKey<Student>(s => s.UserId);

            builder.Entity<User>()
                .HasOne(u => u.TeacherProfile)
                .WithOne(t => t.User)
                .HasForeignKey<Teacher>(t => t.UserId);

            builder.Entity<Class>()
                .HasMany(c => c.Students)
                .WithOne(s => s.Class)
                .HasForeignKey(s => s.ClassId)
                .OnDelete(DeleteBehavior.SetNull);

            builder.Entity<LessonAssignment>()
                .HasKey(x => new { x.LessonId, x.ClassId });

            builder.Entity<LessonAssignment>()
                .HasOne(x => x.Lesson)
                .WithMany(l => l.Assignments)
                .HasForeignKey(x => x.LessonId);

            builder.Entity<LessonAssignment>()
                .HasOne(x => x.Class)
                .WithMany()
                .HasForeignKey(x => x.ClassId);

            builder.Entity<QuestionResponse>()
                .HasOne(qr => qr.FeedbackReview)
                .WithOne(fr => fr.QuestionResponse)
                .HasForeignKey<FeedbackReview>(fr => fr.QuestionResponseId);

            builder.Entity<StudentError>()
                .HasIndex(se => new { se.StudentId, se.QuestionResponseId })
                .IsUnique();
        }
    }
}
