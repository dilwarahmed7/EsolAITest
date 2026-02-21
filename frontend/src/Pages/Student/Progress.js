import React, { useEffect, useMemo, useState } from 'react';
import PageLayout from '../../Components/PageLayout';
import Hero from '../../Components/Hero';
import Icon from '../../Components/Icons';
import './Progress.css';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Legend, BarChart, Bar} from 'recharts';

const API_ORIGIN = process.env.REACT_APP_API_ORIGIN || 'http://localhost:5144';
const API_BASE = `${API_ORIGIN}/api/student/lessons`;

const computeStatus = (lesson) => {
  if (lesson.latestAttempt) return 'Completed';
  const due = lesson.dueDate;
  const dueTime = due ? new Date(due).getTime() : NaN;
  if (!Number.isNaN(dueTime) && dueTime < Date.now()) return 'Late';
  return 'Active';
};

const STATUS_COLORS = {
  Completed: '#22c55e',
  Active: '#3b82f6',
  Late: '#ef4444',
};

const ProgressCard = ({ icon, label, value, description }) => (
  <div className="progress-card">
    <div className="progress-icon">{icon}</div>
    <div className="progress-text">
      <div className="progress-label">{label}</div>
      <div className="progress-value">{value}</div>
      <div className="progress-description">{description}</div>
    </div>
  </div>
);

const toDayKey = (d = new Date()) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const daysBetweenDayKeys = (aDayKey, bDayKey) => {
  const [ay, am, ad] = aDayKey.split('-').map(Number);
  const [by, bm, bd] = bDayKey.split('-').map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
};

const getAndUpdateDailyStreak = () => {
  const today = toDayKey();
  const keyCount = 'dailyStreakCount';
  const keyLast = 'dailyStreakLastLogin';

  const last = localStorage.getItem(keyLast);
  const countRaw = localStorage.getItem(keyCount);
  const prevCount = Number.isFinite(Number(countRaw)) ? Number(countRaw) : 0;

  if (!last) {
    localStorage.setItem(keyLast, today);
    localStorage.setItem(keyCount, '1');
    return 1;
  }

  const diff = daysBetweenDayKeys(last, today);

  if (diff === 0) return Math.max(prevCount, 1);

  if (diff === 1) {
    const next = Math.max(prevCount, 1) + 1;
    localStorage.setItem(keyLast, today);
    localStorage.setItem(keyCount, String(next));
    return next;
  }

  localStorage.setItem(keyLast, today);
  localStorage.setItem(keyCount, '1');
  return 1;
};

const normaliseLesson = (l) => ({
  ...l,
  dueDate: l.dueDate ?? l.DueDate ?? null,
  updatedAt: l.updatedAt ?? l.UpdatedAt ?? null,
  scoreOutOf: l.scoreOutOf ?? l.ScoreOutOf ?? 22,
  latestAttempt: l.latestAttempt ?? l.LatestAttempt ?? null,
  originalAttempt: l.originalAttempt ?? l.OriginalAttempt ?? null,
});

