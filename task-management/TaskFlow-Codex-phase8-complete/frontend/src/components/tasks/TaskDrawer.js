import React, { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { getPrimaryRiskReason } from '../../utils/taskHelpers';

export default function TaskDrawer({
  task,
  onClose,
  onUpdateTask,
  onAddComment,
  onDeleteTask,
  canDelete = false,
}) {
  const [drawerForm, setDrawerForm] = useState({
    title: '',
    description: '',
    status: 'To Do',
    priority: 'medium',
    dueDate: '',
    isBlocked: false,
    blockedReason: '',
    blockerEta: '',
    estimateDays: '',
    milestone: '',
  });
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [comments, setComments] = useState([]);
  const [projectMilestones, setProjectMilestones] = useState([]);
  const [dependencyData, setDependencyData] = useState(null);
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [candidateTasks, setCandidateTasks] = useState([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [addingDependency, setAddingDependency] = useState(false);

  // Fetch project milestones when task has an associated project
  useEffect(() => {
    const projId = (task?.project?._id || task?.project)?.toString();
    if (projId) {
      api.get(`/milestones?project=${projId}&includeCancelled=true`)
        .then(({ data }) => {
          if (data?.success && Array.isArray(data.milestones)) {
            setProjectMilestones(data.milestones);
          }
        })
        .catch(() => setProjectMilestones([]));
    } else {
      setProjectMilestones([]);
    }
  }, [task]);

  // Fetch task dependencies
  const fetchDependencies = useCallback(() => {
    if (!task?._id) return;
    setLoadingDeps(true);
    api.get(`/tasks/${task._id}/dependencies`)
      .then(({ data }) => {
        if (data?.success) {
          setDependencyData(data);
        }
      })
      .catch(() => setDependencyData(null))
      .finally(() => setLoadingDeps(false));
  }, [task?._id]);

  useEffect(() => {
    fetchDependencies();
  }, [fetchDependencies]);

  // Fetch candidate tasks in the same project
  useEffect(() => {
    const projId = (task?.project?._id || task?.project)?.toString();
    if (projId) {
      api.get(`/tasks?project=${projId}&limit=100`)
        .then(({ data }) => {
          if (data?.tasks) {
            setCandidateTasks(data.tasks);
          }
        })
        .catch(() => setCandidateTasks([]));
    } else {
      setCandidateTasks([]);
    }
  }, [task]);

  const handleAddDependency = async (e) => {
    if (e) e.preventDefault();
    if (!selectedCandidateId || !task?._id) return;
    setAddingDependency(true);
    try {
      const res = await api.post(`/tasks/${task._id}/dependencies`, {
        dependsOnTaskId: selectedCandidateId,
      });
      if (res.data.success) {
        toast.success('Prerequisite dependency added');
        setSelectedCandidateId('');
        fetchDependencies();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add dependency');
    } finally {
      setAddingDependency(false);
    }
  };

  const handleRemoveDependency = async (dependencyTaskId) => {
    if (!task?._id) return;
    try {
      const res = await api.delete(`/tasks/${task._id}/dependencies/${dependencyTaskId}`);
      if (res.data.success) {
        toast.success('Dependency removed');
        fetchDependencies();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to remove dependency');
    }
  };

  // Initialize form whenever task changes
  useEffect(() => {
    if (task) {
      setDrawerForm({
        title: task.title || '',
        description: task.description || '',
        status: task.status || 'To Do',
        priority: task.priority || 'medium',
        dueDate: task.dueDate ? task.dueDate.split('T')[0] : '',
        isBlocked: Boolean(task.isBlocked),
        blockedReason: task.blockedReason || '',
        blockerEta: task.blockerEta ? task.blockerEta.split('T')[0] : '',
        estimateDays: task.estimateDays !== undefined && task.estimateDays !== null ? String(task.estimateDays) : '',
        milestone: task.milestone?._id || task.milestone || '',
      });
      setComments(task.comments || []);
      setIsDirty(false);
      setCommentText('');
    }
  }, [task]);

  const activePrimaryRisk = useMemo(() => {
    if (!task) return null;
    return getPrimaryRiskReason({
      ...task,
      status: drawerForm.status,
      priority: drawerForm.priority,
      dueDate: drawerForm.dueDate,
    });
  }, [task, drawerForm.status, drawerForm.priority, drawerForm.dueDate]);

  // Close Drawer with Unsaved Changes Guard
  const handleClose = useCallback(() => {
    if (isDirty) {
      const confirmed = window.confirm(
        'You have unsaved changes in this task. Close anyway?'
      );
      if (!confirmed) return;
    }
    setIsDirty(false);
    onClose();
  }, [isDirty, onClose]);

  // Escape key closes drawer
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && task) {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [task, handleClose]);

  const handleFieldChange = (field, value) => {
    setDrawerForm((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    if (!drawerForm.title.trim()) {
      return toast.error('Task title is required');
    }
    if (drawerForm.isBlocked && !drawerForm.blockedReason.trim()) {
      return toast.error('A reason is required when marking a task as blocked');
    }
    if (drawerForm.isBlocked && drawerForm.blockedReason.trim().length > 300) {
      return toast.error('Blocked reason cannot exceed 300 characters');
    }
    if (drawerForm.estimateDays !== '' && drawerForm.estimateDays !== null) {
      const parsedDays = Number(drawerForm.estimateDays);
      if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 60) {
        return toast.error('Estimate days must be an integer between 1 and 60');
      }
    }

    setSaving(true);
    try {
      const updates = {
        title: drawerForm.title.trim(),
        description: drawerForm.description.trim(),
        status: drawerForm.status,
        priority: drawerForm.priority,
        dueDate: drawerForm.dueDate ? new Date(drawerForm.dueDate).toISOString() : null,
        isBlocked: drawerForm.isBlocked,
        blockedReason: drawerForm.isBlocked ? drawerForm.blockedReason.trim() : '',
        blockerEta: drawerForm.isBlocked && drawerForm.blockerEta ? new Date(drawerForm.blockerEta).toISOString() : null,
        estimateDays: drawerForm.estimateDays !== '' && drawerForm.estimateDays !== null ? parseInt(drawerForm.estimateDays, 10) : null,
        milestone: drawerForm.milestone || null,
      };

      const updated = await onUpdateTask(task._id, updates);
      if (updated) {
        setDrawerForm({
          title: updated.title || '',
          description: updated.description || '',
          status: updated.status || 'To Do',
          priority: updated.priority || 'medium',
          dueDate: updated.dueDate ? updated.dueDate.split('T')[0] : '',
          isBlocked: Boolean(updated.isBlocked),
          blockedReason: updated.blockedReason || '',
          blockerEta: updated.blockerEta ? updated.blockerEta.split('T')[0] : '',
          estimateDays: updated.estimateDays !== undefined && updated.estimateDays !== null ? String(updated.estimateDays) : '',
          milestone: updated.milestone?._id || updated.milestone || '',
        });
        if (updated.comments) {
          setComments(updated.comments);
        }
      }
      setIsDirty(false);
      toast.success('Task updated');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update task');
    } finally {
      setSaving(false);
    }
  };

  const handleAddCommentSubmit = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;

    setSubmittingComment(true);
    try {
      const updatedComments = await onAddComment(task._id, commentText.trim());
      if (updatedComments) {
        setComments(updatedComments);
      }
      setCommentText('');
      toast.success('Comment added');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add comment');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDelete = async () => {
    if (!onDeleteTask) return;
    const confirmed = window.confirm(`Are you sure you want to delete "${task.title}"?`);
    if (!confirmed) return;

    try {
      await onDeleteTask(task._id);
      setIsDirty(false);
      onClose();
      toast.success('Task deleted');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete task');
    }
  };

  if (!task) return null;

  return (
    <div
      className="drawer-backdrop"
      onClick={handleClose}
      role="presentation"
    >
      <div
        className="task-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* DRAWER HEADER */}
        <div className="drawer-header">
          <div className="drawer-header-left">
            <span className={`badge badge-${drawerForm.status}`}>
              {drawerForm.status}
            </span>
            <h2 id="drawer-title" className="drawer-title">
              Task Details
            </h2>
          </div>

          <button
            type="button"
            className="drawer-close-btn"
            onClick={handleClose}
            aria-label="Close task drawer"
          >
            ✕
          </button>
        </div>

        {/* DRAWER BODY */}
        <div className="drawer-body">
          {/* AT RISK INDICATOR */}
          {activePrimaryRisk && (
            <div className="drawer-risk-box">
              <strong>⚠️ At Risk:</strong> <span>{activePrimaryRisk}</span>
            </div>
          )}

          {/* TITLE */}
          <div className="drawer-field">
            <label htmlFor="drawer-title-input" className="drawer-label">
              Task Title *
            </label>
            <input
              id="drawer-title-input"
              type="text"
              className="drawer-input"
              value={drawerForm.title}
              onChange={(e) => handleFieldChange('title', e.target.value)}
              placeholder="Task title"
              required
            />
          </div>

          {/* DESCRIPTION */}
          <div className="drawer-field">
            <label htmlFor="drawer-desc-input" className="drawer-label">
              Description
            </label>
            <textarea
              id="drawer-desc-input"
              className="drawer-textarea"
              value={drawerForm.description}
              onChange={(e) => handleFieldChange('description', e.target.value)}
              placeholder="Add a detailed description..."
            />
          </div>

          {/* STATUS & PRIORITY */}
          <div className="drawer-row">
            <div className="drawer-field">
              <label htmlFor="drawer-status-select" className="drawer-label">
                Status
              </label>
              <select
                id="drawer-status-select"
                className="drawer-select"
                value={drawerForm.status}
                onChange={(e) => handleFieldChange('status', e.target.value)}
              >
                <option value="To Do">To Do</option>
                <option value="In Progress">In Progress</option>
                <option value="Done">Done</option>
              </select>
            </div>

            <div className="drawer-field">
              <label htmlFor="drawer-priority-select" className="drawer-label">
                Priority
              </label>
              <select
                id="drawer-priority-select"
                className="drawer-select"
                value={drawerForm.priority}
                onChange={(e) => handleFieldChange('priority', e.target.value)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          {/* DUE DATE & ESTIMATE DAYS */}
          <div className="drawer-row">
            <div className="drawer-field">
              <label htmlFor="drawer-due-input" className="drawer-label">
                Due Date
              </label>
              <input
                id="drawer-due-input"
                type="date"
                className="drawer-input"
                value={drawerForm.dueDate}
                onChange={(e) => handleFieldChange('dueDate', e.target.value)}
              />
            </div>
            <div className="drawer-field">
              <label htmlFor="drawer-estimate-input" className="drawer-label">
                Estimate (Days, 1–60)
              </label>
              <input
                id="drawer-estimate-input"
                type="number"
                min="1"
                max="60"
                step="1"
                placeholder="e.g. 3"
                className="drawer-input"
                value={drawerForm.estimateDays}
                onChange={(e) => handleFieldChange('estimateDays', e.target.value)}
              />
            </div>
          </div>

          {/* PROJECT & ASSIGNEE (READ-ONLY CONTEXT) */}
          <div className="drawer-row">
            <div className="drawer-field">
              <span className="drawer-label">Project</span>
              <div style={{ fontSize: '13px', color: 'var(--text-2, #a0a0aa)', paddingTop: '4px' }}>
                {task.project?.name || 'No project assigned'}
              </div>
            </div>

            <div className="drawer-field">
              <span className="drawer-label">Assignee</span>
              <div style={{ fontSize: '13px', color: 'var(--text-2, #a0a0aa)', paddingTop: '4px' }}>
                {task.assignedTo?.name || 'Unassigned'}
              </div>
            </div>
          </div>

          {/* MILESTONE CHECKPOINT SELECTOR */}
          {task.project && (
            <div className="drawer-field">
              <label htmlFor="drawer-milestone-select" className="drawer-label">
                Milestone Checkpoint
              </label>
              <select
                id="drawer-milestone-select"
                className="drawer-select"
                value={drawerForm.milestone}
                onChange={(e) => handleFieldChange('milestone', e.target.value)}
              >
                <option value="">No Milestone (Unassigned)</option>
                {projectMilestones
                  .filter((m) => m.status !== 'cancelled' || m._id === drawerForm.milestone)
                  .map((m) => (
                    <option key={m._id} value={m._id} disabled={m.status === 'cancelled'}>
                      {m.status === 'cancelled'
                        ? `[Cancelled] ${m.title}`
                        : `#${m.sequence || 1} ${m.title} (${m.status})`}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* BLOCKER WORKFLOW */}
          <div className="drawer-blocker-box">
            <label className="blocker-toggle-label">
              <input
                type="checkbox"
                checked={drawerForm.isBlocked}
                onChange={(e) => {
                  const blocked = e.target.checked;
                  handleFieldChange('isBlocked', blocked);
                  if (!blocked) {
                    handleFieldChange('blockedReason', '');
                    handleFieldChange('blockerEta', '');
                  }
                }}
              />
              <span>Mark as blocked</span>
            </label>

            {drawerForm.isBlocked && (
              <>
                <div className="drawer-field" style={{ marginTop: '10px' }}>
                  <label htmlFor="drawer-blocker-reason" className="drawer-label" style={{ color: '#fca5a5' }}>
                    Blocker Reason * (max 300 chars)
                  </label>
                  <textarea
                    id="drawer-blocker-reason"
                    className="blocker-reason-textarea"
                    placeholder="Specify what is blocking this task..."
                    maxLength={300}
                    value={drawerForm.blockedReason}
                    onChange={(e) => handleFieldChange('blockedReason', e.target.value)}
                    required
                    aria-required="true"
                  />
                  <span style={{ fontSize: '11px', color: '#8f96a3', textAlign: 'right', display: 'block' }}>
                    {drawerForm.blockedReason.length}/300
                  </span>
                </div>
                <div className="drawer-field" style={{ marginTop: '8px' }}>
                  <label htmlFor="drawer-blocker-eta" className="drawer-label" style={{ color: '#fca5a5' }}>
                    Blocker Expected Resolution (ETA)
                  </label>
                  <input
                    id="drawer-blocker-eta"
                    type="date"
                    className="drawer-input"
                    value={drawerForm.blockerEta}
                    onChange={(e) => handleFieldChange('blockerEta', e.target.value)}
                  />
                  <span style={{ fontSize: '11px', color: '#8f96a3', marginTop: '2px', display: 'block' }}>
                    Optional projected unblock date used for delivery slip forecasting
                  </span>
                </div>
              </>
            )}
          </div>

          {/* TASK DEPENDENCIES & INTELLIGENCE */}
          {task.project && (
            <div
              className="drawer-dependencies-box"
              style={{
                background: 'var(--bg-3, #1c1c1f)',
                border: '1px solid var(--border, #2a2a2e)',
                borderRadius: '10px',
                padding: '14px',
                marginTop: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="drawer-label" style={{ margin: 0, fontWeight: 700 }}>
                  ◈ Dependencies & Readiness
                </span>
                {dependencyData?.task?.dependencyState && (
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: '6px',
                      background:
                        dependencyData.task.dependencyState === 'ready'
                          ? 'rgba(16, 185, 129, 0.15)'
                          : dependencyData.task.dependencyState === 'waiting'
                          ? 'rgba(245, 158, 11, 0.15)'
                          : dependencyData.task.dependencyState === 'completed'
                          ? 'rgba(59, 130, 246, 0.15)'
                          : 'rgba(239, 68, 68, 0.15)',
                      color:
                        dependencyData.task.dependencyState === 'ready'
                          ? '#34d399'
                          : dependencyData.task.dependencyState === 'waiting'
                          ? '#fbbf24'
                          : dependencyData.task.dependencyState === 'completed'
                          ? '#60a5fa'
                          : '#f87171',
                      border: '1px solid currentColor',
                    }}
                  >
                    {dependencyData.task.dependencyState === 'ready' && '✓ Ready to Start'}
                    {dependencyData.task.dependencyState === 'waiting' && '⏳ Waiting on Prereqs'}
                    {dependencyData.task.dependencyState === 'blocked_and_waiting' && '⚠️ Blocked & Waiting'}
                    {dependencyData.task.dependencyState === 'blocked' && '⚠️ Blocked'}
                    {dependencyData.task.dependencyState === 'completed' && '✓ Completed'}
                  </span>
                )}
              </div>

              {/* Delivery Intelligence Indicators */}
              {dependencyData?.dependents?.length > 0 && (
                <div style={{ fontSize: '11px', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)', padding: '4px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>⚡</span>
                  <span>Impacts {dependencyData.dependents.length} downstream task{dependencyData.dependents.length > 1 ? 's' : ''}</span>
                </div>
              )}

              {/* Prerequisites list (Waiting on) */}
              <div>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-3, #606068)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Waiting on ({dependencyData?.prerequisites?.length || 0})
                </span>
                {(!dependencyData?.prerequisites || dependencyData.prerequisites.length === 0) ? (
                  <p style={{ fontSize: '12px', color: 'var(--text-2, #a0a0aa)', margin: '4px 0' }}>
                    No prerequisites. This task can start immediately.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                    {dependencyData.prerequisites.map((p) => (
                      <div
                        key={p.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          background: 'var(--bg-2, #141416)',
                          borderRadius: '6px',
                          fontSize: '12px',
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>
                          {p.resolved ? '✓ ' : '⏳ '} {p.title}
                          <span style={{ fontSize: '10px', color: 'var(--text-2, #a0a0aa)', marginLeft: '6px' }}>
                            ({p.status})
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveDependency(p.id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-3, #606068)',
                            cursor: 'pointer',
                            padding: '2px 6px',
                            borderRadius: '4px',
                          }}
                          title="Remove dependency"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Dependents list (Unblocks) */}
              <div>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-3, #606068)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Unblocks ({dependencyData?.dependents?.length || 0})
                </span>
                {(!dependencyData?.dependents || dependencyData.dependents.length === 0) ? (
                  <p style={{ fontSize: '12px', color: 'var(--text-2, #a0a0aa)', margin: '4px 0' }}>
                    No downstream tasks depend on this task.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                    {dependencyData.dependents.map((d) => (
                      <div
                        key={d.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          background: 'var(--bg-2, #141416)',
                          borderRadius: '6px',
                          fontSize: '12px',
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          → {d.title}
                          <span style={{ fontSize: '10px', color: 'var(--text-2, #a0a0aa)', marginLeft: '6px' }}>
                            ({d.status})
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add Prerequisite Form */}
              <div style={{ marginTop: '6px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
                <form onSubmit={handleAddDependency} style={{ display: 'flex', gap: '8px' }}>
                  <select
                    className="drawer-select"
                    style={{ flex: 1, minHeight: '34px', fontSize: '12px', padding: '4px 8px' }}
                    value={selectedCandidateId}
                    onChange={(e) => setSelectedCandidateId(e.target.value)}
                  >
                    <option value="">+ Add prerequisite task...</option>
                    {candidateTasks
                      .filter((c) => {
                        const cId = c._id?.toString() || c.id?.toString();
                        if (cId === task._id?.toString()) return false;
                        if (dependencyData?.prerequisites?.some((p) => p.id === cId)) return false;
                        if (dependencyData?.dependents?.some((d) => d.id === cId)) return false;
                        return true;
                      })
                      .map((c) => (
                        <option key={c._id} value={c._id}>
                          {c.title} ({c.status})
                        </option>
                      ))}
                  </select>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ minHeight: '34px', fontSize: '12px', padding: '4px 12px' }}
                    disabled={!selectedCandidateId || addingDependency}
                  >
                    {addingDependency ? 'Adding...' : 'Add'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* COMMENTS TIMELINE */}
          <div className="drawer-comments-section">
            <label className="drawer-label">
              Comments ({comments.length})
            </label>

            <div className="comments-timeline">
              {comments.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#71717a', padding: '10px 0' }}>
                  No comments yet. Start the conversation below.
                </div>
              ) : (
                comments.map((c, i) => (
                  <div key={c._id || i} className="comment-bubble">
                    <div className="comment-bubble-header">
                      <span className="comment-bubble-author">
                        {c.user?.name || 'User'}
                      </span>
                      <span>
                        {c.createdAt
                          ? new Date(c.createdAt).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : 'Just now'}
                      </span>
                    </div>
                    <div className="comment-bubble-text">{c.text}</div>
                  </div>
                ))
              )}
            </div>

            {/* ADD COMMENT FORM */}
            <form onSubmit={handleAddCommentSubmit} className="add-comment-form">
              <textarea
                className="comment-input"
                placeholder="Write an operational comment..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                rows={2}
              />
              <button
                type="submit"
                className="btn btn-secondary"
                disabled={submittingComment || !commentText.trim()}
                style={{ alignSelf: 'flex-end', padding: '6px 14px', fontSize: '12px' }}
              >
                {submittingComment ? 'Posting...' : 'Post Comment'}
              </button>
            </form>
          </div>
        </div>

        {/* DRAWER FOOTER */}
        <div className="drawer-footer">
          {canDelete && onDeleteTask && (
            <button
              type="button"
              className="btn btn-danger"
              style={{ marginRight: 'auto' }}
              onClick={handleDelete}
            >
              Delete
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClose}
          >
            Cancel
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
