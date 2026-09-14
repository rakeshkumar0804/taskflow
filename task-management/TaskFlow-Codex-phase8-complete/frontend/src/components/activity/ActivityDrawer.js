import React, { useEffect } from 'react';
import { CategoryBadge, VersionBadge, RoleBadge } from './ActivityBadge';
import './ActivityDrawer.css';

export default function ActivityDrawer({ event, onClose }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!event) return null;

  const actorName = event.actorSnapshot?.name || event.actor?.name || 'System';
  const actorRole = event.actorSnapshot?.role || event.actor?.role || 'user';
  const occurredDate = event.occurredAt ? new Date(event.occurredAt) : new Date(event.createdAt);

  const formatValue = (val) => {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  };

  return (
    <div className="activity-drawer-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="activity-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="activity-drawer-header">
          <div className="activity-drawer-title-wrap">
            <div className="activity-drawer-title-row">
              <CategoryBadge category={event.category} />
              <VersionBadge version={event.aggregateVersion} />
              <span className="activity-drawer-prop-val mono" style={{ fontSize: '11px' }}>
                {event.eventType}
              </span>
            </div>
            <h3 className="activity-drawer-title">{event.summary || event.eventType}</h3>
            <p className="activity-drawer-subtitle">
              {occurredDate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })}
            </p>
          </div>
          <button
            className="activity-drawer-close-btn"
            onClick={onClose}
            aria-label="Close activity detail drawer"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="activity-drawer-body">
          {/* Section 1: Aggregate Identity */}
          <div className="activity-drawer-section">
            <h4 className="activity-drawer-section-title">Aggregate Identity</h4>
            <div className="activity-drawer-grid">
              <div className="activity-drawer-prop">
                <span className="activity-drawer-prop-label">Subject Type</span>
                <span className="activity-drawer-prop-val" style={{ textTransform: 'capitalize' }}>
                  {event.subjectType}
                </span>
              </div>
              <div className="activity-drawer-prop">
                <span className="activity-drawer-prop-label">Subject Version</span>
                <span className="activity-drawer-prop-val">
                  <VersionBadge version={event.aggregateVersion} />
                </span>
              </div>
              <div className="activity-drawer-prop">
                <span className="activity-drawer-prop-label">Subject ID</span>
                <span className="activity-drawer-prop-val mono" title={String(event.subjectId)}>
                  {String(event.subjectId)}
                </span>
              </div>
              <div className="activity-drawer-prop">
                <span className="activity-drawer-prop-label">Subject Title Snapshot</span>
                <span className="activity-drawer-prop-val">
                  {event.subjectTitleSnapshot || '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Section 2: Actor Details */}
          <div className="activity-drawer-section">
            <h4 className="activity-drawer-section-title">Actor Information</h4>
            <div className="activity-drawer-grid">
              <div className="activity-drawer-prop">
                <span className="activity-drawer-prop-label">Name</span>
                <span className="activity-drawer-prop-val">{actorName}</span>
              </div>
              <div className="activity-drawer-prop">
                <span className="activity-drawer-prop-label">Role</span>
                <span className="activity-drawer-prop-val">
                  <RoleBadge role={actorRole} />
                </span>
              </div>
              <div className="activity-drawer-prop" style={{ gridColumn: 'span 2' }}>
                <span className="activity-drawer-prop-label">Actor ID</span>
                <span className="activity-drawer-prop-val mono">
                  {String(event.actor?._id || event.actor || 'system')}
                </span>
              </div>
            </div>
          </div>

          {/* Section 3: Traceability & History */}
          <div className="activity-drawer-section">
            <h4 className="activity-drawer-section-title">Traceability & Ledger History</h4>
            <div className="activity-drawer-grid">
              <div className="activity-drawer-prop" style={{ gridColumn: 'span 2' }}>
                <span className="activity-drawer-prop-label">Correlation ID</span>
                <span className="activity-drawer-prop-val mono">
                  {event.correlationId}
                </span>
              </div>
              <div className="activity-drawer-prop">
                <span className="activity-drawer-prop-label">Ledger Sequence</span>
                <span className="activity-drawer-prop-val mono">
                  v{event.aggregateVersion}
                </span>
              </div>
              <div className="activity-drawer-prop">
                <span className="activity-drawer-prop-label">Recorded At</span>
                <span className="activity-drawer-prop-val">
                  {new Date(event.createdAt || event.occurredAt).toISOString()}
                </span>
              </div>
            </div>
          </div>

          {/* Section 4: State Delta / Changes */}
          <div className="activity-drawer-section">
            <h4 className="activity-drawer-section-title">State Changes ({event.changes?.length || 0})</h4>
            {event.changes && event.changes.length > 0 ? (
              <table className="activity-diff-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Before</th>
                    <th>After</th>
                  </tr>
                </thead>
                <tbody>
                  {event.changes.map((c, idx) => (
                    <tr key={idx}>
                      <td className="activity-diff-field">{c.field}</td>
                      <td>
                        <span className="activity-diff-before">{formatValue(c.from)}</span>
                      </td>
                      <td>
                        <span className="activity-diff-after">{formatValue(c.to)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                No explicit field-level diff recorded for this event.
              </p>
            )}
          </div>

          {/* Section 5: Metadata (if any) */}
          {event.metadata && Object.keys(event.metadata).length > 0 && (
            <div className="activity-drawer-section">
              <h4 className="activity-drawer-section-title">Event Metadata</h4>
              <div className="activity-drawer-grid">
                {Object.entries(event.metadata).map(([key, val]) => (
                  <div key={key} className="activity-drawer-prop">
                    <span className="activity-drawer-prop-label">{key}</span>
                    <span className="activity-drawer-prop-val mono">{formatValue(val)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="activity-drawer-footer">
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              color: '#e2e8f0',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '500',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
