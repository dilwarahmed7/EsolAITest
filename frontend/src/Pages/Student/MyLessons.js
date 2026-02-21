import React, { useEffect, useMemo, useRef, useState } from 'react';
import PageLayout from '../../Components/PageLayout';
import Hero from '../../Components/Hero';
import DataGrid from '../../Components/DataGrid';
import Icon from '../../Components/Icons';
import { useToast } from '../../Components/ToastProvider';
import './MyLessons.css';

const API_ORIGIN = process.env.REACT_APP_API_ORIGIN || 'http://localhost:5144';
const API_BASE = `${API_ORIGIN}/api/student/lessons`;
const FALLBACK_OUT_OF = 22;
const PAGE_SIZE = 10;
const HIDE_AI_CHANGES_REGEX = /\[\s*HIDE[\s_-]*AI[\s_-]*CHANGES\s*\]/gi;

const hasHideAiChangesMarker = (text) =>
  typeof text === 'string' && /\[\s*HIDE[\s_-]*AI[\s_-]*CHANGES\s*\]/i.test(text);

const removeHideAiChangesMarker = (text) =>
  typeof text === 'string' ? text.replace(HIDE_AI_CHANGES_REGEX, '').trim() : '';

const formatDate = (raw) => {
  if (!raw) return 'No due date';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return 'No due date';
  return d.toLocaleDateString();
};

const normaliseLesson = (lesson) => {
  const scoreOutOf = lesson.scoreOutOf || lesson.ScoreOutOf || FALLBACK_OUT_OF;
  const active = lesson.activeAttempt || lesson.ActiveAttempt;
  const latest = lesson.latestAttempt || lesson.LatestAttempt;
  const original = lesson.originalAttempt || lesson.OriginalAttempt;
  const retry = lesson.retryAttempt || lesson.RetryAttempt;
  const retryAllowed = lesson.retryAllowed ?? lesson.RetryAllowed ?? false;

  const normaliseAttempt = (raw) => {
    if (!raw) return null;
    return {
      attemptId: raw.attemptId || raw.AttemptId,
      submittedAt: raw.submittedAt || raw.SubmittedAt,
      readingScore: raw.readingScore ?? raw.ReadingScore ?? 0,
      writingScore: raw.writingScore ?? raw.WritingScore ?? 0,
      speakingScore: raw.speakingScore ?? raw.SpeakingScore ?? 0,
      totalScore: raw.totalScore ?? raw.TotalScore ?? 0,
      reviewStatus: raw.reviewStatus || raw.ReviewStatus || 'Pending',
      needsTeacherReview: raw.needsTeacherReview ?? raw.NeedsTeacherReview ?? false,
      teacherReviewCompleted: raw.teacherReviewCompleted ?? raw.TeacherReviewCompleted ?? false,
    };
  };

  return {
    id: lesson.id || lesson.Id,
    title: lesson.title || lesson.Title,
    dueDate: lesson.dueDate || lesson.DueDate,
    status: lesson.status || lesson.Status,
    scoreOutOf,
    retryAllowed,
    originalAttempt: normaliseAttempt(original),
    retryAttempt: normaliseAttempt(retry),
    activeAttempt: active
      ? {
          attemptId: active.attemptId || active.AttemptId,
          startedAt: active.startedAt || active.StartedAt,
        }
      : null,
    latestAttempt: normaliseAttempt(latest),
  };
};

const computeStatus = (lesson) => {
  if (lesson.latestAttempt) return 'Completed';
  const due = lesson.dueDate;
  const dueTime = due ? new Date(due).getTime() : NaN;
  if (!Number.isNaN(dueTime) && dueTime < Date.now()) return 'Late';
  return 'Active';
};

const mapQuestionsFromDetail = (detail) => detail?.Questions || detail?.questions || [];
const mapAttemptMeta = (detail) => detail?.Attempt || detail?.attempt || {};
const mapLessonMeta = (detail) => detail?.Lesson || detail?.lesson || {};

const buildResponseState = (detail) => {
  const questions = mapQuestionsFromDetail(detail);
  const initial = {};
  questions.forEach((q) => {
    const resp = q.Response || q.response;
    const key = q.Id || q.id;
    const type = q.Type || q.type;
    if (type === 'Reading') {
      initial[key] = {
        selectedOptionId: resp?.SelectedOptionId ?? resp?.selectedOptionId ?? null,
      };
    } else {
      initial[key] = {
        responseText: resp?.ResponseText ?? resp?.responseText ?? '',
      };
    }
  });
  return initial;
};

