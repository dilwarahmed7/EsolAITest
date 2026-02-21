import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageLayout from '../../Components/PageLayout';
import DataGrid from '../../Components/DataGrid';
import Hero from '../../Components/Hero';
import Icon from '../../Components/Icons';
import { useToast } from '../../Components/ToastProvider';
import './Lessons.css';

const API_BASE = 'http://localhost:5144/api/teacher';
const PAGE_SIZE = 10;

const createInitialReading = () => ({
  snippet: '',
  prompt: '',
  options: [
    { text: '', isCorrect: true },
    { text: '', isCorrect: false },
    { text: '', isCorrect: false },
  ],
});

const createInitialForm = () => ({
  title: '',
  dueDate: '',
  classIds: [],
  reading: [createInitialReading(), createInitialReading()],
  writingPrompt: '',
  speakingPrompt: '',
});

function Lessons({ role }) {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => sessionStorage.getItem('token') || localStorage.getItem('token'), []);
  const dialogRef = useRef(null);
  const formContainerRef = useRef(null);
  const autoOpenRef = useRef(false);
  const formatInputDate = (raw) => {
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  };
  const formatDate = (raw) => {
    if (!raw) return 'No due date';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return 'No due date';
    return d.toLocaleDateString();
  };

  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingLessons, setLoadingLessons] = useState(false);
  const [error, setError] = useState('');

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState(createInitialForm());
  const [editingLessonId, setEditingLessonId] = useState(null);

  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState('created');
  const [sortDir, setSortDir] = useState('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [activeMenu, setActiveMenu] = useState(null);
  const menuRefs = useRef({});

  const normaliseDate = (dateStr) => {
    if (!dateStr) return null;
    return new Date(`${dateStr}T00:00:00`).toISOString();
  };
  const toast = useToast();

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        setIsDialogOpen(false);
        setEditingLessonId(null);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  useEffect(() => {
    if (!token) {
      setError('Please sign in again to view classes.');
      setLoadingClasses(false);
      return;
    }

    const loadClasses = async () => {
      setLoadingClasses(true);
      try {
        const res = await fetch(`${API_BASE}/classes`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error((await res.text()) || 'Unable to load classes.');
        const data = await res.json();
        setClasses(data);
        if (data.length > 0) setSelectedClassId(Number(data[0].id || data[0].Id));
      } catch (err) {
        console.error(err);
        setError(err.message || 'Failed to load classes.');
      } finally {
        setLoadingClasses(false);
      }
    };

    loadClasses();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const loadLessons = async () => {
      setLoadingLessons(true);
      setError('');
      try {
        const params = selectedClassId ? `?classId=${selectedClassId}` : '';
        const res = await fetch(`${API_BASE}/lessons${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error((await res.text()) || 'Unable to load lessons.');
        const data = await res.json();
        setLessons(Array.isArray(data) ? data : []);
        setPage(1);
      } catch (err) {
        console.error(err);
        setError(err.message || 'Failed to load lessons.');
      } finally {
        setLoadingLessons(false);
      }
    };

    loadLessons();
  }, [token, selectedClassId]);

  useEffect(() => {
    const handleClickAway = (e) => {
      if (activeMenu) {
        const node = menuRefs.current[activeMenu];
        if (!node || !node.contains(e.target)) {
          setActiveMenu(null);
        }
      }
    };
    document.addEventListener('mousedown', handleClickAway);
    return () => document.removeEventListener('mousedown', handleClickAway);
  }, [activeMenu]);

  const openCreateDialog = useCallback(() => {
    const initial = createInitialForm();
    if (selectedClassId) initial.classIds = [selectedClassId];
    setForm(initial);
    setEditingLessonId(null);
    setIsDialogOpen(true);
  }, [selectedClassId]);

  useEffect(() => {
    const wantsCreate = searchParams.get('create');
    if (!wantsCreate || autoOpenRef.current) return;
    if (loadingClasses) return;

    autoOpenRef.current = true;
    openCreateDialog();
  }, [searchParams, loadingClasses, openCreateDialog]);

  const openEditDialog = async (lessonId) => {
    if (!token) return;
    setIsSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/lessons/${lessonId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.text()) || 'Unable to load lesson.');
      const data = await res.json();
      const questionsRaw = data.Questions || data.questions || [];

      const normaliseType = (q) => {
        const raw = q.Type ?? q.type;
        if (typeof raw === 'string') return raw;
        if (raw === 0) return 'Reading';
        if (raw === 1) return 'Writing';
        if (raw === 2) return 'Speaking';
        return '';
      };
      const normaliseOrder = (q) => Number(q.Order ?? q.order ?? 0);

      const reading = questionsRaw
        .filter((q) => normaliseType(q) === 'Reading')
        .sort((a, b) => normaliseOrder(a) - normaliseOrder(b))
        .map((q) => {
          const opts = (q.AnswerOptions || q.answerOptions || []).map((o) => ({
            text: o.Text || o.text || '',
            isCorrect: o.IsCorrect ?? o.isCorrect ?? false,
          }));
          while (opts.length < 3) opts.push({ text: '', isCorrect: false });
          return {
            snippet: q.ReadingSnippet || q.readingSnippet || '',
            prompt: q.Prompt || q.prompt || '',
            options: opts.slice(0, 3),
          };
        });

      while (reading.length < 2) reading.push(createInitialReading());

      const writing = questionsRaw.find((q) => normaliseType(q) === 'Writing');
      const speaking = questionsRaw.find((q) => normaliseType(q) === 'Speaking');

      setForm({
        title: data.Title || data.title || '',
        dueDate: formatInputDate(data.DueDate || data.dueDate),
        classIds: (data.AssignedClassIds || data.assignedClassIds || [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id)),
        reading: reading.slice(0, 2),
        writingPrompt: writing?.Prompt || writing?.prompt || '',
        speakingPrompt: speaking?.Prompt || speaking?.prompt || '',
      });
      setEditingLessonId(lessonId);
      setIsDialogOpen(true);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to open lesson.');
      toast.error(err.message || 'Failed to open lesson.');
    } finally {
      setIsSaving(false);
    }
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingLessonId(null);
  };

  const updateReading = (idx, field, value) => {
    setForm((prev) => {
      const next = { ...prev };
      const items = [...next.reading];
      items[idx] = { ...items[idx], [field]: value };
      next.reading = items;
      return next;
    });
  };

  const updateOption = (qIdx, optIdx, value, asCorrect = false) => {
    setForm((prev) => {
      const next = { ...prev };
      const items = [...next.reading];
      const q = { ...items[qIdx] };
      const options = q.options.map((opt, i) => {
        if (asCorrect) return { ...opt, isCorrect: i === optIdx };
        return i === optIdx ? { ...opt, text: value } : opt;
      });
      q.options = options;
      items[qIdx] = q;
      next.reading = items;
      return next;
    });
  };

  const buildQuestionsPayload = (strict) => {
    const questions = [];

    const readingQuestions = form.reading
      .map((q, idx) => {
        const trimmedOptions = q.options.map((opt) => ({
          ...opt,
          text: opt.text.trim(),
        }));
        let filledOptions = trimmedOptions.filter((o) => o.text);
        let correctCount = trimmedOptions.filter((o) => o.isCorrect && o.text).length;

        // If no correct option but we have options, default first filled as correct to avoid loss
        if (filledOptions.length > 0 && correctCount === 0) {
          const firstFilledIdx = trimmedOptions.findIndex((o) => o.text);
          if (firstFilledIdx >= 0) {
            trimmedOptions[firstFilledIdx].isCorrect = true;
            filledOptions = trimmedOptions.filter((o) => o.text);
            correctCount = 1;
          }
        }

        const hasContent = q.prompt.trim() || q.snippet.trim() || filledOptions.length > 0;

        const isComplete =
          q.snippet.trim() &&
          q.prompt.trim() &&
          filledOptions.length >= 2 &&
          correctCount === 1;

        if (!hasContent) return null;
        if (strict && !isComplete) {
          throw new Error('Each reading question needs snippet, prompt, 2+ options and exactly one correct.');
        }

        return {
          type: 0,
          order: idx + 1,
          readingSnippet: q.snippet,
          prompt: q.prompt,
          answerOptions: trimmedOptions.map((opt) => ({
            text: opt.text,
            isCorrect: opt.isCorrect,
          })),
        };
      })
      .filter(Boolean);

    const writingHasContent = !!form.writingPrompt.trim();
    const speakingHasContent = !!form.speakingPrompt.trim();

    if (strict && readingQuestions.length !== 2) {
      throw new Error('Need 2 reading questions to publish.');
    }

    if (readingQuestions.length > 0) questions.push(...readingQuestions);

    if (writingHasContent) {
      questions.push({
        type: 1,
        order: 3,
        prompt: form.writingPrompt,
      });
    } else if (strict) {
      throw new Error('Writing prompt is required to publish.');
    }

    if (speakingHasContent) {
      questions.push({
        type: 2,
        order: 4,
        prompt: form.speakingPrompt,
      });
    } else if (strict) {
      throw new Error('Speaking prompt is required to publish.');
    }

    if (strict && questions.length !== 4) {
      throw new Error('Need 2 reading, 1 writing, and 1 speaking question to publish.');
    }

    return questions;
  };

  const reloadLessons = async (currentSelected) => {
    const params = currentSelected ? `?classId=${currentSelected}` : '';
    const res = await fetch(`${API_BASE}/lessons${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setLessons(Array.isArray(data) ? data : []);
      setPage(1);
    }
  };

  const saveLesson = async (publish = false) => {
    if (!token) {
      setError('Please sign in again.');
      toast.error('Please sign in again.');
      return;
    }
    if (!form.title.trim()) {
      setError('Title is required.');
      toast.info('Please add a lesson title before saving.', 'Missing required field');
      return;
    }
    if (!form.dueDate) {
      setError('Due date is required.');
      toast.info('Please add a due date before saving.', 'Missing required field');
      return;
    }

    setIsSaving(true);
    setError('');

    const lessonPayload = {
      title: form.title.trim(),
      dueDate: normaliseDate(form.dueDate),
    };

    try {
      let lessonId = editingLessonId;
      if (!lessonId) {
        const createRes = await fetch(`${API_BASE}/lessons`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(lessonPayload),
        });
        if (!createRes.ok) throw new Error((await createRes.text()) || 'Could not create lesson.');
        const created = await createRes.json();
        lessonId = created.id || created.Id;
      } else {
        const updateRes = await fetch(`${API_BASE}/lessons/${lessonId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(lessonPayload),
        });
        if (!updateRes.ok) throw new Error((await updateRes.text()) || 'Could not update lesson.');
      }

      // Questions and assignments
      const questions = buildQuestionsPayload(publish);
      if (questions.length > 0) {
        const qRes = await fetch(`${API_BASE}/lessons/${lessonId}/questions`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ questions }),
        });
        if (!qRes.ok) throw new Error((await qRes.text()) || 'Could not save questions.');
      } else if (publish) {
        throw new Error('Please add questions before publishing.');
      }

      if (form.classIds.length > 0) {
        const assignRes = await fetch(`${API_BASE}/lessons/${lessonId}/assign`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ classIds: form.classIds }),
        });
        if (!assignRes.ok) throw new Error((await assignRes.text()) || 'Could not assign classes.');
      } else if (publish) {
        throw new Error('Select at least one class before publishing.');
      }

      if (publish) {
        const publishRes = await fetch(`${API_BASE}/lessons/${lessonId}/publish`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!publishRes.ok) throw new Error((await publishRes.text()) || 'Could not publish lesson.');
      }

      closeDialog();
      await reloadLessons(selectedClassId);
      if (publish) {
        toast.success('Lesson published and assigned to classes.');
      } else if (editingLessonId) {
        toast.success('Lesson changes saved.');
      } else {
        toast.success('Lesson created successfully.');
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to save lesson.');
      toast.error(err.message || 'Failed to save lesson.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (lessonId) => {
    if (!window.confirm('Archive this lesson?')) return;
    setError('');
    try {
      const res = await fetch(`${API_BASE}/lessons/${lessonId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: 2 }),
      });
      if (!res.ok) throw new Error((await res.text()) || 'Could not archive lesson.');
      setLessons((prev) => prev.filter((l) => (l.id || l.Id) !== lessonId));
      toast.success('Lesson archived.');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to archive lesson.');
      toast.error(err.message || 'Failed to archive lesson.');
    }
  };

  const toggleClassSelection = (classId) => {
    setForm((prev) => {
      const exists = prev.classIds.includes(classId);
      return {
        ...prev,
        classIds: exists ? prev.classIds.filter((id) => id !== classId) : [...prev.classIds, classId],
      };
    });
  };

  const filteredLessons = lessons
    .filter((lesson) => {
      const status = (lesson.status || lesson.Status || '').toString().toLowerCase();
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      return true;
    })
    .filter((lesson) => {
      if (!searchQuery.trim()) return true;
      const name = (lesson.title || lesson.Title || '').toLowerCase();
      return name.includes(searchQuery.trim().toLowerCase());
    })
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'name') {
        return (a.title || a.Title || '').localeCompare(b.title || b.Title || '') * dir;
      }
      if (sortKey === 'due') {
        const aDue = a.dueDate || a.DueDate;
        const bDue = b.dueDate || b.DueDate;
        const aTime = aDue ? new Date(aDue).getTime() : Infinity;
        const bTime = bDue ? new Date(bDue).getTime() : Infinity;
        if (aTime === bTime) return 0;
        return aTime > bTime ? dir : -dir;
      }
      if (sortKey === 'created') {
        const aCreated = a.createdAt || a.CreatedAt;
        const bCreated = b.createdAt || b.CreatedAt;
        const aTime = aCreated ? new Date(aCreated).getTime() : null;
        const bTime = bCreated ? new Date(bCreated).getTime() : null;
        if (aTime == null && bTime == null) return 0;
        if (aTime == null) return 1;
        if (bTime == null) return -1;
        if (aTime === bTime) return 0;
        return aTime > bTime ? dir : -dir;
      }
      return 0;
    });

  const totalPages = Math.max(1, Math.ceil(filteredLessons.length / PAGE_SIZE));
  const startIdx = (page - 1) * PAGE_SIZE;
  const currentPageLessons = filteredLessons.slice(startIdx, startIdx + PAGE_SIZE);
  const lessonCounts = useMemo(() => {
    const counts = { total: lessons.length, draft: 0, published: 0, archived: 0 };
    lessons.forEach((lesson) => {
      const status = (lesson.status || lesson.Status || '').toLowerCase();
      if (status === 'draft') counts.draft += 1;
      if (status === 'published') counts.published += 1;
      if (status === 'archived') counts.archived += 1;
    });
    return counts;
  }, [lessons]);
  const nextDueLabel = useMemo(() => {
    const dueDates = lessons
      .map((lesson) => lesson.dueDate || lesson.DueDate)
      .filter(Boolean)
      .map((raw) => new Date(raw))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => a - b);

    if (!dueDates.length) return 'No upcoming due date';
    return formatDate(dueDates[0]);
  }, [lessons]);

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'created' ? 'desc' : 'asc');
    }
    setPage(1);
  };


  return (
    <PageLayout title={null} role={role}>
      <div className="teacher-lessons">
        <Hero
          eyebrow="Plan ahead"
          title="Lessons"
          subtitle="Create, assign, and track lessons across your classes."
          variant="teacher"
          icon={<Icon.BookOpen className="icon" />}
          meta={[
            {
              label: `${lessonCounts.total} total`,
              icon: <Icon.List className="mini-icon" />,
            },
            {
              label: `${lessonCounts.published} published`,
              tone: 'ghost',
              icon: <Icon.CheckCircle className="mini-icon" />,
            },
            {
              label: `Next due: ${nextDueLabel}`,
              tone: 'subtle',
              icon: <Icon.Calendar className="mini-icon" />,
            },
          ]}
          action={
            <button type="button" className="dash-button primary" onClick={openCreateDialog}>
              + Create new lesson
            </button>
          }
        />

        {error ? <div className="notice error">{error}</div> : null}

        <div className="controls">
          <div className="control-group">
            <label htmlFor="class-select">Class</label>
            <select
              id="class-select"
              value={selectedClassId || ''}
              onChange={(e) => setSelectedClassId(Number(e.target.value))}
              disabled={loadingClasses || classes.length === 0}
            >
              {classes.map((c) => (
                <option key={c.id || c.Id} value={c.id || c.Id}>
                  {c.name || c.Name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="data-card">
          <div className="data-header">
            <div>
              <h3 className="section-title">
                <span className="section-icon">
                  <Icon.List className="icon" />
                </span>
                Lessons
              </h3>
              <p className="section-subtitle">
                {loadingLessons
                  ? 'Loading lessons…'
                  : `${lessons.length} lesson${lessons.length === 1 ? '' : 's'}`}
              </p>
            </div>
            <div className="filter-row">
              <input
                type="text"
                className="status-select filter-input"
                placeholder="Search by lesson name"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
              />
              <button
                type="button"
                className={`ghost-btn small ${sortKey === 'name' ? 'active' : ''}`}
                onClick={() => toggleSort('name')}
              >
                Name {sortKey === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </button>
              <button
                type="button"
                className={`ghost-btn small ${sortKey === 'created' ? 'active' : ''}`}
                onClick={() => toggleSort('created')}
              >
                Creation date {sortKey === 'created' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </button>
              <button
                type="button"
                className={`ghost-btn small ${sortKey === 'due' ? 'active' : ''}`}
                onClick={() => toggleSort('due')}
              >
                Due date {sortKey === 'due' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </button>
              <select
                className="status-select"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

            <div className="table">
            <DataGrid
              loading={loadingLessons}
              emptyMessage="No lessons found for this class."
              className="lessons-grid"
              columns={[
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
                width: '0.9fr',
              },
              {
                title: (
                  <span className="col-title">
                    <Icon.Signal className="col-icon" />
                    Status
                  </span>
                ),
                align: 'center',
                width: '0.9fr',
              },
              {
                title: (
                  <span className="col-title">
                    <Icon.Ellipsis className="col-icon" />
                    Actions
                  </span>
                ),
                align: 'right',
                width: '0.8fr',
              },
              ]}
              rows={currentPageLessons.map((lesson) => {
                const id = lesson.id || lesson.Id;
                const due = lesson.dueDate || lesson.DueDate;
                const status = lesson.status || lesson.Status;
                return {
                  key: id,
                  onDoubleClick: () => openEditDialog(id),
                  cells: [
                    <div className="cell-strong lesson-title">
                      <span className="lesson-title-icon">
                        <Icon.BookOpen />
                      </span>
                      <span>{lesson.title || lesson.Title}</span>
                    </div>,
                    due ? new Date(due).toLocaleDateString() : 'No due date',
                    <div className={`status-pill center ${status?.toLowerCase()}`}>{status}</div>,
                    <div className="table-actions">
                      <div
                        className="menu-wrapper"
                        ref={(node) => {
                          if (node) {
                            menuRefs.current[id] = node;
                          } else {
                            delete menuRefs.current[id];
                          }
                        }}
                      >
                        <button
                          type="button"
                          className="ghost-btn small"
                          onClick={() => setActiveMenu((prev) => (prev === id ? null : id))}
                        >
                          ⋯
                        </button>
                        {activeMenu === id ? (
                          <div className="menu-panel">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenu(null);
                                openEditDialog(id);
                              }}
                            >
                              Edit lesson
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => {
                                setActiveMenu(null);
                                handleDelete(id);
                              }}
                            >
                              Archive
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>,
                  ],
                };
              })}
            />
          </div>

          {totalPages > 1 ? (
            <div className="pagination">
              <button
                type="button"
                className="ghost-btn small"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </button>
              <span className="page-indicator">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="ghost-btn small"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                Next
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {isDialogOpen ? (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !isSaving && closeDialog()}>
            <div className="modal" ref={dialogRef}>
              <div className="modal-header">
                <div>
                  <p className="eyebrow">Lesson</p>
                  <h3>{editingLessonId ? 'Edit lesson' : 'Create new lesson'}</h3>
                </div>
              <button type="button" className="ghost-btn small" onClick={closeDialog} disabled={isSaving}>
                Close
              </button>
            </div>

            <form className="lesson-form" ref={formContainerRef} onSubmit={(e) => e.preventDefault()}>
              <div className="form-row">
                <label>Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  required
                />
              </div>

              <div className="form-row">
                <label>Due date</label>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                  required
                />
              </div>

              <div className="form-row">
                <label>Assign to classes</label>
                <div className="chip-list">
                  {classes.map((cls) => {
                    const id = cls.id || cls.Id;
                    const selected = form.classIds.includes(id);
                    return (
                      <button
                        type="button"
                        key={id}
                        className={`chip ${selected ? 'active' : ''}`}
                        onClick={() => toggleClassSelection(id)}
                      >
                        {cls.name || cls.Name}
                      </button>
                    );
                  })}
                  {classes.length === 0 ? <span className="muted-text">No classes available</span> : null}
                </div>
              </div>

              <div className="question-group">
                <div className="group-header">
                  <div>
                    <p className="eyebrow">Reading (2)</p>
                    <h4>Multiple choice</h4>
                  </div>
                </div>
                {form.reading.map((q, idx) => (
                  <div className="reading-card" key={`reading-${idx}`}>
                    <div className="form-row">
                      <label>Reading snippet #{idx + 1}</label>
                      <textarea
                        rows={3}
                        value={q.snippet}
                        onChange={(e) => updateReading(idx, 'snippet', e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-row">
                      <label>Question prompt</label>
                      <input
                        type="text"
                        value={q.prompt}
                        onChange={(e) => updateReading(idx, 'prompt', e.target.value)}
                        required
                      />
                    </div>
                    <div className="options-grid">
                      {q.options.map((opt, optIdx) => (
                        <div className="option-row" key={`opt-${idx}-${optIdx}`}>
                          <input
                            type="text"
                            placeholder={`Option ${optIdx + 1}`}
                            value={opt.text}
                            onChange={(e) => updateOption(idx, optIdx, e.target.value, false)}
                            required
                          />
                          <label className="radio-label">
                            <input
                              type="radio"
                              name={`correct-${idx}`}
                              checked={opt.isCorrect}
                              onChange={() => updateOption(idx, optIdx, opt.text || ' ', true)}
                            />
                            Correct
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="question-group">
                <div className="group-header">
                  <div>
                    <p className="eyebrow">Writing</p>
                    <h4>Essay prompt</h4>
                  </div>
                </div>
                <div className="form-row">
                  <label>Prompt</label>
                  <textarea
                    rows={3}
                    value={form.writingPrompt}
                    onChange={(e) => setForm((prev) => ({ ...prev, writingPrompt: e.target.value }))}
                    required
                  />
                </div>
              </div>

              <div className="question-group">
                <div className="group-header">
                  <div>
                    <p className="eyebrow">Speaking</p>
                    <h4>Oral response prompt</h4>
                  </div>
                </div>
                <div className="form-row">
                  <label>Prompt</label>
                  <textarea
                    rows={3}
                    value={form.speakingPrompt}
                    onChange={(e) => setForm((prev) => ({ ...prev, speakingPrompt: e.target.value }))}
                    required
                  />
                </div>
              </div>

              <div className="form-actions">
                <button type="button" className="ghost-btn" onClick={closeDialog} disabled={isSaving}>
                  Cancel
                </button>
                <button type="button" className="ghost-btn" onClick={() => saveLesson(false)} disabled={isSaving}>
                  {isSaving && !editingLessonId ? 'Saving…' : 'Save draft'}
                </button>
                <button type="button" className="primary-btn" onClick={() => saveLesson(true)} disabled={isSaving}>
                  {isSaving ? 'Saving…' : editingLessonId ? 'Save & publish' : 'Create & publish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </PageLayout>
  );
}

export default Lessons;
