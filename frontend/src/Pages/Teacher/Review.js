import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PageLayout from '../../Components/PageLayout';
import Hero from '../../Components/Hero';
import Icon from '../../Components/Icons';
import { useToast } from '../../Components/ToastProvider';
import './Review.css';

const API_BASE = 'http://localhost:5144/api/teacher/reviews';
const HIDE_CHANGES_REGEX = /\[\s*HIDE[\s_-]*AI[\s_-]*CHANGES\s*\]/gi;

const feedbackHasHideMarker = (text) =>
  typeof text === 'string' && /\[\s*HIDE[\s_-]*AI[\s_-]*CHANGES\s*\]/i.test(text);

const stripHideMarker = (text) => (typeof text === 'string' ? text.replace(HIDE_CHANGES_REGEX, '').trim() : '');

const parseChangesFromFeedback = (aiFeedback) => {
  if (!aiFeedback || typeof aiFeedback !== 'string') return [];
  const marker = 'Changes:';
  const idx = aiFeedback.indexOf(marker);
  if (idx === -1) return [];
  const json = aiFeedback.slice(idx + marker.length).trim();
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const makeChangeId = () => `change-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const normaliseChange = (raw = {}, hidden = false) => ({
  id: raw.id || makeChangeId(),
  type: raw.type || raw.Type || 'change',
  from: raw.from || raw.From || '',
  to: raw.to || raw.To || '',
  error_type: raw.error_type || raw.errorType || raw.ErrorType || '',
  micro_feedback: raw.micro_feedback || raw.microFeedback || raw.MicroFeedback || '',
  hidden,
});

const buildReviewState = (item) => {
  const form = {};
  const changes = {};
  if (!item || !item.responses) return { form, changes };
  item.responses.forEach((resp) => {
    const rawFeedback = resp.teacherFeedback || '';
    const hideAll = feedbackHasHideMarker(rawFeedback);
    const cleanedFeedback = stripHideMarker(rawFeedback);
    form[resp.questionResponseId] = {
      correctedText: resp.aiCorrections || '',
      teacherFeedback: cleanedFeedback,
      teacherScore: resp.teacherScore ?? (typeof resp.aiScore === 'number' ? resp.aiScore : ''),
    };
    const parsedChanges = parseChangesFromFeedback(resp.aiFeedback || '');
    changes[resp.questionResponseId] = parsedChanges.map((c) => normaliseChange(c, hideAll));
  });
  return { form, changes };
};

function Review({ role }) {
  const token = useMemo(() => sessionStorage.getItem('token') || localStorage.getItem('token'), []);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewForm, setReviewForm] = useState({});
  const [reviewChanges, setReviewChanges] = useState({});
  const toast = useToast();

  const loadReviewQueue = useCallback(async () => {
    if (!token) return;
    setReviewLoading(true);
    setReviewError('');
    try {
      const res = await fetch(API_BASE, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.text()) || 'Unable to load review queue.');
      const data = await res.json();
      const list = Array.isArray(data)
        ? data.map((item) => ({
            id: item.id || item.Id,
            lessonId: item.lessonId || item.LessonId,
            lessonTitle: item.lessonTitle || item.LessonTitle,
            submittedAt: item.submittedAt || item.SubmittedAt,
            studentName: item.studentName || item.StudentName || 'Student',
            responses: (item.responses || item.Responses || []).map((r) => ({
              questionResponseId: r.questionResponseId || r.QuestionResponseId,
              questionId: r.questionId || r.QuestionId,
              type: r.type || r.Type,
              prompt: r.prompt || r.Prompt,
              studentAnswer: r.studentAnswer || r.StudentAnswer,
              aiCorrections: r.aiCorrections || r.AiCorrections,
              aiFeedback: r.aiFeedback || r.AiFeedback,
              aiScore: r.aiScore ?? r.AiScore,
            teacherFeedback: r.teacherFeedback || r.TeacherFeedback,
            teacherScore: r.teacherScore ?? r.TeacherScore,
          })),
        }))
      : [];
    setReviewQueue(list);
    const built = buildReviewState(list[0]);
    setReviewForm(built.form);
    setReviewChanges(built.changes);
  } catch (err) {
    console.error(err);
    setReviewError(err.message || 'Failed to load review queue.');
    toast.error(err.message || 'Failed to load review queue.');
    } finally {
      setReviewLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    loadReviewQueue();
  }, [loadReviewQueue]);

  const handleReviewChange = (respId, field, value) => {
    setReviewForm((prev) => ({
      ...prev,
      [respId]: {
        ...(prev[respId] || {}),
        [field]: value,
      },
    }));
  };

  const handleChangeEdit = (respId, changeId, field, value) => {
    setReviewChanges((prev) => ({
      ...prev,
      [respId]: (prev[respId] || []).map((c) =>
        c.id === changeId ? { ...c, [field]: value } : c
      ),
    }));
  };

  const toggleChangeHidden = (respId, changeId) => {
    setReviewChanges((prev) => ({
      ...prev,
      [respId]: (prev[respId] || []).map((c) =>
        c.id === changeId ? { ...c, hidden: !c.hidden } : c
      ),
    }));
  };

  const addChange = (respId) => {
    setReviewChanges((prev) => ({
      ...prev,
      [respId]: [...(prev[respId] || []), normaliseChange()],
    }));
  };

  const submitReview = async () => {
    const current = reviewQueue[0];
    if (!current || !token) return;
    setReviewSaving(true);
    setReviewError('');
    try {
        const payload = {
        responses: current.responses.map((r) => {
          const form = reviewForm[r.questionResponseId] || {};
          const teacherFeedback = form.teacherFeedback ?? '';
          const changes = (reviewChanges[r.questionResponseId] || [])
            .filter((c) => !c.hidden)
            .map((c) => ({
              type: c.type || 'change',
              from: c.from || '',
              to: c.to || '',
              error_type: c.error_type || '',
              micro_feedback: c.micro_feedback || '',
            }));
          return {
            questionResponseId: r.questionResponseId,
            correctedText: form.correctedText ?? r.aiCorrections ?? '',
            teacherFeedback,
            teacherScore: Number.isFinite(Number(form.teacherScore))
              ? Number(form.teacherScore)
              : r.aiScore ?? 0,
            changes,
          };
        }),
      };

      const res = await fetch(`${API_BASE}/${current.id}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.text()) || 'Failed to submit review.');

      await loadReviewQueue();
      toast.success('Review submitted.');
    } catch (err) {
      console.error(err);
      setReviewError(err.message || 'Could not complete review.');
      toast.error(err.message || 'Could not complete review.');
    } finally {
      setReviewSaving(false);
    }
  };

  return (
    <PageLayout title={null} role={role}>
      <div className="teacher-review">
        <Hero
          variant="teacher"
          eyebrow="Feedback queue"
          title="Review submissions"
          subtitle="Adjust AI corrections and scores for writing and speaking responses."
          icon={<Icon.ClipboardCheck className="icon" />}
          action={
            <button type="button" className="ghost-btn" onClick={loadReviewQueue} disabled={reviewLoading}>
              Refresh
            </button>
          }
        />

        <div className="data-card">
          <div className="data-header">
            <div>
              <h3 className="section-title">
                <span className="section-icon">
                  <Icon.List />
                </span>
                Pending reviews
              </h3>
              <p className="section-subtitle">
                {reviewLoading
                  ? 'Loading…'
                  : `${reviewQueue.length} submission${reviewQueue.length === 1 ? '' : 's'} waiting`}
              </p>
            </div>
          </div>

          {reviewError ? <div className="notice error">{reviewError}</div> : null}

          {reviewLoading ? (
            <div className="table-row muted">
              <div>Loading queue…</div>
            </div>
          ) : reviewQueue.length === 0 ? (
            <div className="table-row muted">
              <div>No pending writing/speaking reviews. 🎉</div>
            </div>
          ) : (
            (() => {
              const item = reviewQueue[0];
              return (
                <div className="review-panel">
                  <div className="review-meta">
                    <div>
                      <p className="eyebrow">Student</p>
                      <h4>{item.studentName}</h4>
                      <p className="muted">Lesson: {item.lessonTitle}</p>
                    </div>
                    <div className="pill tiny">
                      Submitted {item.submittedAt ? new Date(item.submittedAt).toLocaleString() : 'recently'}
                    </div>
                  </div>

                  <div className="review-questions">
                    {item.responses.map((resp) => {
                      const form = reviewForm[resp.questionResponseId] || {};
                      const changes = reviewChanges[resp.questionResponseId] || [];
                      const showChanges = changes.length > 0;
                      return (
                        <div className="question-card" key={resp.questionResponseId}>
                          <div className="question-head">
                            <div>
                              <p className="eyebrow">{resp.type}</p>
                              <h4>{resp.prompt}</h4>
                            </div>
                            <span className="chip-small info">
                              AI score: {resp.aiScore != null ? `${resp.aiScore}/10` : '—'}
                            </span>
                          </div>

                          <div className="feedback-block">
                            <div className="feedback-row">
                              <h5>Student answer</h5>
                              <div className="feedback-box">{resp.studentAnswer || 'No answer provided.'}</div>
                            </div>
                            <div className="feedback-row">
                              <h5>Corrected sentence (edit)</h5>
                              <textarea
                                className="feedback-textarea"
                                rows={3}
                                value={form.correctedText ?? ''}
                                onChange={(e) =>
                                  handleReviewChange(resp.questionResponseId, 'correctedText', e.target.value)
                                }
                              />
                            </div>
                            <div className="feedback-row">
                              <h5>Feedback to student (edit)</h5>
                              <textarea
                                className="feedback-textarea"
                                rows={3}
                                value={form.teacherFeedback ?? ''}
                                onChange={(e) =>
                                  handleReviewChange(resp.questionResponseId, 'teacherFeedback', e.target.value)
                                }
                              />
                            </div>
                            <div className="feedback-row">
                              <div className="change-list">
                                {showChanges ? (
                                  changes.map((c) => (
                                    <div
                                      className={`change-row ${c.hidden ? 'is-hidden' : ''}`}
                                      key={`ai-change-${resp.questionResponseId}-${c.id}`}
                                    >
                                      <div className="change-header">
                                        <span className="pill tiny">{(c.type || 'change').toString()}</span>
                                        <div className="change-actions">
                                          <button
                                            type="button"
                                            className="ghost-btn tiny"
                                            onClick={() => toggleChangeHidden(resp.questionResponseId, c.id)}
                                          >
                                            {c.hidden ? 'Show change' : 'Hide change'}
                                          </button>
                                        </div>
                                      </div>
                                      <div className="change-body">
                                        <div className="change-from">
                                          <span className="muted">From</span>
                                          <input
                                            className="change-input"
                                            value={c.from}
                                            onChange={(e) =>
                                              handleChangeEdit(resp.questionResponseId, c.id, 'from', e.target.value)
                                            }
                                            placeholder="Original text"
                                          />
                                        </div>
                                        <span className="arrow">→</span>
                                        <div className="change-to">
                                          <span className="muted">To</span>
                                          <input
                                            className="change-input"
                                            value={c.to}
                                            onChange={(e) =>
                                              handleChangeEdit(resp.questionResponseId, c.id, 'to', e.target.value)
                                            }
                                            placeholder="Corrected text"
                                          />
                                        </div>
                                      </div>
                                      <div className="change-meta">
                                        <span className="muted">Error type</span>
                                        <input
                                          className="change-input"
                                          value={c.error_type}
                                          onChange={(e) =>
                                            handleChangeEdit(
                                              resp.questionResponseId,
                                              c.id,
                                              'error_type',
                                              e.target.value
                                            )
                                          }
                                          placeholder="e.g. agreement/plural"
                                        />
                                      </div>
                                      <div className="change-note">
                                        <span className="muted">Micro feedback</span>
                                        <textarea
                                          className="change-textarea"
                                          rows={2}
                                          value={c.micro_feedback}
                                          onChange={(e) =>
                                            handleChangeEdit(
                                              resp.questionResponseId,
                                              c.id,
                                              'micro_feedback',
                                              e.target.value
                                            )
                                          }
                                          placeholder="Short coaching tip"
                                        />
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <div className="muted small-text">No detected changes yet.</div>
                                )}
                              </div>
                              <button
                                type="button"
                                className="ghost-btn small"
                                onClick={() => addChange(resp.questionResponseId)}
                              >
                                Add detected change
                              </button>
                            </div>
                          </div>
                          <div className="form-row score-input-row">
                            <label>Final score (0-10)</label>
                            <input
                              type="number"
                              min={0}
                              max={10}
                              step={1}
                              value={form.teacherScore ?? ''}
                              onChange={(e) =>
                                handleReviewChange(resp.questionResponseId, 'teacherScore', e.target.value)
                              }
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="form-actions">
                    <button type="button" className="ghost-btn" onClick={loadReviewQueue} disabled={reviewSaving}>
                      Skip/refresh
                    </button>
                    <button type="button" className="primary-btn" onClick={submitReview} disabled={reviewSaving}>
                      {reviewSaving ? 'Saving…' : 'Submit review'}
                    </button>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      </div>
    </PageLayout>
  );
}

export default Review;