const parseAiChanges = (text) => {
  if (!text) return [];
  const marker = 'Changes:';
  const idx = text.indexOf(marker);
  if (idx === -1) return [];
  const jsonPart = text.slice(idx + marker.length).trim();
  try {
    const parsed = JSON.parse(jsonPart);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const stripChangesText = (text) => {
  if (!text) return '';
  const withoutHideMarker = removeHideAiChangesMarker(text);
  const idx = withoutHideMarker.indexOf('Changes:');
  return idx === -1 ? withoutHideMarker : withoutHideMarker.slice(0, idx).trim();
};

const parseChangeLines = (text) => {
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const startIdx = lines.findIndex((l) => l.toLowerCase().includes('changes detected'));
  if (startIdx === -1) return [];

  const results = [];
  const changeLineRegex =
    /^(?:\d+\.\s*)?\(?([^)]+?)\)?\s*['"“”]?(.*?)['"“”]?\s*(?:→|->)\s*['"“”]?(.*?)['"“”]?$/;

  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(changeLineRegex);
    if (match) {
      results.push({
        type: match[1].replace(/^\(/, '').replace(/\)$/, ''),
        from: match[2],
        to: match[3],
      });
      continue;
    }

    const arrowIdx = line.indexOf('→') !== -1 ? line.indexOf('→') : line.indexOf('->');
    if (arrowIdx !== -1) {
      const left = line.slice(0, arrowIdx).replace(/^\d+\.\s*/, '').trim().replace(/['"“”]/g, '');
      const right = line.slice(arrowIdx + (line.includes('→') ? 1 : 2)).trim().replace(/['"“”]/g, '');
      if (left || right) {
        results.push({
          type: 'change',
          from: left,
          to: right,
        });
      }
    }
  }

  return results;
};

const changesFromFeedback = (feedback) => {
  if (!feedback) return [];
  const teacherFeedback = feedback.TeacherFeedback || feedback.teacherFeedback || '';
  if (hasHideAiChangesMarker(teacherFeedback)) return [];

  const raw = feedback.changes ?? feedback.Changes ?? null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
    }
  }

  const combinedText =
    (feedback.TeacherFeedback || feedback.teacherFeedback || '') +
    '\n' +
    (feedback.AiFeedback || feedback.aiFeedback || '') +
    '\n' +
    (feedback.AiCorrections || feedback.aiCorrections || '');

  const jsonChanges = parseAiChanges(combinedText);
  if (jsonChanges.length > 0) return jsonChanges;

  return parseChangeLines(combinedText);
};

const deriveScores = (detail) => {
  if (!detail) return { reading: 0, writing: 0, speaking: 0, total: null };
  const attemptMeta = mapAttemptMeta(detail) || {};
  const questions = mapQuestionsFromDetail(detail);

  let reading = 0;
  let writing = null;
  let speaking = null;

  questions.forEach((q) => {
    const resp = q.Response || q.response;
    if (!resp) return;
    const type = q.Type || q.type;
    if (type === 'Reading') {
      const score = Number(resp.Score ?? resp.score ?? 0);
      reading += Number.isFinite(score) ? score : 0;
    } else if (type === 'Writing') {
      const feedback = resp.Feedback || resp.feedback || {};
      const teacherScore = feedback.TeacherScore ?? feedback.teacherScore;
      const score = Number(
        teacherScore ?? resp.AiScore ?? resp.aiScore ?? resp.Score ?? resp.score ?? attemptMeta.WritingScore ?? attemptMeta.writingScore ?? 0
      );
      if (Number.isFinite(score)) writing = (writing ?? 0) + score;
    } else if (type === 'Speaking') {
      const feedback = resp.Feedback || resp.feedback || {};
      const teacherScore = feedback.TeacherScore ?? feedback.teacherScore;
      const score = Number(
        teacherScore ?? resp.AiScore ?? resp.aiScore ?? resp.Score ?? resp.score ?? attemptMeta.SpeakingScore ?? attemptMeta.speakingScore ?? 0
      );
      if (Number.isFinite(score)) speaking = (speaking ?? 0) + score;
    }
  });

  if (writing === null) writing = attemptMeta.WritingScore ?? attemptMeta.writingScore ?? 0;
  if (speaking === null) speaking = attemptMeta.SpeakingScore ?? attemptMeta.speakingScore ?? 0;

  const total = Number.isFinite(reading + writing + speaking)
    ? reading + writing + speaking
    : attemptMeta.TotalScore ?? attemptMeta.totalScore ?? null;

  return { reading, writing, speaking, total };
};

function MyLessons({ role }) {
  const token = useMemo(() => sessionStorage.getItem('token') || localStorage.getItem('token'), []);
  const toast = useToast();
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [attemptDetail, setAttemptDetail] = useState(null);
  const [activeLesson, setActiveLesson] = useState(null);
  const [responses, setResponses] = useState({});
  const [modalMode, setModalMode] = useState('work');
  const [selectedFeedbackAttempt, setSelectedFeedbackAttempt] = useState('original');
  const [loadingAttempt, setLoadingAttempt] = useState(false);
  const [savingProgress, setSavingProgress] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attemptMessage, setAttemptMessage] = useState('');
  const [lessonView, setLessonView] = useState('todo');
  const [activeFilter, setActiveFilter] = useState('all');
  const [completedFilter, setCompletedFilter] = useState('all');
  const [activeNameFilter, setActiveNameFilter] = useState('');
  const [completedNameFilter, setCompletedNameFilter] = useState('');
  const [activeSortKey, setActiveSortKey] = useState('due');
  const [activeSortDir, setActiveSortDir] = useState('asc');
  const [completedSortKey, setCompletedSortKey] = useState('completedAt');
  const [completedSortDir, setCompletedSortDir] = useState('desc');
  const [completedScoreFilter, setCompletedScoreFilter] = useState('all');
  const [activePage, setActivePage] = useState(1);
  const [completedPage, setCompletedPage] = useState(1);

  const [micError, setMicError] = useState('');
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const listeningQuestionRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicError('Microphone capture is not available in this browser.');
      return () => {};
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      if (!listeningQuestionRef.current) return;
      const last = event.results[event.results.length - 1];
      const chunk = last[0].transcript;
      const questionId = listeningQuestionRef.current;

      setResponses((prev) => {
        const existing = prev[questionId]?.responseText || '';
        return {
          ...prev,
          [questionId]: {
            ...(prev[questionId] || {}),
            responseText: `${existing} ${chunk}`.trim(),
          },
        };
      });
    };

    recognition.onerror = () => {
      setMicError('Mic error. Please check permissions and try again.');
      setListening(false);
      listeningQuestionRef.current = null;
    };
    recognition.onend = () => {
      setListening(false);
      listeningQuestionRef.current = null;
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.stop();
    };
  }, []);

  const refreshLessons = async () => {
    try {
      const res = await fetch(API_BASE, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setLessons(Array.isArray(data) ? data.map(normaliseLesson) : []);
    } catch {
    }
  };

  useEffect(() => {
    const load = async () => {
      if (!token) {
        setError('Please sign in again.');
        toast.error('Please sign in again.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');
      try {
        const res = await fetch(API_BASE, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error((await res.text()) || 'Unable to load lessons.');

        const data = await res.json();
        const normalised = Array.isArray(data) ? data.map(normaliseLesson) : [];
        setLessons(normalised);
      } catch (err) {
        console.error(err);
        setError(err.message || 'Failed to load lessons.');
        toast.error(err.message || 'Failed to load lessons.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [token, toast]);

  useEffect(() => {
    if (lessonView === 'todo') {
      setActiveSortKey('due');
      setActiveSortDir('asc');
      return;
    }
    if (lessonView === 'completed') {
      setCompletedSortKey('completedAt');
      setCompletedSortDir('desc');
    }
  }, [lessonView]);

  const rows = lessons.map((lesson) => ({
    ...lesson,
    computedStatus: computeStatus(lesson),
  }));

  const activeRows = rows.filter((r) => r.computedStatus !== 'Completed');
  const completedRows = rows.filter((r) => r.computedStatus === 'Completed');
  const filteredActiveRows = activeRows.filter((lesson) => {
    if (activeFilter === 'all') return true;
    return lesson.computedStatus.toLowerCase() === activeFilter;
  }).filter((lesson) => {
    if (!activeNameFilter.trim()) return true;
    const name = (lesson.title || '').toLowerCase();
    return name.includes(activeNameFilter.trim().toLowerCase());
  });
  const filteredCompletedRows = completedRows.filter((lesson) => {
    if (completedFilter === 'all') return true;
    const reviewStatus = lesson.latestAttempt?.reviewStatus?.toLowerCase();
    return (reviewStatus || 'pending') === completedFilter;
  }).filter((lesson) => {
    if (!completedNameFilter.trim()) return true;
    const name = (lesson.title || '').toLowerCase();
    return name.includes(completedNameFilter.trim().toLowerCase());
  }).filter((lesson) => {
    if (completedScoreFilter === 'all') return true;
    const attempt = lesson.originalAttempt || lesson.latestAttempt;
    const total = attempt?.totalScore;
    if (completedScoreFilter === 'unscored') return typeof total !== 'number';
    if (typeof total !== 'number') return false;
    const outOf = lesson.scoreOutOf || FALLBACK_OUT_OF;
    const percent = outOf > 0 ? (total / outOf) * 100 : 0;
    if (completedScoreFilter === 'high') return percent >= 70;
    if (completedScoreFilter === 'low') return percent < 70;
    return true;
  });

  const sortLessons = (list, key, dir) => {
    const dirValue = dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (key === 'name') {
        return (a.title || '').localeCompare(b.title || '') * dirValue;
      }
      if (key === 'due') {
        const aTime = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bTime = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        if (aTime === bTime) return 0;
        return aTime > bTime ? dirValue : -dirValue;
      }
      if (key === 'completedAt') {
        const aTime = a.latestAttempt?.submittedAt ? new Date(a.latestAttempt.submittedAt).getTime() : -Infinity;
        const bTime = b.latestAttempt?.submittedAt ? new Date(b.latestAttempt.submittedAt).getTime() : -Infinity;
        if (aTime === bTime) return 0;
        return aTime > bTime ? dirValue : -dirValue;
      }
      return 0;
    });
  };

  const sortedActiveRows = sortLessons(filteredActiveRows, activeSortKey, activeSortDir);
  const sortedCompletedRows = sortLessons(filteredCompletedRows, completedSortKey, completedSortDir);
  const activeTotalPages = Math.max(1, Math.ceil(sortedActiveRows.length / PAGE_SIZE));
  const completedTotalPages = Math.max(1, Math.ceil(sortedCompletedRows.length / PAGE_SIZE));
  const activeStartIdx = (activePage - 1) * PAGE_SIZE;
  const completedStartIdx = (completedPage - 1) * PAGE_SIZE;
  const pagedActiveRows = sortedActiveRows.slice(activeStartIdx, activeStartIdx + PAGE_SIZE);
  const pagedCompletedRows = sortedCompletedRows.slice(completedStartIdx, completedStartIdx + PAGE_SIZE);

  const toggleActiveSort = (key) => {
    if (activeSortKey === key) {
      setActiveSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setActiveSortKey(key);
      setActiveSortDir('asc');
    }
    setActivePage(1);
  };

  const toggleCompletedSort = (key) => {
    if (completedSortKey === key) {
      setCompletedSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setCompletedSortKey(key);
      setCompletedSortDir('asc');
    }
    setCompletedPage(1);
  };
  const nextDueLabel = useMemo(() => {
    const dueDates = activeRows
      .map((lesson) => lesson.dueDate)
      .filter(Boolean)
      .map((raw) => new Date(raw))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => a - b);

    if (!dueDates.length) return 'No upcoming due date';
    return formatDate(dueDates[0]);
  }, [activeRows]);

  const stopListening = () => {
    if (recognitionRef.current && listening) {
      recognitionRef.current.stop();
    }
  };

  const closeModal = () => {
    stopListening();
    setAttemptDetail(null);
    setResponses({});
    setActiveLesson(null);
    setModalMode('work');
    setSelectedFeedbackAttempt('original');
    setAttemptMessage('');
    setMicError('');
  };

  const fetchAttemptDetail = async (lessonId, attemptId, forceFeedback = false) => {
    setAttemptMessage('');
    const res = await fetch(`${API_BASE}/${lessonId}/attempts/${attemptId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error((await res.text()) || 'Could not load attempt.');
    const data = await res.json();
    setAttemptDetail(data);
    setResponses(buildResponseState(data));
    const attemptMeta = mapAttemptMeta(data);
    const submittedAt = attemptMeta.submittedAt || attemptMeta.SubmittedAt;
    setModalMode(forceFeedback || submittedAt ? 'feedback' : 'work');
  };

  const openAttempt = async (lesson, attemptId = null, viewFeedback = false) => {
    if (!lesson) return;
    if (!token) {
      setError('Please sign in again.');
      toast.error('Please sign in again.');
      return;
    }

    setLoadingAttempt(true);
    setError('');
    setActiveLesson(lesson);
    try {
      let targetAttemptId = attemptId || lesson?.activeAttempt?.attemptId;
      let startedAt = lesson?.activeAttempt?.startedAt;

      if (viewFeedback) {
        if (lesson?.originalAttempt?.attemptId) {
          targetAttemptId = lesson.originalAttempt.attemptId;
          setSelectedFeedbackAttempt('original');
        } else if (lesson?.retryAttempt?.attemptId) {
          targetAttemptId = lesson.retryAttempt.attemptId;
          setSelectedFeedbackAttempt('retry');
        }
      }

      if (!targetAttemptId && !viewFeedback) {
        const startRes = await fetch(`${API_BASE}/${lesson.id}/start`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!startRes.ok) throw new Error((await startRes.text()) || 'Could not start lesson.');
        const startData = await startRes.json();
        targetAttemptId = startData.attemptId || startData.AttemptId;
        startedAt = startData.startedAt || startData.StartedAt;

        if (targetAttemptId) {
          setLessons((prev) =>
            prev.map((l) =>
              l.id === lesson.id
                ? { ...l, activeAttempt: { attemptId: targetAttemptId, startedAt } }
                : l
            )
          );
        }
      }

      if (!targetAttemptId) throw new Error('No attempt found for this lesson yet.');

      setActiveLesson(lesson);
      await fetchAttemptDetail(lesson.id, targetAttemptId, viewFeedback);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to open lesson.');
      toast.error(err.message || 'Failed to open lesson.');
      closeModal();
    } finally {
      setLoadingAttempt(false);
    }
  };

  const handleAnswerChange = (questionId, payload) => {
    setResponses((prev) => ({
      ...prev,
      [questionId]: {
        ...(prev[questionId] || {}),
        ...payload,
      },
    }));
  };

  const buildSubmissionPayload = () => {
    if (!attemptDetail) return [];
    const questions = mapQuestionsFromDetail(attemptDetail);
    return questions.map((q) => {
      const key = q.Id || q.id;
      const type = q.Type || q.type;
      const state = responses[key] || {};
      return {
        lessonQuestionId: key,
        selectedOptionId: type === 'Reading' ? state.selectedOptionId ?? null : null,
        responseText: type === 'Reading' ? null : state.responseText || '',
      };
    });
  };

  const handleSaveForLater = async () => {
    if (!attemptDetail) return;
    const attemptMeta = mapAttemptMeta(attemptDetail);
    const lessonMeta = mapLessonMeta(attemptDetail);
    const lessonId = lessonMeta.Id || lessonMeta.id || activeLesson?.id;
    const attemptId = attemptMeta.AttemptId || attemptMeta.attemptId || attemptMeta.Id;

    setAttemptMessage('');
    setSavingProgress(true);
    try {
      const payload = {
        attemptId,
        responses: buildSubmissionPayload(),
      };
      const res = await fetch(`${API_BASE}/${lessonId}/progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.text()) || 'Could not save progress.');
      setAttemptMessage('Progress saved. You can continue later from the lessons list.');
      toast.success('Progress saved.');
      await fetchAttemptDetail(lessonId, attemptId, false);
      await refreshLessons();
      closeModal();
    } catch (err) {
      console.error(err);
      setAttemptMessage(err.message || 'Failed to save progress.');
      toast.error(err.message || 'Failed to save progress.');
    } finally {
      setSavingProgress(false);
    }
  };

  const handleSubmit = async () => {
    if (!attemptDetail) return;
    const attemptMeta = mapAttemptMeta(attemptDetail);
    const lessonMeta = mapLessonMeta(attemptDetail);
    const lessonId = lessonMeta.Id || lessonMeta.id || activeLesson?.id;
    const attemptId = attemptMeta.AttemptId || attemptMeta.attemptId || attemptMeta.Id;

    const responsesPayload = buildSubmissionPayload();
    const questions = mapQuestionsFromDetail(attemptDetail);

    const missing = questions.find((q, idx) => {
      const type = q.Type || q.type;
      const resp = responsesPayload[idx];
      if (type === 'Reading') return !resp.selectedOptionId;
      return !(resp.responseText && resp.responseText.trim());
    });

    if (missing) {
      setAttemptMessage('Please answer every question before submitting.');
      toast.info('Please answer every question before submitting.');
      return;
    }

    setAttemptMessage('');
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/${lessonId}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ attemptId, responses: responsesPayload }),
      });
      if (!res.ok) throw new Error((await res.text()) || 'Could not submit attempt.');
      const data = await res.json();
      setAttemptDetail(data);
      setResponses(buildResponseState(data));
      setModalMode('feedback');
      setAttemptMessage('Submitted! Instant feedback is ready below.');
      toast.success('Lesson submitted successfully.');
      await refreshLessons();
    } catch (err) {
      console.error(err);
      setAttemptMessage(err.message || 'Failed to submit attempt.');
      toast.error(err.message || 'Failed to submit attempt.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleMic = (questionId) => {
    setMicError('');
    if (!recognitionRef.current) {
      setMicError('Mic not available in this browser.');
      return;
    }

    if (listening && listeningQuestionRef.current === questionId) {
      recognitionRef.current.stop();
      return;
    }

    if (listening) {
      recognitionRef.current.stop();
    }

    listeningQuestionRef.current = questionId;
    try {
      recognitionRef.current.start();
      setListening(true);
    } catch (err) {
      console.error(err);
      setMicError('Unable to start microphone.');
    }
  };

  const renderQuestion = (q) => {
    const key = q.Id || q.id;
    const type = q.Type || q.type;
    const resp = q.Response || q.response;
    const inFeedback = modalMode === 'feedback';
    const answerOptions = q.AnswerOptions || q.answerOptions || [];
    const correctOptionId = q.CorrectOptionId || q.correctOptionId || null;

    if (type === 'Reading') {
      const selected = responses[key]?.selectedOptionId ?? null;
      return (
        <div className="question-card" key={key}>
          <div className="question-head">
            <div>
              <p className="eyebrow">Reading</p>
              <h4>{q.Prompt || q.prompt}</h4>
            </div>
            {inFeedback && resp ? (
              <span className={`chip-small ${resp.IsCorrect || resp.isCorrect ? 'success' : 'danger'}`}>
                {resp.IsCorrect || resp.isCorrect ? 'Correct' : 'Incorrect'}
              </span>
            ) : null}
          </div>
          <div className="reading-snippet">{q.ReadingSnippet || q.readingSnippet}</div>
          <div className="options-grid">
            {answerOptions.map((opt) => {
              const id = opt.Id || opt.id;
              const isSelected = selected === id;
              const isCorrect = correctOptionId && correctOptionId === id;
              const showCorrect = inFeedback && (isCorrect || isSelected);
              return (
                <label
                  key={id}
                  className={`option-tile ${isSelected ? 'selected' : ''} ${
                    showCorrect && isCorrect ? 'correct' : ''
                  } ${showCorrect && !isCorrect && isSelected ? 'incorrect' : ''}`}
                >
                  <input
                    type="radio"
                    name={`reading-${key}`}
                    checked={isSelected}
                    disabled={inFeedback}
                    onChange={() => handleAnswerChange(key, { selectedOptionId: id })}
                  />
                  <span>{opt.Text || opt.text}</span>
                  {showCorrect ? (
                    <span className="pill tiny">{isCorrect ? 'Correct answer' : 'Your choice'}</span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>
      );
    }

    const currentText = responses[key]?.responseText || '';
    const feedback = resp?.Feedback || resp?.feedback;
    const teacherScore = feedback?.TeacherScore ?? feedback?.teacherScore;
    const aiScore = resp?.AiScore ?? resp?.aiScore ?? null;
    const scoreLabel = teacherScore != null ? `${teacherScore}/10` : aiScore != null ? `${aiScore}/10` : '—';
    const isFinalScore =
      teacherScore != null || attemptMeta.TeacherReviewCompleted || attemptMeta.teacherReviewCompleted;
    const isSpeaking = type === 'Speaking';
    const changes = changesFromFeedback(feedback);
    const correctedSentence = feedback?.AiCorrections || feedback?.aiCorrections || 'No corrections suggested.';
    const feedbackText = stripChangesText(
      feedback?.TeacherFeedback || feedback?.teacherFeedback || feedback?.AiFeedback || feedback?.aiFeedback
    );

    return (
      <div className="question-card" key={key}>
        <div className="question-head">
          <div>
            <p className="eyebrow">{type}</p>
            <h4>{q.Prompt || q.prompt}</h4>
          </div>
          {inFeedback && (
            <span className="chip-small info">{isFinalScore ? 'Final score' : 'Provisional score'}: {scoreLabel}</span>
          )}
        </div>
        <div className="text-response">
          <textarea
            rows={4}
            value={currentText}
            onChange={(e) => handleAnswerChange(key, { responseText: e.target.value })}
            disabled={inFeedback}
            placeholder={isSpeaking ? 'Tap the mic and start speaking…' : 'Type your response'}
          />
          {isSpeaking ? (
            <button
              type="button"
              className={`ghost-btn mic-btn ${listening && listeningQuestionRef.current === key ? 'active' : ''}`}
              onClick={() => toggleMic(key)}
              disabled={inFeedback}
            >
              <Icon.Microphone className="icon" />
              {listening && listeningQuestionRef.current === key ? 'Listening…' : 'Speak'}
            </button>
          ) : null}
        </div>
        {inFeedback && feedback ? (
          <div className="feedback-block">
            <div className="feedback-highlight corrected">
              <p className="feedback-label">Corrected sentence</p>
              <p className="feedback-content corrected-text">{correctedSentence}</p>
            </div>
            <div className="feedback-highlight teacher">
              <p className="feedback-label">Teacher feedback</p>
              <p className="feedback-content">{feedbackText || 'No teacher feedback provided.'}</p>
            </div>
            {changes.length > 0 ? (
              <div className="change-list">
                {changes.map((c, idx) => (
                  <div className="change-row" key={`${key}-change-${idx}`}>
                    <span className="pill tiny">{(c.type || c.Type || 'change').toString()}</span>
                    <div className="change-body">
                      <div className="change-from">
                        <span className="muted">From</span>
                        <strong>{c.from || c.From || ''}</strong>
                      </div>
                      <span className="arrow">→</span>
                      <div className="change-to">
                        <span className="muted">To</span>
                        <strong>{c.to || c.To || ''}</strong>
                      </div>
                    </div>
                    {c.error_type || c.errorType || c.ErrorType ? (
                      <div className="change-meta">
                        <span className="muted">Error type</span>
                        <strong>{c.error_type || c.errorType || c.ErrorType}</strong>
                      </div>
                    ) : null}
                    {c.micro_feedback || c.microFeedback || c.MicroFeedback ? (
                      <div className="change-note">
                        <span className="muted">Micro feedback</span>
                        <p className="micro-feedback">
                          {c.micro_feedback || c.microFeedback || c.MicroFeedback}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const attemptMeta = attemptDetail ? mapAttemptMeta(attemptDetail) : {};
  const lessonMeta = attemptDetail ? mapLessonMeta(attemptDetail) : {};
  const scoreOutOf =
    attemptMeta.ScoreOutOf ??
    attemptMeta.scoreOutOf ??
    activeLesson?.scoreOutOf ??
    FALLBACK_OUT_OF;
  const awaitingReview = attemptMeta.needsTeacherReview && !attemptMeta.teacherReviewCompleted;
  const derivedScores = deriveScores(attemptDetail);
  const totalScore = derivedScores.total ?? attemptMeta.TotalScore ?? attemptMeta.totalScore;
  const retryAllowed = activeLesson?.retryAllowed ?? false;
  const originalAttemptId = activeLesson?.originalAttempt?.attemptId;
  const retryAttemptId = activeLesson?.retryAttempt?.attemptId;

  return (
    <PageLayout title={null} role={role}>
      <div className="student-lessons">
        <Hero
          eyebrow="Assigned to you"
          title="My Lessons"
          subtitle="Work through your lessons."
          variant="student"
          icon={<Icon.BookOpen className="icon" />}
          meta={[
            {
              label: `${activeRows.length} active`,
              icon: <Icon.List className="mini-icon" />,
            },
            {
              label: `${completedRows.length} completed`,
              tone: 'ghost',
              icon: <Icon.CheckCircle className="mini-icon" />,
            },
            {
              label: `Next due: ${nextDueLabel}`,
              tone: 'subtle',
              icon: <Icon.Calendar className="mini-icon" />,
            },
          ]}
        />

        {error ? <div className="notice error">{error}</div> : null}

        <div className="data-card">
          <div className="data-header">
            <div>
              <div className="left-actions">
                <h3 className="section-title">
                  <span className="section-icon">
                    <Icon.List className="icon" />
                  </span>
                  Lessons
                </h3>
                <div className="toggle-row" role="tablist" aria-label="Lesson view">
                  <button
                    type="button"
                    className={`ghost-btn small ${lessonView === 'todo' ? 'active' : ''}`}
                    onClick={() => {
                      setLessonView('todo');
                      setActivePage(1);
                    }}
                    role="tab"
                    aria-selected={lessonView === 'todo'}
                  >
                    To Do
                  </button>
                  <button
                    type="button"
                    className={`ghost-btn small ${lessonView === 'completed' ? 'active' : ''}`}
                    onClick={() => {
                      setLessonView('completed');
                      setCompletedPage(1);
                    }}
                    role="tab"
                    aria-selected={lessonView === 'completed'}
                  >
                    Completed
                  </button>
                </div>
              </div>
              <p className="section-subtitle">
                {loading
                  ? 'Loading lessons…'
                  : lessonView === 'completed'
                  ? `${filteredCompletedRows.length} of ${completedRows.length} lesson${completedRows.length === 1 ? '' : 's'}`
                  : `${filteredActiveRows.length} of ${activeRows.length} lesson${activeRows.length === 1 ? '' : 's'}`}
              </p>
            </div>
            <div className="filter-row">
              <input
                type="text"
                className="filter-input"
                placeholder={lessonView === 'completed' ? 'Search in Completed' : 'Search in To Do'}
                value={lessonView === 'completed' ? completedNameFilter : activeNameFilter}
                onChange={(e) => {
                  if (lessonView === 'completed') {
                    setCompletedNameFilter(e.target.value);
                    setCompletedPage(1);
                  } else {
                    setActiveNameFilter(e.target.value);
                    setActivePage(1);
                  }
                }}
              />
              <button
                type="button"
                className={`ghost-btn small ${
                  lessonView === 'completed'
                    ? completedSortKey === 'name'
                      ? 'active'
                      : ''
                    : activeSortKey === 'name'
                    ? 'active'
                    : ''
                }`}
                onClick={() => (lessonView === 'completed' ? toggleCompletedSort('name') : toggleActiveSort('name'))}
              >
                Name{' '}
                {lessonView === 'completed'
                  ? completedSortKey === 'name'
                    ? completedSortDir === 'asc'
                      ? '↑'
                      : '↓'
                    : ''
                  : activeSortKey === 'name'
                  ? activeSortDir === 'asc'
                    ? '↑'
                    : '↓'
                  : ''}
              </button>
              {lessonView === 'completed' ? (
                <>
                  <button
                    type="button"
                    className={`ghost-btn small ${completedSortKey === 'completedAt' ? 'active' : ''}`}
                    onClick={() => toggleCompletedSort('completedAt')}
                  >
                    Completion date {completedSortKey === 'completedAt' ? (completedSortDir === 'asc' ? '↑' : '↓') : ''}
                  </button>
                  <select
                    className="status-select"
                    value={completedFilter}
                    onChange={(e) => {
                      setCompletedFilter(e.target.value);
                      setCompletedPage(1);
                    }}
                  >
                    <option value="all">All reviews</option>
                    <option value="pending">Pending</option>
                    <option value="reviewed">Reviewed</option>
                  </select>
                  <select
                    className="status-select"
                    value={completedScoreFilter}
                    onChange={(e) => {
                      setCompletedScoreFilter(e.target.value);
                      setCompletedPage(1);
                    }}
                  >
                    <option value="all">All scores</option>
                    <option value="high">70% and up</option>
                    <option value="low">Below 70%</option>
                    <option value="unscored">Unscored</option>
                  </select>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={`ghost-btn small ${activeSortKey === 'due' ? 'active' : ''}`}
                    onClick={() => toggleActiveSort('due')}
                  >
                    Due date {activeSortKey === 'due' ? (activeSortDir === 'asc' ? '↑' : '↓') : ''}
                  </button>
                  <select
                    className="status-select"
                    value={activeFilter}
                    onChange={(e) => {
                      setActiveFilter(e.target.value);
                      setActivePage(1);
                    }}
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="late">Late</option>
                  </select>
                </>
              )}
            </div>
          </div>

          <DataGrid
            loading={loading}
            emptyMessage={lessonView === 'completed' ? 'No completed lessons yet.' : 'No active lessons.'}
            className="lessons-grid"
            columns={
              lessonView === 'completed'
                ? [
                    {
                      title: (
                        <span className="col-title">
                          <Icon.BookOpen className="col-icon" />
                          Name
                        </span>
                      ),
                      width: '1.6fr',
                    },
                    {
                      title: (
                        <span className="col-title">
                          <Icon.Medal className="col-icon" />
                          Score
                        </span>
                      ),
                      align: 'center',
                      width: '1fr',
                    },
                    {
                      title: (
                        <span className="col-title">
                          <Icon.ClipboardCheck className="col-icon" />
                          Review
                        </span>
                      ),
                      align: 'center',
                      width: '1fr',
                    },
                    { title: '', align: 'right', width: '0.9fr' },
                  ]
                : [
                    {
                      title: (
                        <span className="col-title">
                          <Icon.BookOpen className="col-icon" />
                          Name
                        </span>
                      ),
                      width: '1.6fr',
                    },
                    {
                      title: (
                        <span className="col-title">
                          <Icon.Calendar className="col-icon" />
                          Due date
                        </span>
                      ),
                      align: 'center',
                      width: '1fr',
                    },
                    {
                      title: (
                        <span className="col-title">
                          <Icon.Signal className="col-icon" />
                          Status
                        </span>
                      ),
                      align: 'center',
                      width: '1fr',
                    },
                    { title: '', align: 'right', width: '0.9fr' },
                  ]
            }
            rows={
              lessonView === 'completed'
                ? pagedCompletedRows.map((lesson) => {
                    const latestAttempt = lesson.latestAttempt;
                    const primaryAttempt = lesson.originalAttempt || latestAttempt;
                    const retryAttempt = lesson.retryAttempt;
                    const retryAllowed = lesson.retryAllowed ?? false;
                    const scoreOutOf = lesson.scoreOutOf || FALLBACK_OUT_OF;
                    const primaryPercent =
                      primaryAttempt && typeof primaryAttempt.totalScore === 'number' && scoreOutOf > 0
                        ? Math.round((primaryAttempt.totalScore / scoreOutOf) * 100)
                        : null;
                    const retryPercent =
                      retryAttempt && typeof retryAttempt.totalScore === 'number' && scoreOutOf > 0
                        ? Math.round((retryAttempt.totalScore / scoreOutOf) * 100)
                        : null;
                    const percentTone =
                      primaryPercent == null
                        ? 'neutral'
                        : primaryPercent >= 70
                        ? 'good'
                        : primaryPercent >= 50
                        ? 'mid'
                        : 'low';

                    return {
                      key: lesson.id,
                      onDoubleClick: latestAttempt
                        ? () => openAttempt(lesson, latestAttempt?.attemptId, true)
                        : undefined,
                      cells: [
                        <div className="cell-strong lesson-title">
                          <span className="lesson-title-icon">
                            <Icon.BookOpen className="icon" />
                          </span>
                          <span>{lesson.title}</span>
                        </div>,
                        <div className="score-stack center">
                          <span className={`score-pill ${percentTone}`}>
                            {primaryPercent != null ? `${primaryPercent}%` : '—'}
                          </span>
                          {retryPercent !== null ? (
                            <div className="muted small-text">Retry: {retryPercent}%</div>
                          ) : null}
                        </div>,
                        <div className="center">
                          <span
                            className={`status-pill ${
                              latestAttempt?.reviewStatus?.toLowerCase() === 'reviewed' ? 'reviewed' : 'pending'
                            }`}
                          >
                            {latestAttempt?.reviewStatus || 'Pending'}
                          </span>
                        </div>,
                        <div className="table-actions gap-small actions-cell">
                          <button
                            type="button"
                            className="ghost-btn small"
                            disabled={loadingAttempt || !retryAllowed}
                            onClick={() => openAttempt(lesson)}
                          >
                            <span className="btn-icon" aria-hidden="true">
                              <Icon.Redo className="icon" />
                            </span>
                            {retryAllowed ? 'Retry lesson' : 'Retry used'}
                          </button>
                          <button
                            type="button"
                            className="primary-btn small"
                            disabled={loadingAttempt || !latestAttempt}
                            onClick={() => openAttempt(lesson, latestAttempt?.attemptId, true)}
                          >
                            <span className="btn-icon" aria-hidden="true">
                              <Icon.CommentDots className="icon" />
                            </span>
                            View feedback
                          </button>
                        </div>,
                      ],
                    };
                  })
                : pagedActiveRows.map((lesson) => {
                    const status = lesson.computedStatus;
                    const hasDraft = !!lesson.activeAttempt;
                    return {
                      key: lesson.id,
                      onDoubleClick: () =>
                        openAttempt(lesson, hasDraft ? lesson.activeAttempt.attemptId : null, false),
                      cells: [
                        <div className="cell-strong lesson-title">
                          <span className="lesson-title-icon">
                            <Icon.BookOpen className="icon" />
                          </span>
                          <span>{lesson.title}</span>
                        </div>,
                        formatDate(lesson.dueDate),
                        <div className={`status-pill center ${status.toLowerCase()}`}>{status}</div>,
                        <div className="table-actions actions-cell">
                          <button
                            type="button"
                            className="primary-btn small"
                            disabled={loadingAttempt}
                            onClick={() =>
                              openAttempt(lesson, hasDraft ? lesson.activeAttempt.attemptId : null, false)
                            }
                          >
                            <span className="btn-icon" aria-hidden="true">
                              <Icon.Play className="icon" />
                            </span>
                            {hasDraft ? 'Continue' : 'Start'}
                          </button>
                        </div>,
                      ],
                    };
                  })
            }
          />
          {(lessonView === 'completed' ? completedTotalPages : activeTotalPages) > 1 ? (
            <div className="pagination">
              <button
                type="button"
                className="ghost-btn small"
                onClick={() =>
                  lessonView === 'completed'
                    ? setCompletedPage((prev) => Math.max(1, prev - 1))
                    : setActivePage((prev) => Math.max(1, prev - 1))
                }
                disabled={lessonView === 'completed' ? completedPage === 1 : activePage === 1}
              >
                Previous
              </button>
              <span className="page-indicator">
                Page {lessonView === 'completed' ? completedPage : activePage} of{' '}
                {lessonView === 'completed' ? completedTotalPages : activeTotalPages}
              </span>
              <button
                type="button"
                className="ghost-btn small"
                onClick={() =>
                  lessonView === 'completed'
                    ? setCompletedPage((prev) => Math.min(completedTotalPages, prev + 1))
                    : setActivePage((prev) => Math.min(activeTotalPages, prev + 1))
                }
                disabled={
                  lessonView === 'completed'
                    ? completedPage === completedTotalPages
                    : activePage === activeTotalPages
                }
              >
                Next
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {attemptDetail ? (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !submitting && closeModal()}>
          <div className="modal lesson-attempt-modal">
            <div className="modal-header">
              <div>
                <p className="eyebrow">{modalMode === 'feedback' ? 'Feedback' : 'Lesson in progress'}</p>
                <h3>{lessonMeta.Title || lessonMeta.title || activeLesson?.title}</h3>
                <p className="section-subtitle">
                  {modalMode === 'feedback'
                    ? 'Review your answers and provisional AI feedback.'
                    : 'Answer each prompt below. You can save and continue later.'}
                </p>
              </div>
              <button type="button" className="ghost-btn small" onClick={closeModal} disabled={submitting}>
                Close
              </button>
            </div>

            <div className="attempt-summary">
              <div className="score-pill">
                <span>Score</span>
                <strong>{totalScore != null ? `${totalScore}/${scoreOutOf}` : '—'}</strong>
                {awaitingReview ? <span className="pill tiny muted">Provisional</span> : null}
              </div>
              <div className="pill-stack">
                <span className="pill tiny">Reading: {derivedScores.reading}/2</span>
                <span className="pill tiny">
                  Writing: {derivedScores.writing}/10 {awaitingReview ? '(provisional)' : ''}
                </span>
                <span className="pill tiny">
                  Speaking: {derivedScores.speaking}/10 {awaitingReview ? '(provisional)' : ''}
                </span>
              </div>
              {modalMode === 'feedback' && originalAttemptId && retryAttemptId ? (
                <div className="toggle-row">
                  <span className="muted small-text">Feedback for:</span>
                  <button
                    type="button"
                    className={`ghost-btn small ${selectedFeedbackAttempt === 'original' ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedFeedbackAttempt('original');
                      fetchAttemptDetail(activeLesson.id, originalAttemptId, true);
                    }}
                  >
                    First attempt
                  </button>
                  <button
                    type="button"
                    className={`ghost-btn small ${selectedFeedbackAttempt === 'retry' ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedFeedbackAttempt('retry');
                      fetchAttemptDetail(activeLesson.id, retryAttemptId, true);
                    }}
                  >
                    Retry
                  </button>
                </div>
              ) : null}
            </div>

            {attemptMessage ? <div className="notice subtle">{attemptMessage}</div> : null}
            {micError ? <div className="notice error">{micError}</div> : null}

            <div className="attempt-body">
              {loadingAttempt ? (
                <div className="muted">Loading lesson…</div>
              ) : (
                mapQuestionsFromDetail(attemptDetail).map((q) => renderQuestion(q))
              )}
            </div>

            <div className="form-actions">
              {modalMode === 'feedback' ? (
                <>
                  <button type="button" className="ghost-btn" onClick={closeModal}>
                    Done
                  </button>
                  {retryAllowed ? (
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() => openAttempt(activeLesson)}
                      disabled={loadingAttempt}
                    >
                      Retry lesson
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <button type="button" className="ghost-btn" onClick={closeModal} disabled={submitting || savingProgress}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={handleSaveForLater}
                    disabled={savingProgress || submitting}
                  >
                    {savingProgress ? 'Saving…' : 'Save & continue later'}
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={handleSubmit}
                    disabled={submitting}
                  >
                    {submitting ? 'Submitting…' : 'Submit for feedback'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </PageLayout>
  );
}

export default MyLessons;
