import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../../Components/PageLayout';
import Hero from '../../Components/Hero';
import Icon from '../../Components/Icons';
import './StudentDashboard.css';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

const API_BASE = 'http://localhost:5144/api/student/lessons';

const formatDate = (raw) => {
  if (!raw) return 'No due date';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return 'No due date';
  return d.toLocaleDateString();
};

const computeStatus = (lesson) => {
  if (lesson.latestAttempt) return 'Completed';
  const due = lesson.dueDate;
  const dueTime = due ? new Date(due).getTime() : NaN;
  if (!Number.isNaN(dueTime) && dueTime < Date.now()) return 'Late';
  return 'Active';
};

const normaliseAttempt = (raw) => {
  if (!raw) return null;
  return {
    totalScore: raw.totalScore ?? raw.TotalScore ?? null,
    readingScore: raw.readingScore ?? raw.ReadingScore ?? null,
    writingScore: raw.writingScore ?? raw.WritingScore ?? null,
    speakingScore: raw.speakingScore ?? raw.SpeakingScore ?? null,
    submittedAt: raw.submittedAt || raw.SubmittedAt,
  };
};

const normaliseLesson = (lesson) => {
  const scoreOutOf = lesson.scoreOutOf || lesson.ScoreOutOf || 22;
  const latest = lesson.latestAttempt || lesson.LatestAttempt;
  const original = lesson.originalAttempt || lesson.OriginalAttempt;
  const retry = lesson.retryAttempt || lesson.RetryAttempt;
  const active = lesson.activeAttempt || lesson.ActiveAttempt;
  return {
    id: lesson.id || lesson.Id,
    title: lesson.title || lesson.Title,
    dueDate: lesson.dueDate || lesson.DueDate,
    scoreOutOf,
    latestAttempt: normaliseAttempt(latest),
    originalAttempt: normaliseAttempt(original),
    retryAttempt: normaliseAttempt(retry),
    activeAttempt: active
      ? {
          attemptId: active.attemptId || active.AttemptId,
          startedAt: active.startedAt || active.StartedAt,
        }
      : null,
  };
};

const StatCard = ({ icon, label, value, description }) => (
  <div className="stat-card">
    <div className="stat-icon">{icon}</div>
    <div className="stat-text">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-description">{description}</div>
    </div>
  </div>
);

const QuickCard = ({ title, subtitle, children, onClick }) => (
  <div
    className="quick-card"
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    onClick={onClick}
    onKeyDown={(e) => {
      if (onClick && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onClick();
      }
    }}
  >
    <div className="quick-card-header">
      <div>
        <div className="quick-card-title">{title}</div>
        {subtitle && <div className="quick-card-subtitle">{subtitle}</div>}
      </div>
    </div>
    {children ? <div className="quick-card-body">{children}</div> : null}
  </div>
);

