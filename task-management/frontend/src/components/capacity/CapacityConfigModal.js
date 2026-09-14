import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import './CapacityConfigModal.css';

export default function CapacityConfigModal({
  isOpen,
  onClose,
  project,
  userToEdit,
  existingAllocation,
  onSuccess,
}) {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [availableDays, setAvailableDays] = useState(5.0);
  const [wipLimit, setWipLimit] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const isProjectActive = project && project.status === 'active';

  useEffect(() => {
    if (userToEdit) {
      setSelectedUserId(userToEdit._id || userToEdit.id || userToEdit);
    } else if (project?.members?.length > 0) {
      const firstMemberId = project.members[0].user?._id || project.members[0].user;
      setSelectedUserId(firstMemberId || '');
    }

    if (existingAllocation) {
      setAvailableDays(existingAllocation.availableDaysPerWeek ?? 5.0);
      setWipLimit(existingAllocation.wipLimit ?? 3);
    } else {
      setAvailableDays(5.0);
      setWipLimit(3);
    }
    setError('');
  }, [userToEdit, existingAllocation, project]);

  if (!isOpen) return null;

  // Compute live horizon capacity previews
  const preview7d = Math.round(((availableDays * 7) / 7) * 10) / 10;
  const preview14d = Math.round(((availableDays * 14) / 7) * 10) / 10;
  const preview30d = Math.round(((availableDays * 30) / 7) * 10) / 10;

  // Active project members candidates
  const candidateMembers = [];
  if (project?.owner) {
    const o = project.owner;
    candidateMembers.push({
      id: o._id || o.id || o,
      name: o.name ? `${o.name} (Owner)` : 'Project Owner',
    });
  }
  if (Array.isArray(project?.members)) {
    project.members.forEach((m) => {
      const u = m.user;
      if (u) {
        const uId = u._id || u.id || u;
        if (!candidateMembers.some((c) => c.id === uId)) {
          candidateMembers.push({
            id: uId,
            name: u.name || 'Team Member',
          });
        }
      }
    });
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedUserId) {
      setError('Please select a team member');
      return;
    }

    if (!isProjectActive) {
      setError(`Cannot configure capacity on a ${project?.status || 'non-active'} project.`);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await api.put(`/projects/${project._id || project.id}/capacity/${selectedUserId}`, {
        availableDaysPerWeek: Number(availableDays),
        wipLimit: Number(wipLimit),
      });

      if (res.data?.success) {
        toast.success(res.data.message || 'Capacity allocation updated');
        if (onSuccess) onSuccess();
        onClose();
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to save capacity configuration';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedUserId || !existingAllocation) return;
    if (!window.confirm('Are you sure you want to remove this capacity configuration? Workload will be shown as unconfigured.')) {
      return;
    }

    setDeleting(true);
    setError('');

    try {
      const res = await api.delete(`/projects/${project._id || project.id}/capacity/${selectedUserId}`);
      if (res.data?.success) {
        toast.success('Capacity allocation removed');
        if (onSuccess) onSuccess();
        onClose();
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to remove capacity configuration';
      setError(msg);
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="capacity-modal-title"
    >
      <div className="modal capacity-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 id="capacity-modal-title">Configure Team Capacity</h2>
            <p className="capacity-modal-subtitle">
              Set availability and WIP limit for project planning
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {!isProjectActive && (
          <div className="capacity-modal-alert">
            ⚠️ This project is {project?.status}. Capacity mutations are only allowed on active projects.
          </div>
        )}

        {error && <div className="capacity-modal-error">{error}</div>}

        <form onSubmit={handleSubmit} className="capacity-config-form">
          <div className="form-group">
            <label htmlFor="cap-user-select" className="form-label">
              Team Member *
            </label>
            <select
              id="cap-user-select"
              className="form-input"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              disabled={Boolean(userToEdit) || submitting || deleting || !isProjectActive}
              required
            >
              <option value="" disabled>Select Member</option>
              {candidateMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <div className="form-label-row">
              <label htmlFor="cap-days-input" className="form-label">
                Available Days / Week: <strong>{availableDays} days</strong>
              </label>
              <span className="field-hint">0.5 to 7.0 in 0.5 increments</span>
            </div>
            <input
              id="cap-days-input"
              type="range"
              min="0.5"
              max="7.0"
              step="0.5"
              value={availableDays}
              onChange={(e) => setAvailableDays(parseFloat(e.target.value))}
              disabled={submitting || deleting || !isProjectActive}
              className="capacity-slider"
            />
            <div className="slider-ticks">
              <span>0.5d</span>
              <span>2.5d</span>
              <span>5.0d (Standard)</span>
              <span>7.0d</span>
            </div>
          </div>

          <div className="form-group">
            <div className="form-label-row">
              <label htmlFor="cap-wip-input" className="form-label">
                Concurrent WIP Limit: <strong>{wipLimit} tasks</strong>
              </label>
              <span className="field-hint">Integer between 1 and 10</span>
            </div>
            <input
              id="cap-wip-input"
              type="number"
              min="1"
              max="10"
              step="1"
              value={wipLimit}
              onChange={(e) => setWipLimit(parseInt(e.target.value, 10) || 1)}
              disabled={submitting || deleting || !isProjectActive}
              className="form-input"
              required
            />
          </div>

          {/* DYNAMIC HORIZON PREVIEW */}
          <div className="capacity-preview-card">
            <h4>Estimated Working Capacity by Horizon</h4>
            <div className="capacity-preview-grid">
              <div className="preview-stat">
                <span className="preview-label">7 Days</span>
                <span className="preview-val">{preview7d} d</span>
              </div>
              <div className="preview-stat">
                <span className="preview-label">14 Days</span>
                <span className="preview-val">{preview14d} d</span>
              </div>
              <div className="preview-stat">
                <span className="preview-label">30 Days</span>
                <span className="preview-val">{preview30d} d</span>
              </div>
            </div>
            <p className="preview-disclaimer">
              Calculated linearly based on configured weekly availability. Leave and calendar holidays are not modeled in V1.
            </p>
          </div>

          <div className="modal-actions">
            {existingAllocation && isProjectActive && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={deleting || submitting}
              >
                {deleting ? 'Removing...' : 'Remove Configuration'}
              </button>
            )}
            <div className="modal-actions-right">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                disabled={submitting || deleting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || deleting || !isProjectActive}
              >
                {submitting ? 'Saving...' : 'Save Allocation'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
