import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import './DecisionModal.css';

export default function DecisionModal({
  decision = null, // if provided, editing existing proposal
  isOpen,
  onClose,
  onSaved,
  projects = [],
  defaultProjectId = '',
}) {
  const isEditing = Boolean(decision);

  const [form, setForm] = useState({
    title: '',
    project: defaultProjectId || (projects[0]?._id || ''),
    context: '',
    decision: '',
    rationale: '',
    alternatives: [],
    consequences: {
      positive: [],
      negative: [],
      risks: [],
    },
    linkedTasks: [],
    linkedMilestones: [],
    linkedReleases: [],
  });

  const [projectTasks, setProjectTasks] = useState([]);
  const [projectMilestones, setProjectMilestones] = useState([]);
  const [projectReleases, setProjectReleases] = useState([]);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Temporary inputs for adding dynamic items
  const [altTitle, setAltTitle] = useState('');
  const [altReason, setAltReason] = useState('');
  const [posConsequence, setPosConsequence] = useState('');
  const [negConsequence, setNegConsequence] = useState('');
  const [riskConsequence, setRiskConsequence] = useState('');

  // Initialize form state when opened or decision changes
  useEffect(() => {
    if (decision) {
      setForm({
        title: decision.title || '',
        project: (decision.project?._id || decision.project || defaultProjectId || '').toString(),
        context: decision.context || '',
        decision: decision.decision || '',
        rationale: decision.rationale || '',
        alternatives: Array.isArray(decision.alternatives) ? [...decision.alternatives] : [],
        consequences: {
          positive: Array.isArray(decision.consequences?.positive) ? [...decision.consequences.positive] : [],
          negative: Array.isArray(decision.consequences?.negative) ? [...decision.consequences.negative] : [],
          risks: Array.isArray(decision.consequences?.risks) ? [...decision.consequences.risks] : [],
        },
        linkedTasks: (decision.linkedTasks || []).map((t) => (t._id || t).toString()),
        linkedMilestones: (decision.linkedMilestones || []).map((m) => (m._id || m).toString()),
        linkedReleases: (decision.linkedReleases || []).map((r) => (r._id || r).toString()),
      });
    } else {
      setForm({
        title: '',
        project: defaultProjectId || (projects[0]?._id || ''),
        context: '',
        decision: '',
        rationale: '',
        alternatives: [],
        consequences: {
          positive: [],
          negative: [],
          risks: [],
        },
        linkedTasks: [],
        linkedMilestones: [],
        linkedReleases: [],
      });
    }
    setError('');
  }, [decision, defaultProjectId, projects, isOpen]);

  // Load project's tasks, milestones, and releases when project changes
  useEffect(() => {
    if (!form.project || !isOpen) {
      setProjectTasks([]);
      setProjectMilestones([]);
      setProjectReleases([]);
      return;
    }

    let isMounted = true;
    setLoadingEntities(true);

    Promise.all([
      api.get(`/tasks?project=${form.project}&limit=100`).catch(() => ({ data: { tasks: [] } })),
      api.get(`/milestones?project=${form.project}`).catch(() => ({ data: { milestones: [] } })),
      api.get(`/releases?project=${form.project}`).catch(() => ({ data: { releases: [] } })),
    ])
      .then(([tasksRes, msRes, relsRes]) => {
        if (!isMounted) return;
        setProjectTasks(tasksRes.data?.tasks || []);
        setProjectMilestones(msRes.data?.milestones || []);
        setProjectReleases(relsRes.data?.releases || []);
      })
      .finally(() => {
        if (isMounted) setLoadingEntities(false);
      });

    return () => {
      isMounted = false;
    };
  }, [form.project, isOpen]);

  if (!isOpen) return null;

  const handleAddAlternative = (e) => {
    e.preventDefault();
    if (!altTitle.trim()) return;
    if (form.alternatives.length >= 10) {
      toast.error('Maximum 10 alternatives allowed.');
      return;
    }
    setForm((prev) => ({
      ...prev,
      alternatives: [...prev.alternatives, { title: altTitle.trim().slice(0, 120), reasonRejected: altReason.trim().slice(0, 600) }],
    }));
    setAltTitle('');
    setAltReason('');
  };

  const handleRemoveAlternative = (index) => {
    setForm((prev) => ({
      ...prev,
      alternatives: prev.alternatives.filter((_, i) => i !== index),
    }));
  };

  const handleAddConsequence = (type, value, setter) => {
    if (!value.trim()) return;
    if ((form.consequences[type] || []).length >= 10) {
      toast.error(`Maximum 10 ${type} consequences allowed.`);
      return;
    }
    setForm((prev) => ({
      ...prev,
      consequences: {
        ...prev.consequences,
        [type]: [...(prev.consequences[type] || []), value.trim().slice(0, 600)],
      },
    }));
    setter('');
  };

  const handleRemoveConsequence = (type, index) => {
    setForm((prev) => ({
      ...prev,
      consequences: {
        ...prev.consequences,
        [type]: prev.consequences[type].filter((_, i) => i !== index),
      },
    }));
  };

  const toggleLinkedEntity = (field, id, maxLimit) => {
    setForm((prev) => {
      const current = prev[field] || [];
      if (current.includes(id)) {
        return { ...prev, [field]: current.filter((x) => x !== id) };
      } else {
        if (current.length >= maxLimit) {
          toast.error(`Maximum ${maxLimit} linked items reached for this category.`);
          return prev;
        }
        return { ...prev, [field]: [...current, id] };
      }
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError('Title is required');
      return;
    }
    if (!form.project) {
      setError('Project selection is required');
      return;
    }
    if (!form.context.trim() || !form.decision.trim() || !form.rationale.trim()) {
      setError('Context, Decision, and Rationale are required');
      return;
    }

    setSaving(true);
    setError('');

    const payload = {
      title: form.title.trim(),
      project: form.project,
      context: form.context.trim(),
      decision: form.decision.trim(),
      rationale: form.rationale.trim(),
      alternatives: form.alternatives,
      consequences: form.consequences,
      linkedTasks: form.linkedTasks,
      linkedMilestones: form.linkedMilestones,
      linkedReleases: form.linkedReleases,
    };

    try {
      if (isEditing) {
        const res = await api.put(`/decisions/${decision._id}`, payload);
        toast.success('Decision updated successfully');
        onSaved(res.data.decision);
      } else {
        const res = await api.post('/decisions', payload);
        toast.success('Decision proposed successfully');
        onSaved(res.data.decision);
      }
      onClose();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to save decision';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="decision-modal-overlay" onClick={onClose}>
      <div className="decision-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="decision-modal-header">
          <div>
            <h2>{isEditing ? 'Edit Architectural Decision' : 'Propose Engineering Decision'}</h2>
            <p className="decision-modal-subtitle">
              Architectural Decision Record with Decision Lifecycle tracking and deterministic delivery-impact analysis.
            </p>
          </div>
          <button className="decision-modal-close" onClick={onClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        {error && <div className="decision-modal-error">{error}</div>}

        <form onSubmit={handleSubmit} className="decision-modal-form">
          {/* Row 1: Title & Project */}
          <div className="form-row">
            <div className="form-group flex-2">
              <label htmlFor="dec-title">
                Decision Title <span className="req">*</span>
                <span className="char-count">{form.title.length}/120</span>
              </label>
              <input
                id="dec-title"
                type="text"
                maxLength={120}
                placeholder="e.g. ADR-014: Canonical Prerequisite-to-Dependent Dependency Validation"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </div>

            <div className="form-group flex-1">
              <label htmlFor="dec-project">
                Target Project <span className="req">*</span>
              </label>
              <select
                id="dec-project"
                value={form.project}
                onChange={(e) => setForm({ ...form, project: e.target.value, linkedTasks: [], linkedMilestones: [], linkedReleases: [] })}
                disabled={isEditing}
                required
              >
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Section: Context */}
          <div className="form-group">
            <label htmlFor="dec-context">
              Context & Problem Statement <span className="req">*</span>
              <span className="char-count">{form.context.length}/3000</span>
            </label>
            <textarea
              id="dec-context"
              rows={3}
              maxLength={3000}
              placeholder="What forces, technical constraints, or architectural challenges prompted this decision?"
              value={form.context}
              onChange={(e) => setForm({ ...form, context: e.target.value })}
              required
            />
          </div>

          {/* Section: Decision */}
          <div className="form-group">
            <label htmlFor="dec-decision">
              Architectural Decision <span className="req">*</span>
              <span className="char-count">{form.decision.length}/3000</span>
            </label>
            <textarea
              id="dec-decision"
              rows={3}
              maxLength={3000}
              placeholder="What specific architectural choice, change, or contract is being adopted?"
              value={form.decision}
              onChange={(e) => setForm({ ...form, decision: e.target.value })}
              required
            />
          </div>

          {/* Section: Rationale */}
          <div className="form-group">
            <label htmlFor="dec-rationale">
              Rationale & Justification <span className="req">*</span>
              <span className="char-count">{form.rationale.length}/3000</span>
            </label>
            <textarea
              id="dec-rationale"
              rows={3}
              maxLength={3000}
              placeholder="Why is this the best approach compared to the alternatives considered?"
              value={form.rationale}
              onChange={(e) => setForm({ ...form, rationale: e.target.value })}
              required
            />
          </div>

          {/* Section: Alternatives Considered */}
          <div className="form-section">
            <label className="section-label">
              Alternatives Considered ({form.alternatives.length}/10)
            </label>
            <p className="section-help">List competing designs or frameworks evaluated and why they were rejected.</p>

            <div className="alternatives-list">
              {form.alternatives.map((alt, idx) => (
                <div key={idx} className="alt-item">
                  <div className="alt-content">
                    <span className="alt-title">{alt.title}</span>
                    {alt.reasonRejected && <span className="alt-reason">{alt.reasonRejected}</span>}
                  </div>
                  <button
                    type="button"
                    className="btn-remove-alt"
                    onClick={() => handleRemoveAlternative(idx)}
                    title="Remove alternative"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>

            {form.alternatives.length < 10 && (
              <div className="add-subitem-row">
                <input
                  type="text"
                  placeholder="Alternative title (e.g. MongoDB Sharding)"
                  maxLength={120}
                  value={altTitle}
                  onChange={(e) => setAltTitle(e.target.value)}
                  className="input-subitem-title"
                />
                <input
                  type="text"
                  placeholder="Reason rejected (e.g. Excessive operational overhead)"
                  maxLength={600}
                  value={altReason}
                  onChange={(e) => setAltReason(e.target.value)}
                  className="input-subitem-reason"
                />
                <button
                  type="button"
                  className="btn-add-subitem"
                  onClick={handleAddAlternative}
                  disabled={!altTitle.trim()}
                >
                  Add Option
                </button>
              </div>
            )}
          </div>

          {/* Section: Consequences (Pros, Cons, Risks) */}
          <div className="form-section consequences-grid">
            {/* Positive */}
            <div className="consequence-col">
              <label className="consequence-label positive">
                Positive Consequences (+{form.consequences.positive.length}/10)
              </label>
              <div className="consequence-items">
                {form.consequences.positive.map((item, i) => (
                  <div key={i} className="consequence-pill positive">
                    <span>{item}</span>
                    <button type="button" onClick={() => handleRemoveConsequence('positive', i)}>&times;</button>
                  </div>
                ))}
              </div>
              {form.consequences.positive.length < 10 && (
                <div className="add-consequence-row">
                  <input
                    type="text"
                    placeholder="Add expected benefit..."
                    maxLength={600}
                    value={posConsequence}
                    onChange={(e) => setPosConsequence(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddConsequence('positive', posConsequence, setPosConsequence);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleAddConsequence('positive', posConsequence, setPosConsequence)}
                    disabled={!posConsequence.trim()}
                  >
                    +
                  </button>
                </div>
              )}
            </div>

            {/* Negative */}
            <div className="consequence-col">
              <label className="consequence-label negative">
                Negative Tradeoffs (-{form.consequences.negative.length}/10)
              </label>
              <div className="consequence-items">
                {form.consequences.negative.map((item, i) => (
                  <div key={i} className="consequence-pill negative">
                    <span>{item}</span>
                    <button type="button" onClick={() => handleRemoveConsequence('negative', i)}>&times;</button>
                  </div>
                ))}
              </div>
              {form.consequences.negative.length < 10 && (
                <div className="add-consequence-row">
                  <input
                    type="text"
                    placeholder="Add architectural tradeoff..."
                    maxLength={600}
                    value={negConsequence}
                    onChange={(e) => setNegConsequence(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddConsequence('negative', negConsequence, setNegConsequence);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleAddConsequence('negative', negConsequence, setNegConsequence)}
                    disabled={!negConsequence.trim()}
                  >
                    +
                  </button>
                </div>
              )}
            </div>

            {/* Risks */}
            <div className="consequence-col">
              <label className="consequence-label risk">
                Risks & Neutral Factors (!{form.consequences.risks.length}/10)
              </label>
              <div className="consequence-items">
                {form.consequences.risks.map((item, i) => (
                  <div key={i} className="consequence-pill risk">
                    <span>{item}</span>
                    <button type="button" onClick={() => handleRemoveConsequence('risks', i)}>&times;</button>
                  </div>
                ))}
              </div>
              {form.consequences.risks.length < 10 && (
                <div className="add-consequence-row">
                  <input
                    type="text"
                    placeholder="Add risk or assumption..."
                    maxLength={600}
                    value={riskConsequence}
                    onChange={(e) => setRiskConsequence(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddConsequence('risks', riskConsequence, setRiskConsequence);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleAddConsequence('risks', riskConsequence, setRiskConsequence)}
                    disabled={!riskConsequence.trim()}
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Section: Linked Delivery Work */}
          <div className="form-section linked-work-section">
            <label className="section-label">
              Linked Delivery Work & Impact Surface
            </label>
            <p className="section-help">
              Connect this decision to delivery items. TaskFlow computes downstream dependency propagation, milestone reach, and critical-path intersection dynamically.
            </p>

            {loadingEntities ? (
              <div className="entities-loading">Loading project delivery scope...</div>
            ) : (
              <div className="entities-selector-grid">
                {/* Linked Tasks */}
                <div className="entity-selector-box">
                  <span className="entity-selector-title">
                    Linked Tasks ({form.linkedTasks.length}/25 max)
                  </span>
                  <div className="entity-checklist">
                    {projectTasks.length === 0 ? (
                      <span className="no-entities">No accessible tasks in project</span>
                    ) : (
                      projectTasks.map((t) => {
                        const isChecked = form.linkedTasks.includes(t._id);
                        return (
                          <label key={t._id} className={`entity-check-item ${isChecked ? 'selected' : ''}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleLinkedEntity('linkedTasks', t._id, 25)}
                            />
                            <span className="entity-title">{t.title}</span>
                            <span className={`entity-badge status-${t.status.toLowerCase().replace(/\s+/g, '-')}`}>
                              {t.status}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Linked Milestones */}
                <div className="entity-selector-box">
                  <span className="entity-selector-title">
                    Linked Milestones ({form.linkedMilestones.length}/15 max)
                  </span>
                  <div className="entity-checklist">
                    {projectMilestones.length === 0 ? (
                      <span className="no-entities">No milestones in project</span>
                    ) : (
                      projectMilestones.map((m) => {
                        const isChecked = form.linkedMilestones.includes(m._id);
                        return (
                          <label key={m._id} className={`entity-check-item ${isChecked ? 'selected' : ''}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleLinkedEntity('linkedMilestones', m._id, 15)}
                            />
                            <span className="entity-title">{m.title}</span>
                            <span className="entity-badge">{m.status || 'open'}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Linked Releases */}
                <div className="entity-selector-box">
                  <span className="entity-selector-title">
                    Linked Releases ({form.linkedReleases.length}/10 max)
                  </span>
                  <div className="entity-checklist">
                    {projectReleases.length === 0 ? (
                      <span className="no-entities">No releases in project</span>
                    ) : (
                      projectReleases.map((r) => {
                        const isChecked = form.linkedReleases.includes(r._id);
                        return (
                          <label key={r._id} className={`entity-check-item ${isChecked ? 'selected' : ''}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleLinkedEntity('linkedReleases', r._id, 10)}
                            />
                            <span className="entity-title">{r.name} ({r.version})</span>
                            <span className="entity-badge">{r.status || 'planning'}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="decision-modal-actions">
            <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-submit" disabled={saving}>
              {saving ? 'Saving ADR...' : isEditing ? 'Update Decision' : 'Submit Proposal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