function StudentDashboard({ role }) {
  const navigate = useNavigate();
  const token = useMemo(() => sessionStorage.getItem('token') || localStorage.getItem('token'), []);
  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      }),
    []
  );
  const [lessons, setLessons] = useState([]);
  const [loadingLessons, setLoadingLessons] = useState(false);
  const { studentName, averageScore, proficiencyLevel, className } = useMemo(() => {
    const stored = localStorage.getItem('user');
    const parsed = stored ? JSON.parse(stored) : {};
    const profile = parsed.profile || {};

    return {
      studentName: profile.fullName || profile.FullName || 'Student',
      averageScore: profile.averageScore ?? profile.AverageScore ?? '--',
      proficiencyLevel: profile.level || profile.Level || 'N/A',
      className: profile.className || profile.ClassName || '',
    };
  }, []);

  useEffect(() => {
    const loadLessons = async () => {
      if (!token) return;
      setLoadingLessons(true);
      try {
        const res = await fetch(API_BASE, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const normalised = Array.isArray(data) ? data.map(normaliseLesson) : [];
        setLessons(normalised);
      } catch (err) {
        console.error(err);
        setLessons([]);
      } finally {
        setLoadingLessons(false);
      }
    };
    loadLessons();
  }, [token]);

  const lessonsWithStatus = lessons.map((l) => ({
    ...l,
    computedStatus: computeStatus(l),
  }));

  const todoLessons = lessonsWithStatus.filter((l) => l.computedStatus !== 'Completed');

  const firstAttemptScores = lessonsWithStatus
    .map((l) => {
      const primary = l.originalAttempt || l.latestAttempt;
      return primary && typeof primary.totalScore === 'number'
        ? { total: primary.totalScore, outOf: l.scoreOutOf || 22, submittedAt: primary.submittedAt }
        : null;
    })
    .filter(Boolean);

  const derivedAverage =
    firstAttemptScores.length > 0
      ? Math.round(
          (firstAttemptScores.reduce((sum, s) => sum + (s.total / s.outOf) * 100, 0) /
            firstAttemptScores.length) *
            10
        ) / 10
      : null;

  const averageTrend = useMemo(() => {
    if (firstAttemptScores.length < 2 || derivedAverage == null) return null;
    const scoredWithDates = firstAttemptScores
      .map((s) => ({
        ...s,
        time: s.submittedAt ? new Date(s.submittedAt).getTime() : NaN,
      }))
      .filter((s) => Number.isFinite(s.time))
      .sort((a, b) => b.time - a.time);

    if (scoredWithDates.length < 2) return null;
    const [latest, ...rest] = scoredWithDates;
    if (!latest || rest.length === 0) return null;

    const latestScore = (latest.total / latest.outOf) * 100;
    const prevAverage =
      rest.reduce((sum, s) => sum + (s.total / s.outOf) * 100, 0) / rest.length;

    const delta = latestScore - prevAverage;
    if (Math.abs(delta) < 0.05) return 'flat';
    return delta > 0 ? 'up' : 'down';
  }, [derivedAverage, firstAttemptScores]);

  const bestLearningTypesData = useMemo(() => {
    const totals = {
      Reading: { score: 0, count: 0, outOf: 2 },
      Writing: { score: 0, count: 0, outOf: 10 },
      Speaking: { score: 0, count: 0, outOf: 10 },
    };

    lessonsWithStatus.forEach((lesson) => {
      const attempt = lesson.originalAttempt || lesson.latestAttempt;
      if (!attempt) return;

      if (typeof attempt.readingScore === 'number') {
        totals.Reading.score += attempt.readingScore;
        totals.Reading.count += 1;
      }
      if (typeof attempt.writingScore === 'number') {
        totals.Writing.score += attempt.writingScore;
        totals.Writing.count += 1;
      }
      if (typeof attempt.speakingScore === 'number') {
        totals.Speaking.score += attempt.speakingScore;
        totals.Speaking.count += 1;
      }
    });

    return Object.entries(totals).map(([type, { score, count, outOf }]) => {
      if (!count || !outOf) return { type, percent: 0 };
      const avg = score / count;
      const percent = Math.round((avg / outOf) * 100);
      return { type, percent };
    });
  }, [lessonsWithStatus]);

  const stats = [
    {
      label: 'Average score',
      value:
        derivedAverage != null ? (
          <>
            {derivedAverage}%
            {averageTrend ? (
              <span className={`stat-trend ${averageTrend}`}>
                {averageTrend === 'up' ? '▲' : averageTrend === 'down' ? '▼' : '•'}
              </span>
            ) : null}
          </>
        ) : typeof averageScore === 'number' ? (
          `${averageScore}%`
        ) : (
          averageScore
        ),
      description: 'Based on first attempts',
      icon: <Icon.ChartLine />,
    },
    {
      label: 'Proficiency level',
      value: proficiencyLevel,
      description: 'Keep up the momentum',
      icon: <Icon.LayerGroup />,
    },
    {
      label: 'Lessons to complete',
      value: loadingLessons ? '…' : todoLessons.length,
      description: 'Assigned and pending',
      icon: <Icon.ListOl />,
    },
  ];

  return (
    <PageLayout title={null} role={role}>
      <Hero
        variant="student"
        eyebrow={todayLabel}
        title={`Welcome back, ${studentName}`}
        subtitle="Stay on top of assignments and track your growth."
        icon={<Icon.Dashboard className="icon" />}
        action={className ? <div className="class-chip">{className}</div> : null}
      />

      <div className="section-header">
        <h2>Your Personalised Dashboard</h2>
      </div>

      <div className="stats-grid">
        {stats.map((stat) => (
          <StatCard
            key={stat.label}
            icon={stat.icon}
            label={stat.label}
            value={stat.value}
            description={stat.description}
          />
        ))}
        </div>

        <div className="quick-grid">
          <QuickCard
            title="Quick access lessons to do"
            subtitle="Pick up where you left off"
            onClick={() => navigate('/my-lessons')}
          >
            <div className="lesson-placeholders">
              {loadingLessons ? (
                [1, 2, 3].map((idx) => (
                  <div key={idx} className="lesson-row">
                    <div className="lesson-dot" />
                    <div className="lesson-text">
                      <div className="lesson-title-placeholder" />
                      <div className="lesson-meta-placeholder" />
                    </div>
                  </div>
                ))
              ) : todoLessons.length === 0 ? (
                <div className="muted">No lessons to do right now.</div>
              ) : (
                todoLessons.slice(0, 3).map((lesson) => {
                  const hasDraft = !!lesson.activeAttempt;
                  return (
                    <div key={lesson.id} className="lesson-row">
                      <div className="lesson-dot" />
                      <div className="lesson-text">
                        <div className="lesson-title">{lesson.title}</div>
                        <div className="lesson-meta">
                          <span className="muted">Due {formatDate(lesson.dueDate)}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="primary-btn small"
                        onClick={() => navigate('/my-lessons')}
                      >
                        {hasDraft ? 'Continue' : 'Start'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </QuickCard>

          <QuickCard
            title="Practice"
            subtitle="Target what matters most"
            onClick={() => navigate('/practice')}
          >
            <div className="practice-actions">
              <p className="practice-copy">
                Jump into the practice workspace to work on your common and personalised errors.
              </p>
              <div className="practice-btn primary">Open practice workspace</div>
            </div>
          </QuickCard>

          <QuickCard
            title="Progress"
            subtitle="All time performance"
            onClick={() => navigate('/progress')}
          >
            {loadingLessons ? (
              <div className="progress-quick-empty">Loading progress…</div>
            ) : lessonsWithStatus.length === 0 ? (
              <div className="progress-quick-empty">No progress yet.</div>
            ) : (
              <div className="progress-quick-chart">
                <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={bestLearningTypesData} margin={{ top: 6, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="type" tickLine={false} axisLine={false} />
                      <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} />
                      <Tooltip formatter={(v) => [`${v}%`, 'Score']} />
                      <Bar dataKey="percent" radius={[8, 8, 0, 0]} fill="var(--dashboard-bar-fill)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
          </QuickCard>
        </div>

    </PageLayout>
  );
}

export default StudentDashboard;
