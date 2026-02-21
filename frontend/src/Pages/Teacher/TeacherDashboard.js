import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageLayout from '../../Components/PageLayout';
import Hero from '../../Components/Hero';
import Icon from '../../Components/Icons';
import './TeacherDashboard.css';

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

function TeacherDashboard({ role }) {
  const navigate = useNavigate();
  const teacherName = useMemo(() => {
    const stored = localStorage.getItem('user');
    const parsed = stored ? JSON.parse(stored) : {};
    const profile = parsed.profile || {};
    return profile.fullName || profile.FullName || 'Teacher';
  }, []);
  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      }),
    []
  );
  const [classes, setClasses] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingLessons, setLoadingLessons] = useState(true);
  const [summary, setSummary] = useState({ activeStudents: '--', lessonsInProgress: '--', averageScorePercent: '--' });
  const [averageTrend, setAverageTrend] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const stats = [
    {
      label: 'Active students',
      value: loadingSummary ? '…' : summary.activeStudents,
      description: 'Across your classes',
      icon: <Icon.Users />,
    },
    {
      label: 'Average score',
      value: loadingSummary ? (
        '…'
      ) : typeof summary.averageScorePercent === 'number' ? (
        <>
          {summary.averageScorePercent}%
          {averageTrend ? (
            <span className={`stat-trend ${averageTrend}`}>
              {averageTrend === 'up' ? '▲' : averageTrend === 'down' ? '▼' : '•'}
            </span>
          ) : null}
        </>
      ) : (
        summary.averageScorePercent
      ),
      description: 'First attempts only',
      icon: <Icon.ChartLine />,
    },
    {
      label: 'Lessons in progress',
      value: loadingSummary ? '…' : summary.lessonsInProgress,
      description: 'Published lessons',
      icon: <Icon.BookOpen />,
    },
  ];

  const formatDate = (raw) => {
    if (!raw) return 'No due date';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return 'No due date';
    return d.toLocaleDateString();
  };

  useEffect(() => {
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');
    if (!token) {
      setLoadingClasses(false);
      setLoadingLessons(false);
      return;
    }

    const loadClasses = async () => {
      try {
        const res = await fetch('http://localhost:5144/api/teacher/classes', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Unable to load classes.');
        const data = await res.json();
        const list = Array.isArray(data) ? data.slice(0, 5) : [];
        setClasses(list);
      } catch (err) {
        console.error(err);
        setClasses([]);
      } finally {
        setLoadingClasses(false);
      }
    };

    const loadLessons = async () => {
      try {
        const res = await fetch('http://localhost:5144/api/teacher/lessons', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Unable to load lessons.');
        const data = await res.json();
        const list = Array.isArray(data) ? data.slice(0, 5) : [];
        setLessons(list);
      } catch (err) {
        console.error(err);
        setLessons([]);
      } finally {
        setLoadingLessons(false);
      }
    };

    loadClasses();
    loadLessons();
  }, []);

  useEffect(() => {
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');
    if (!token) {
      setLoadingSummary(false);
      return;
    }
    const loadSummary = async () => {
      setLoadingSummary(true);
      try {
        const res = await fetch('http://localhost:5144/api/teacher/dashboard/summary', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setSummary({
          activeStudents: data.activeStudents ?? data.ActiveStudents ?? '--',
          lessonsInProgress: data.lessonsInProgress ?? data.LessonsInProgress ?? '--',
          averageScorePercent:
            data.averageScorePercent ?? data.AverageScorePercent ?? '--',
        });
        setAverageTrend(data.averageTrend ?? data.AverageTrend ?? null);
      } catch (err) {
        console.error(err);
        setSummary({ activeStudents: '--', lessonsInProgress: '--', averageScorePercent: '--' });
        setAverageTrend(null);
      } finally {
        setLoadingSummary(false);
      }
    };
    loadSummary();
  }, []);

  useEffect(() => {
    if (averageTrend != null) return;
    if (typeof summary.averageScorePercent !== 'number') {
      setAverageTrend(null);
      return;
    }
    const prevRaw = sessionStorage.getItem('teacherAvgScorePrev');
    const prev = prevRaw != null ? Number(prevRaw) : null;
    if (Number.isFinite(prev)) {
      const delta = summary.averageScorePercent - prev;
      if (Math.abs(delta) < 0.05) {
        setAverageTrend('flat');
      } else if (delta > 0) {
        setAverageTrend('up');
      } else {
        setAverageTrend('down');
      }
    } else {
      setAverageTrend(null);
    }
    sessionStorage.setItem('teacherAvgScorePrev', String(summary.averageScorePercent));
  }, [averageTrend, summary.averageScorePercent]);

  return (
    <PageLayout title={null} role={role}>
      <Hero
        variant="teacher"
        eyebrow={todayLabel}
        title={`Welcome back, ${teacherName}`}
        subtitle="Track class progress, publish lessons, and review student work."
        icon={<Icon.Dashboard className="icon" />}
        action={
          <button
            type="button"
            className="dash-button primary"
            onClick={() => navigate('/lessons?create=1')}
          >
            <Icon.Plus /> Create new lesson
          </button>
        }
      />

      <div className="section-header">
        <h2>Classroom at a glance</h2>
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

      <div className="quick-links-grid">
        <div className="quick-link-card lesson-card">
          <div className="quick-link-title">Quick access to lessons</div>
          <div className="quick-link-subtitle">Recently updated</div>
          <div className="lesson-list">
            {loadingLessons ? (
              <div className="class-skeleton" />
            ) : lessons.length === 0 ? (
              <div className="empty-class">No lessons yet</div>
            ) : (
              lessons.map((lesson) => (
                <button
                  key={lesson.id || lesson.Id}
                  type="button"
                  className="lesson-item"
                  onClick={() => navigate('/lessons')}
                >
                  <div className="lesson-title">{lesson.title || lesson.Title}</div>
                  <div className="lesson-meta">
                    <span className={`status-pill tiny ${String(lesson.status || lesson.Status).toLowerCase()}`}>
                      {lesson.status || lesson.Status}
                    </span>
                    <span className="muted">{formatDate(lesson.dueDate || lesson.DueDate)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
          <Link to="/lessons" className="class-link">
            Manage all lessons
          </Link>
        </div>

        <div className="quick-link-card class-card">
          <div className="quick-link-title">Quick view of classes</div>
          <div className="quick-link-subtitle">See classes and manage students</div>
          <div className="class-list">
            {loadingClasses ? (
              <div className="class-skeleton" />
            ) : classes.length === 0 ? (
              <div className="empty-class">No classes yet</div>
            ) : (
              classes.map((cls) => {
                const id = cls.id || cls.Id;
                return (
                  <button
                    key={id}
                    type="button"
                    className="class-item"
                    onClick={() => navigate(`/students?classId=${id}`)}
                  >
                    {cls.name || cls.Name}
                  </button>
                );
              })
            )}
          </div>
          <Link to="/students" className="class-link">
            Manage all classes
          </Link>
        </div>
      </div>

    </PageLayout>
  );
}

export default TeacherDashboard;
