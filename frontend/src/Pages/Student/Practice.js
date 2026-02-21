import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '../../Components/PageLayout';
import Hero from '../../Components/Hero';
import Icon from '../../Components/Icons';
import { useToast } from '../../Components/ToastProvider';
import './Practice.css';

const API_BASE = 'http://localhost:5144/api/practice';

const ErrorCard = ({ label, description, ctaLabel, disabled, onClick, loading }) => (
  <div className="practice-card">
    <div className="card-label">{label}</div>
    <div className="card-title">{description}</div>
    <div className="card-actions">
      <button
        className="card-button"
        onClick={onClick}
        disabled={disabled || loading}
        type="button"
      >
        {loading ? 'Starting…' : ctaLabel}
      </button>
    </div>
  </div>
);

function Practice({ role }) {
  const navigate = useNavigate();
  const [errorTypes, setErrorTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState('');
  const [personalised, setPersonalised] = useState([]);
  const [loadingPersonalised, setLoadingPersonalised] = useState(false);
  const [personalisedError, setPersonalisedError] = useState('');
  const [showPersonalised, setShowPersonalised] = useState(false);
  const [activePersonalisedIndex, setActivePersonalisedIndex] = useState(0);
  const [answering, setAnswering] = useState(false);
  const [answerResult, setAnswerResult] = useState(null);
  const [responses, setResponses] = useState({});
  const [micError, setMicError] = useState('');
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const toast = useToast();

  const token = useMemo(() => sessionStorage.getItem('token') || localStorage.getItem('token'), []);
  const stopMic = useCallback(() => {
    if (recognitionRef.current && listening) {
      recognitionRef.current.stop();
    }
  }, [listening]);

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
      const current = personalised[activePersonalisedIndex];
      if (!current || current.type !== 'Speaking') return;
      const questionId = current.questionId;
      if (!questionId) return;

      const last = event.results[event.results.length - 1];
      const chunk = last[0].transcript;
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
    };
    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.stop();
    };
  }, [activePersonalisedIndex, personalised]);

  useEffect(() => {
    if (listening && personalised[activePersonalisedIndex]?.type !== 'Speaking') {
      stopMic();
    }
  }, [listening, personalised, activePersonalisedIndex, stopMic]);

  useEffect(() => {
    const fetchErrorTypes = async () => {
      setLoading(true);
      setError('');

      if (!token) {
        setError('Please sign in again to load your practice topics.');
        toast.error('Please sign in again to load your practice topics.');
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/l1-errors`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          const message = (await res.text()) || 'Unable to load common errors.';
          throw new Error(message);
        }

        const data = await res.json();
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.errors)
            ? data.errors
            : [];

        setErrorTypes(list.slice(0, 5));
      } catch (err) {
        console.error(err);
        setError(err.message || 'Something went wrong while loading errors.');
        toast.error(err.message || 'Something went wrong while loading errors.');
      } finally {
        setLoading(false);
      }
    };

    fetchErrorTypes();
  }, [token, toast]);

  const handleStart = async (errorType) => {
    if (!token) {
      setError('Please sign in again to start this exercise.');
      toast.error('Please sign in again to start this exercise.');
      return;
    }

    setStarting(errorType);
    setError('');

    try {
      const res = await fetch(`${API_BASE}/l1-errors/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ errorType }),
      });

      if (!res.ok) {
        const message = (await res.text()) || 'Unable to start practice right now.';
        throw new Error(message);
      }

      const data = await res.json();
      const normalised = {
        errorType,
        questions: data?.questions || data?.Questions || [],
        modelUsed: data?.modelUsed || data?.ModelUsed || '',
      };

      sessionStorage.setItem('commonPracticeSession', JSON.stringify(normalised));
      toast.success(`Practice started: ${errorType}`);
      navigate('/practice/common-errors', { state: normalised });
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to start practice. Please try again.');
      toast.error(err.message || 'Failed to start practice. Please try again.');
    } finally {
      setStarting('');
    }
  };

  const loadPersonalised = async () => {
    if (!token) {
      setPersonalisedError('Please sign in again to start personalised practice.');
      toast.error('Please sign in again to start personalised practice.');
      return;
    }
    setLoadingPersonalised(true);
    setPersonalisedError('');
    try {
      const res = await fetch(`${API_BASE}/personalised`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.text()) || 'Unable to load personalised errors.');
      const data = await res.json();
      const normalised = Array.isArray(data)
        ? data.map((q) => {
            const rawType = q.type ?? q.Type;
            const type =
              typeof rawType === 'number'
                ? rawType === 0
                  ? 'Reading'
                  : rawType === 1
                  ? 'Writing'
                  : 'Speaking'
                : rawType || '';
            return {
              questionId: q.questionId || q.QuestionId,
              lessonTitle: q.lessonTitle || q.LessonTitle || '',
              type,
              prompt: q.prompt || q.Prompt || '',
              readingSnippet: q.readingSnippet || q.ReadingSnippet || '',
              answerOptions: q.answerOptions || q.AnswerOptions || [],
            };
          })
        : [];
      setPersonalised(normalised);
      setActivePersonalisedIndex(0);
      setAnswerResult(null);
      setResponses({});
      toast.success('Personalised practice loaded.');
    } catch (err) {
      console.error(err);
      setPersonalised([]);
      setPersonalisedError(err.message || 'Could not load personalised errors.');
      toast.error(err.message || 'Could not load personalised errors.');
    } finally {
      setLoadingPersonalised(false);
    }
  };

  const startPersonalised = () => {
    setShowPersonalised(true);
    loadPersonalised();
  };

  const currentPersonalised = personalised[activePersonalisedIndex] || null;

  const updateResponse = (questionId, payload) => {
    setResponses((prev) => ({
      ...prev,
      [questionId]: {
        ...(prev[questionId] || {}),
        ...payload,
      },
    }));
  };

  useEffect(() => {
    setAnswerResult(null);
    setMicError('');
  }, [activePersonalisedIndex]);

  const toggleMic = () => {
    setMicError('');
    if (!recognitionRef.current) {
      setMicError('Mic not available in this browser.');
      return;
    }

    const current = personalised[activePersonalisedIndex];
    if (!current || current.type !== 'Speaking') {
      setMicError('Mic is only available for speaking questions.');
      return;
    }

    if (listening) {
      recognitionRef.current.stop();
      return;
    }

    try {
      recognitionRef.current.start();
      setListening(true);
    } catch (err) {
      console.error(err);
      setMicError('Unable to start microphone.');
    }
  };

  const submitPersonalisedAnswer = async () => {
    if (!currentPersonalised) return;
    const { questionId, type } = currentPersonalised;
    const respState = responses[questionId] || {};

    if (type === 'Reading' && !respState.selectedOptionId) {
      setAnswerResult({ success: false, message: 'Please choose an option before checking.' });
      toast.info('Please choose an option before checking.');
      return;
    }
    if ((type === 'Writing' || type === 'Speaking') && !(respState.responseText || '').trim()) {
      setAnswerResult({ success: false, message: 'Please enter a response before checking.' });
      toast.info('Please enter a response before checking.');
      return;
    }

    setAnswering(true);
    setAnswerResult(null);

    try {
      const res = await fetch(`${API_BASE}/personalised/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          questionId,
          selectedOptionId: respState.selectedOptionId || null,
          responseText: respState.responseText || '',
        }),
      });

      if (!res.ok) throw new Error((await res.text()) || 'Could not score this answer.');
      const data = await res.json();
      const correct = data.correct ?? data.Correct ?? false;
      const score = data.score ?? data.Score ?? 0;
      const feedback = data.feedback || data.Feedback || '';
      const correctedText = data.correctedText || data.CorrectedText || '';
      const changes = data.changes || data.Changes || [];

      setAnswerResult({
        success: correct,
        message: correct ? 'Great job! This one is now cleared.' : feedback || 'Keep practicing.',
        score,
        correctedText,
        changes,
      });
      if (correct) {
        toast.success('Correct answer. Nice work.');
      }
    } catch (err) {
      console.error(err);
      setAnswerResult({ success: false, message: err.message || 'Could not score this answer.' });
      toast.error(err.message || 'Could not score this answer.');
    } finally {
      setAnswering(false);
    }
  };

  const closePersonalised = () => {
    setShowPersonalised(false);
    setAnswerResult(null);
    stopMic();
  };

  const goToNextPersonalised = () => {
    stopMic();
    setPersonalised((prevList) => {
      if (prevList.length === 0) return prevList;
      const current = prevList[activePersonalisedIndex];
      if (!current) return prevList;

      const isCleared = Boolean(answerResult?.success);
      const nextList = [...prevList];
      nextList.splice(activePersonalisedIndex, 1);

      if (!isCleared) {
        nextList.push(current);
      }

      const maxIndex = Math.max(nextList.length - 1, 0);
      const nextIndex = Math.min(activePersonalisedIndex, maxIndex);
      setActivePersonalisedIndex(nextIndex);
      setAnswerResult(null);
      setMicError('');
      return nextList;
    });
  };

  const goToPrevPersonalised = () => {
    stopMic();
    setActivePersonalisedIndex((prev) => Math.max(prev - 1, 0));
  };

  return (
    <PageLayout title={null} role={role}>
      <div className="practice-page">
        <Hero
          variant="student"
          eyebrow="Choose your focus"
          title="Practice hub"
          subtitle="Target the most frequent mistakes for your first language, or tackle personalised feedback."
          icon={<Icon.PenNib className="icon" />}
          meta={[
            {
              label: loading ? 'Loading common errors…' : `${errorTypes.length} common errors`,
              icon: <Icon.List className="mini-icon" />,
            },
            {
              label: showPersonalised ? `${personalised.length} personalised items` : 'Personalised queue ready',
              tone: 'ghost',
              icon: <Icon.ClipboardList className="mini-icon" />,
            },
          ]}
        />

        <div className="practice-sections">
          <section className="practice-section">
            <header className="section-header">
              <div>
                <h3>Common errors</h3>
                <p className="section-subtitle">Top issues for learners with your first language</p>
              </div>
              {loading ? <span className="pill muted">Loading…</span> : null}
            </header>

            {error ? <div className="practice-error">{error}</div> : null}

            <div className="card-grid">
              {loading ? (
                Array.from({ length: 3 }).map((_, idx) => (
                  <div className="practice-card skeleton" key={idx}>
                    <div className="skeleton-line short" />
                    <div className="skeleton-line" />
                    <div className="skeleton-line button" />
                  </div>
                ))
              ) : errorTypes.length === 0 ? (
                <div className="empty-state">
                  <p>No common errors found for your profile yet.</p>
                </div>
              ) : (
                errorTypes.map((item, idx) => (
                  <ErrorCard
                    key={item || idx}
                    label={`Error ${idx + 1}`}
                    description={item}
                    ctaLabel="Start exercise"
                    loading={starting === item}
                    onClick={() => handleStart(item)}
                  />
                ))
              )}
            </div>
          </section>

          <section className="practice-section">
            <header className="section-header">
              <div>
                <h3>Personalised errors</h3>
                <p className="section-subtitle">
                  Work through your oldest reviewed mistakes, one at a time.
                </p>
              </div>
              {loadingPersonalised ? <span className="pill muted">Loading…</span> : null}
            </header>
            {personalisedError ? <div className="practice-error">{personalisedError}</div> : null}
            {micError ? <div className="practice-error">{micError}</div> : null}
            <div className="card-grid">
              <div className="practice-card">
                <div className="card-label">Personalised set</div>
                <div className="card-title">Tailored exercises based on your submissions</div>
                <div className="card-actions">
                  <button
                    className="card-button"
                    type="button"
                    onClick={startPersonalised}
                    disabled={loadingPersonalised}
                  >
                    {loadingPersonalised ? 'Loading…' : 'Practice personalised errors'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {showPersonalised ? (
        <div className="practice-modal-backdrop" onClick={(e) => e.target === e.currentTarget && !answering && closePersonalised()}>
          <div className="practice-modal">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Personalised practice</p>
                <h3 className="page-title">One question at a time</h3>
                <p className="section-subtitle">
                  Oldest unresolved errors first. Teacher-reviewed only.
                </p>
              </div>
              <button type="button" className="ghost-button" onClick={closePersonalised} disabled={answering}>
                Close
              </button>
            </div>

            {loadingPersonalised ? (
              <div className="empty-state">Loading your questions…</div>
            ) : personalised.length === 0 ? (
              <div className="empty-state">No personalised errors to practice right now.</div>
            ) : (
              currentPersonalised && (
                <div className="personalised-card">
                  <div className="personalised-meta">
                    <span className="pill muted">{currentPersonalised.lessonTitle || 'Lesson'}</span>
                    <span className="pill muted">{currentPersonalised.type}</span>
                    {personalised.length > 0 ? (
                      <span className="pill muted">
                        {Math.min(activePersonalisedIndex + 1, personalised.length)} of {personalised.length} remaining
                      </span>
                    ) : null}
                  </div>
                  <h4>{currentPersonalised.prompt}</h4>
                  {currentPersonalised.type === 'Reading' ? (
                    <>
                      <p className="reading-snippet">{currentPersonalised.readingSnippet}</p>
                      <div className="options-list">
                        {currentPersonalised.answerOptions.map((opt) => (
                          <label
                            key={opt.id || opt.Id}
                            className={`option-row ${
                              (responses[currentPersonalised.questionId]?.selectedOptionId || null) === (opt.id || opt.Id)
                                ? 'selected'
                                : ''
                            }`}
                          >
                            <input
                              type="radio"
                              name={`practice-${currentPersonalised.questionId}`}
                              checked={
                                (responses[currentPersonalised.questionId]?.selectedOptionId || null) ===
                                (opt.id || opt.Id)
                              }
                              onChange={() =>
                                updateResponse(currentPersonalised.questionId, {
                                  selectedOptionId: opt.id || opt.Id,
                                })
                              }
                            />
                            <span>{opt.text || opt.Text}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="text-response">
                      <textarea
                        rows={4}
                        value={responses[currentPersonalised.questionId]?.responseText || ''}
                        onChange={(e) =>
                          updateResponse(currentPersonalised.questionId, { responseText: e.target.value })
                        }
                        placeholder="Type your response"
                        disabled={answering}
                      />
                      {currentPersonalised.type === 'Speaking' ? (
                        <button
                          type="button"
                          className={`ghost-button mic-btn ${listening ? 'active' : ''}`}
                          onClick={toggleMic}
                          disabled={answering}
                        >
                          <Icon.Microphone />
                          {listening ? 'Listening…' : 'Speak'}
                        </button>
                      ) : null}
                    </div>
                  )}

                  <div className="personalised-actions">
                    <button type="button" className="card-button" onClick={submitPersonalisedAnswer} disabled={answering}>
                      {answering ? 'Checking…' : 'Check answer'}
                    </button>
                    {personalised.length > 1 || answerResult ? (
                      <>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={goToPrevPersonalised}
                          disabled={answering || activePersonalisedIndex === 0}
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={goToNextPersonalised}
                          disabled={answering || personalised.length === 0}
                        >
                          {answerResult?.success ? 'Next' : 'Skip to next'}
                        </button>
                      </>
                    ) : null}
                  </div>

                  {answerResult ? (
                    <div className={`answer-banner ${answerResult.success ? 'success' : 'danger'}`}>
                      <div>
                        <div className="score-title">{answerResult.success ? 'Cleared' : 'Keep practicing'}</div>
                        <div className="score-value">
                          {currentPersonalised?.type === 'Reading'
                            ? answerResult.success
                              ? 'Correct!'
                              : 'Incorrect'
                            : typeof answerResult.score === 'number'
                              ? `${answerResult.score}/10`
                              : '--'}
                        </div>
                        <p>{answerResult.message}</p>
                        {answerResult.correctedText ? (
                          <div className="muted small-text">
                            Suggested corrections: {answerResult.correctedText}
                          </div>
                        ) : null}
                        {Array.isArray(answerResult.changes) && answerResult.changes.length > 0 ? (
                          <div className="change-list">
                            {answerResult.changes.map((c, idx) => (
                              <div className="change-row" key={`change-${idx}`}>
                                <span className="pill tiny">{c.type || c.Type || 'change'}</span>
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
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            )}
          </div>
        </div>
      ) : null}
    </PageLayout>
  );
}

export default Practice;
