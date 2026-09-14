import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

export default function SupersedeModal({
  decision,
  isOpen,
  onClose,
  onSuperseded,
}) {
  const [candidates, setCandidates] = useState([]);
  const [selectedReplacementId, setSelectedReplacementId] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !decision) return;
    setLoading(true);
    setError('');
    const projId = (decision.project?._id || decision.project || '').toString();

    // Fetch accepted decisions in the same project
    api.get(`/decisions?project=${projId}&status=accepted&limit=50`)
      .then((res) => {
        const list = res.data?.decisions || [];
        // Filter out self
        const validCandidates = list.filter((d) => d._id !== decision._id);
        setCandidates(validCandidates);
        if (validCandidates.length > 0) {
          setSelectedReplacementId(validCandidates[0]._id);
        }
      })
      .catch((err) => {
        setError('Failed to load eligible replacement decisions.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, decision]);

  if (!isOpen || !decision) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedReplacementId) {
      setError('Please select a valid accepted replacement decision.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await api.post(`/decisions/${decision._id}/transition`, {
        status: 'superseded',
        replacementDecisionId: selectedReplacementId,
      });

      toast.success('Decision superseded successfully');
      onSuperseded(res.data.decision);
      onClose();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to supersede decision';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="decision-modal-overlay" onClick={onClose}>
      <div
        className="decision-modal-content"
        style={{ maxWidth: '540px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="decision-modal-header">
          <div>
            <h2>Supersede Architectural Decision</h2>
            <p className="decision-modal-subtitle">
              Mark <strong>{decision.title}</strong> as superseded by a newer accepted decision.
            </p>
          </div>
          <button className="decision-modal-close" onClick={onClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        {error && <div className="decision-modal-error">{error}</div>}

        <form onSubmit={handleSubmit} className="decision-modal-form">
          <div className="form-group">
            <label htmlFor="replacement-select">
              Select Replacement Decision (Accepted Only) <span className="req">*</span>
            </label>
            {loading ? (
              <div className="entities-loading">Loading candidate decisions...</div>
            ) : candidates.length === 0 ? (
              <div style={{ color: '#f59e0b', fontSize: '0.85rem', padding: '8px 0' }}>
                No other accepted decisions exist in this project. You must propose and accept the replacement decision first before superseding this one.
              </div>
            ) : (
              <select
                id="replacement-select"
                value={selectedReplacementId}
                onChange={(e) => setSelectedReplacementId(e.target.value)}
                required
              >
                {candidates.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.title} ({c.updatedAt && !Number.isNaN(new Date(c.updatedAt).getTime()) ? new Date(c.updatedAt).toLocaleDateString() : 'Date unavailable'})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div style={{ fontSize: '0.8rem', color: '#888899', lineHeight: 1.4 }}>
            Supersession is irreversible and updates the decision lifecycle record. The replacement decision will be permanently linked as the successor in architectural history.
          </div>

          <div className="decision-modal-actions">
            <button type="button" className="btn-cancel" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-submit"
              style={{ background: '#8b5cf6' }}
              disabled={submitting || candidates.length === 0}
            >
              {submitting ? 'Superseding...' : 'Confirm Supersession'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