function Progress({ role }) {
  const token = useMemo(
    () => sessionStorage.getItem('token') || localStorage.getItem('token'),
    []
  );

  const [lessons, setLessons] = useState([]);
  const [loadingLessons, setLoadingLessons] = useState(false);
  const [dailyStreak, setDailyStreak] = useState(1);
  const [learningRange, setLearningRange] = useState('7d');

  useEffect(() => {
    setDailyStreak(getAndUpdateDailyStreak());
  }, []);

  useEffect(() => {
    const loadLessons = async () => {
      if (!token) return;
      setLoadingLessons(true);

      try {
        const res = await fetch(API_BASE, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) throw new Error(`Lessons request failed: ${res.status}`);

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

  const { averageScoreFromProfile, proficiencyLevel } = useMemo(() => {
    const stored = localStorage.getItem('user');
    const parsed = stored ? JSON.parse(stored) : {};
    const profile = parsed.profile || {};

    return {
      averageScoreFromProfile: profile.averageScore ?? profile.AverageScore ?? '--',
      proficiencyLevel: profile.level || profile.Level || 'N/A',
    };
  }, []);

  const lessonsWithStatus = useMemo(
    () => lessons.map((l) => ({ ...l, computedStatus: computeStatus(l) })),
    [lessons]
  );

  const firstAttemptScores = useMemo(() => {
    return lessonsWithStatus
      .map((l) => {
        const primary = l.originalAttempt || l.latestAttempt;
        return primary && typeof primary.totalScore === 'number'
          ? {
              total: primary.totalScore,
              outOf: typeof l.scoreOutOf === 'number' ? l.scoreOutOf : 22,
              submittedAt: primary.submittedAt,
            }
          : null;
      })
      .filter(Boolean);
  }, [lessonsWithStatus]);

  const scoreHistory = useMemo(() => {
    return firstAttemptScores
      .map((s, idx) => {
        if (!s.submittedAt) return null;

        const ms = new Date(s.submittedAt).getTime();
        if (!Number.isFinite(ms)) return null;

        const pct = Math.round(((s.total / s.outOf) * 100) * 10) / 10;

        return {
          time: ms,
          score: pct,
          id: `${ms}-${idx}`,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);
  }, [firstAttemptScores]);


  const firstAttemptScoresInRange = useMemo(() => {
    if (learningRange === 'all') return firstAttemptScores;
    const windowMs = learningRange === '7d' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    return firstAttemptScores.filter((s) => {
      const time = s.submittedAt ? new Date(s.submittedAt).getTime() : NaN;
      if (!Number.isFinite(time)) return false;
      return now - time <= windowMs;
    });
  }, [firstAttemptScores, learningRange]);

  const derivedAverage = useMemo(() => {
    if (firstAttemptScoresInRange.length === 0) return null;

    const avg =
      firstAttemptScoresInRange.reduce((sum, s) => sum + (s.total / s.outOf) * 100, 0) /
      firstAttemptScoresInRange.length;

    return Math.round(avg * 10) / 10;
  }, [firstAttemptScoresInRange]);

  const averageTrend = useMemo(() => {
    if (firstAttemptScoresInRange.length < 2 || derivedAverage == null) return null;

    const scoredWithDates = firstAttemptScoresInRange
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
  }, [derivedAverage, firstAttemptScoresInRange]);

  const stats = [
    {
      label: 'Proficiency level',
      value: proficiencyLevel,
      description: 'Keep up the momentum',
      icon: <Icon.LayerGroup />,
    },
    {
      label: 'Daily Streak',
      value: `${dailyStreak} day${dailyStreak === 1 ? '' : 's'}`,
      description: 'Consistency is key!',
      icon: <Icon.Fire />,
    },
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
        ) : typeof averageScoreFromProfile === 'number' ? (
          `${averageScoreFromProfile}%`
        ) : (
          averageScoreFromProfile
        ),
      description: loadingLessons
        ? 'Loading lessons…'
        : derivedAverage == null
        ? 'No data in this time range'
        : 'Based on first attempts',
      icon: <Icon.ChartLine />,
    },
  ];

  const lessonsInRange = useMemo(() => {
    if (learningRange === 'all') return lessonsWithStatus;
    const windowMs = learningRange === '7d' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    return lessonsWithStatus.filter((lesson) => {
      const attempt = lesson.originalAttempt || lesson.latestAttempt;
      const submittedAt = attempt?.submittedAt;
      const fallbackTime = lesson.updatedAt || lesson.dueDate;
      const timeSource = submittedAt || fallbackTime;
      if (!timeSource) return false;
      const time = new Date(timeSource).getTime();
      if (!Number.isFinite(time)) return false;
      return now - time <= windowMs;
    });
  }, [learningRange, lessonsWithStatus]);

  const lessonStatusData = useMemo(() => {
    const counts = { Completed: 0, Active: 0, Late: 0 };

    lessonsInRange.forEach((l) => {
      counts[l.computedStatus] = (counts[l.computedStatus] || 0) + 1;
    });

    return Object.entries(counts).map(([name, value]) => ({
      name,
      value,
      fill: STATUS_COLORS[name],
    }));
  }, [lessonsInRange]);

  const lessonStatusTotal = useMemo(
    () => lessonStatusData.reduce((sum, item) => sum + item.value, 0),
    [lessonStatusData]
  );

  const bestLearningTypesData = useMemo(() => {
    const attempts = lessonsInRange
      .map((lesson) => lesson.originalAttempt || lesson.latestAttempt)
      .filter(Boolean)
      .map((attempt) => {
        const time = attempt.submittedAt ? new Date(attempt.submittedAt).getTime() : NaN;
        return Number.isFinite(time) ? { ...attempt, time } : null;
      })
      .filter(Boolean);

    const totals = {
      Reading: { score: 0, count: 0, outOf: 2 },
      Writing: { score: 0, count: 0, outOf: 10 },
      Speaking: { score: 0, count: 0, outOf: 10 },
    };

    attempts.forEach((attempt) => {
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
  }, [lessonsInRange]);

  const scoreHistoryInRange = useMemo(() => {
    if (learningRange === 'all') return scoreHistory;
    const windowMs = learningRange === '7d' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    return scoreHistory.filter((entry) => now - entry.time <= windowMs);
  }, [learningRange, scoreHistory]);

  return (
    <PageLayout title={null} role={role}>
      <div className="progress">
        <Hero
          eyebrow="Your overview"
          title="Progress"
          subtitle="View your progress"
          variant="student"
          icon={<Icon.ChartLine className="icon" />}
          action={
            <div className="progress-range-bar">
              <div className="progress-range-title">Show data for</div>
              <div className="progress-range-toggle" role="tablist" aria-label="Progress range">
                {[
                  { id: '7d', label: '7 days' },
                  { id: '30d', label: '30 days' },
                  { id: 'all', label: 'All time' },
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`progress-range-pill ${
                      learningRange === option.id ? 'active' : ''
                    }`}
                    onClick={() => setLearningRange(option.id)}
                    role="tab"
                    aria-selected={learningRange === option.id}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          }
        />

        <div className="progress-body">
          <div className="progress-grid">
            {stats.map((stat) => (
              <ProgressCard
                key={stat.label}
                icon={stat.icon}
                label={stat.label}
                value={stat.value}
                description={stat.description}
              />
            ))}
          </div>

          <div className="progress-charts">
            <div className="progress-chart-card">
              <div className="progress-chart-header">
                <div className="progress-chart-title">Score history</div>
                <div className="progress-chart-subtitle">Based on first attempts</div>
              </div>

              {loadingLessons ? (
                <div className="progress-chart-empty">Loading chart…</div>
              ) : scoreHistoryInRange.length === 0 ? (
                <div className="progress-chart-empty">No score history yet.</div>
              ) : (
                <div className="progress-chart-wrap">
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={scoreHistoryInRange} margin={{ top: 10, right: 16, left: 0, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="time"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(ms) =>
                          new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
                        }
                      />
                      <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--tooltip-bg)',
                          borderColor: 'var(--tooltip-border)',
                          color: 'var(--tooltip-text)',
                        }}
                        itemStyle={{ color: 'var(--tooltip-text)' }}
                        labelStyle={{ color: 'var(--tooltip-text)' }}
                        labelFormatter={(ms) =>
                          new Date(ms).toLocaleString(undefined, {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        }
                        formatter={(v) => [`${v}%`, 'Score']}
                      />
                      <Line type="monotone" dataKey="score" dot />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="progress-charts-row charts-row">
              <div className="progress-pie-chart-card">
                <div className="progress-chart-header">
                  <div className="progress-chart-title">Lesson status</div>
                  <div className="progress-chart-subtitle">Completed vs active vs late</div>
                </div>

                {loadingLessons ? (
                  <div className="progress-chart-empty">Loading chart…</div>
                ) : lessonsInRange.length === 0 ? (
                  <div className="progress-chart-empty">No lessons in this range.</div>
                ) : (
                  <div className="progress-pie-chart-wrap">
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={lessonStatusData}
                          dataKey="value"
                          nameKey="name"
                          outerRadius={70}
                          cy="62%"
                          labelLine={false}
                        />
                        <Tooltip
                          formatter={(value, name) => [
                            lessonStatusTotal > 0
                              ? `${Math.round((Number(value) / lessonStatusTotal) * 100)}%`
                              : '0%',
                            name,
                          ]}
                          contentStyle={{
                            background: 'var(--tooltip-bg)',
                            borderColor: 'var(--tooltip-border)',
                            color: 'var(--tooltip-text)',
                            fontSize: '0.8rem',
                            padding: '6px 8px',
                          }}
                          itemStyle={{ color: 'var(--tooltip-text)' }}
                          labelStyle={{ color: 'var(--tooltip-text)' }}
                        />
                        <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: 32 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="progress-bar-chart-card">
                <div className="progress-mini-title">Best performing learning types</div>
                {loadingLessons ? (
                  <div className="progress-chart-empty">Loading chart…</div>
                ) : lessonsInRange.length === 0 ? (
                  <div className="progress-chart-empty">No learning type data in this range.</div>
                ) : (
                  <div className="progress-bar-chart-wrap">
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart
                        data={bestLearningTypesData}
                        margin={{ top: 10, right: 10, left: 0, bottom: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="type" />
                        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                        <Tooltip formatter={(v) => [`${v}%`, 'Score']} />
                        <Bar dataKey="percent" radius={[8, 8, 0, 0]} fill="var(--progress-bar-fill)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

export default Progress;
