import React, { useState, useEffect, useCallback } from 'react';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import SupersedeModal from './SupersedeModal';
import toast from 'react-hot-toast';
import './DecisionDrawer.css';

export default function DecisionDrawer({
  decisionId,
  onClose,
  onDecisionUpdated,
  onEditDecision,
}) {
  const { user, isAdmin, isManager } = useAuth();

  const [decision, setDecision] = useState(null);
  const [impact, setImpact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [error, setError] = useState('');

  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'alternatives' | 'impact' | 'audit'
  const [showSupersedeModal, setShowSupersedeModal] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  // Fetch full decision detail
  const fetchDecision = useCallback(async () => {
    if (!decisionId) return;
    setLoading(true);
    setError('');

    try {
      const res = await api.get(`/decisions/${decisionId}`);
      if (res.data?.success) {
        setDecision(res.data.decision);
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to load decision';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [decisionId]);

  // Fetch deterministic delivery impact
  const fetchImpact = useCallback(async () => {
    if (!decisionId) return;
    setLoadingImpact(true);

    try {
      const res = await api.get(`/decisions/${decisionId}/impact`);
      if (res.data?.success) {
        setImpact(res.data.impact);
      }
    } catch (err) {
      console.error('Failed to fetch decision impact', err);
    } finally {
      setLoadingImpact(false);
    }
  }, [decisionId]);

  useEffect(() => {
    fetchDecision();
    fetchImpact();
  }, [fetchDecision, fetchImpact]);

  // Close drawer on ESC
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!decisionId) return null;

  // Authorization checks
  const isAuthor = Boolean(
    user && decision?.proposedBy &&
    (decision.proposedBy._id || decision.proposedBy).toString() === (user._id || user.id).toString()
  );
  const isProjectManager = isManager && Boolean(
    decision?.project?.owner &&
    (decision.project.owner._id || decision.project.owner).toString() === (user._id || user.id).toString()
  );
  const canDecide = isAdmin || isProjectManager;
  const canEdit = decision?.status === 'proposed' && (isAuthor || canDecide);

  // Lifecycle transitions
  const handleTransition = async (newStatus) => {
    if (newStatus === 'superseded') {
      setShowSupersedeModal(true);
      return;
    }

    const confirmMsg = `Are you sure you want to transition this decision to "${newStatus}"?`;
    if (!window.confirm(confirmMsg)) return;

    setTransitioning(true);
    try {
      const res = await api.post(`/decisions/${decision._id}/transition`, {
        status: newStatus,
      });
      toast.success(`Decision marked as ${newStatus}`);
      setDecision(res.data.decision);
      fetchImpact();
      if (onDecisionUpdated) onDecisionUpdated(res.data.decision);
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Transition failed';
      toast.error(msg);
    } finally {
      setTransitioning(false);
    }
  };

  const statusColors = {
    proposed: { bg: 'rgba(245, 158, 11, 0.12)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' },
    accepted: { bg: 'rgba(16, 185, 129, 0.12)', text: '#10b981', border: 'rgba(16, 185, 129, 0.3)' },
    rejected: { bg: 'rgba(239, 68, 68, 0.12)', text: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' },
    superseded: { bg: 'rgba(139, 92, 246, 0.12)', text: '#a78bfa', border: 'rgba(139, 92, 246, 0.3)' },
    withdrawn: { bg: 'rgba(107, 114, 128, 0.12)', text: '#9ca3af', border: 'rgba(107, 114, 128, 0.3)' },
  };

  const impactColors = {
    critical_path: { bg: 'rgba(239, 68, 68, 0.15)', text: '#f87171', border: 'rgba(239, 68, 68, 0.4)' },
    delivery_relevant: { bg: 'rgba(59, 130, 246, 0.15)', text: '#60a5fa', border: 'rgba(59, 130, 246, 0.4)' },
    contained: { bg: 'rgba(107, 114, 128, 0.15)', text: '#d1d5db', border: 'rgba(107, 114, 128, 0.4)' },
    historical: { bg: 'rgba(139, 92, 246, 0.12)', text: '#c4b5fd', border: 'rgba(139, 92, 246, 0.3)' },
    insufficient_data: { bg: 'rgba(245, 158, 11, 0.12)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.3)' },
  };

  const currentStatusStyle = statusColors[decision?.status] || statusColors.proposed;
  const currentImpactStyle = impact ? (impactColors[impact.impactClassification || impact.classification] || impactColors.contained) : impactColors.contained;

  return (
    <div className="decision-drawer-overlay" onClick={onClose}>
      <div className="decision-drawer-panel" onClick={(e) => e.stopPropagation()}>
        {/* Drawer Header */}
        <div className="drawer-header">
          <div className="drawer-header-top">
            <div className="badges-row">
              {decision && (
                <span
                  className="status-badge"
                  style={{
                    backgroundColor: currentStatusStyle.bg,
                    color: currentStatusStyle.text,
                    borderColor: currentStatusStyle.border,
                  }}
                >
                  {decision.status.toUpperCase()}
                </span>
              )}
              {impact && (
                <span
                  className="impact-badge"
                  style={{
                    backgroundColor: currentImpactStyle.bg,
                    color: currentImpactStyle.text,
                    borderColor: currentImpactStyle.border,
                  }}
                >
                  {(impact.impactClassification || impact.classification).replace('_', ' ').toUpperCase()}
                </span>
              )}
            </div>

            <button className="drawer-close-btn" onClick={onClose} aria-label="Close drawer">
              &times;
            </button>
          </div>

          {loading ? (
            <div className="drawer-title-skeleton" />
          ) : decision ? (
            <>
              <h2 className="drawer-title">{decision.title}</h2>
              <div className="drawer-meta-bar">
                <span>Project: <strong>{decision.project?.name || 'Project'}</strong></span>
                <span>•</span>
                <span>Proposed by: <strong>{decision.proposedBy?.name || 'Member'}</strong></span>
                {decision.decidedBy && (
                  <>
                    <span>•</span>
                    <span>Decided by: <strong>{decision.decidedBy?.name}</strong></span>
                    <span>({new Date(decision.decidedAt).toLocaleDateString()})</span>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="drawer-error">{error || 'Decision not found'}</div>
          )}

          {/* Navigation Tabs */}
          {decision && (
            <div className="drawer-nav-tabs">
              <button
                className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveTab('overview')}
              >
                Overview
              </button>
              <button
                className={`tab-btn ${activeTab === 'alternatives' ? 'active' : ''}`}
                onClick={() => setActiveTab('alternatives')}
              >
                Alternatives ({decision.alternatives?.length || 0})
              </button>
              <button
                className={`tab-btn ${activeTab === 'impact' ? 'active' : ''}`}
                onClick={() => setActiveTab('impact')}
              >
                Delivery Impact
                {impact?.summary?.totalAffectedTasks > 0 && (
                  <span className="tab-counter">{impact.summary.totalAffectedTasks}</span>
                )}
              </button>
              <button
                className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
                onClick={() => setActiveTab('audit')}
              >
                Decision Lifecycle
              </button>
            </div>
          )}
        </div>

        {/* Drawer Body */}
        <div className="drawer-body">
          {loading ? (
            <div className="drawer-loading-spinner">Loading architectural decision record...</div>
          ) : decision ? (
            <>
              {/* Member Privacy Scoped View Banner */}
              {impact?.isPartial && (
                <div className="privacy-partial-banner">
                  <div className="banner-icon">🔒</div>
                  <div className="banner-text">
                    <strong>Personal Scope · Partial View</strong>
                    <p>
                      You are viewing decisions and delivery impact scoped to your authorized work.
                      Critical-path and project-wide delivery drivers are restricted.
                    </p>
                  </div>
                </div>
              )}

              {/* Superseded Notification Banner */}
              {decision.status === 'superseded' && (
                <div className="superseded-banner">
                  <span className="superseded-icon">↳</span>
                  <div className="superseded-text">
                    <strong>This decision has been superseded.</strong>
                    {decision.supersededBy && (
                      <p>
                        Successor ADR: <strong>{decision.supersededBy.title || decision.supersededBy}</strong>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 1: OVERVIEW */}
              {activeTab === 'overview' && (
                <div className="tab-pane">
                  {/* Context */}
                  <div className="record-section">
                    <h3 className="section-title">Context & Problem Statement</h3>
                    <div className="section-content text-block">{decision.context}</div>
                  </div>

                  {/* Decision */}
                  <div className="record-section highlight-decision">
                    <h3 className="section-title">Architectural Decision</h3>
                    <div className="section-content text-block">{decision.decision}</div>
                  </div>

                  {/* Rationale */}
                  <div className="record-section">
                    <h3 className="section-title">Rationale & Tradeoff Analysis</h3>
                    <div className="section-content text-block">{decision.rationale}</div>
                  </div>

                  {/* Consequences */}
                  <div className="record-section">
                    <h3 className="section-title">Consequences & Implications</h3>
                    <div className="consequences-display-grid">
                      {/* Positive */}
                      <div className="consequence-display-box positive">
                        <span className="box-title">Expected Benefits (+{decision.consequences?.positive?.length || 0})</span>
                        {decision.consequences?.positive?.length > 0 ? (
                          <ul>
                            {decision.consequences.positive.map((p, i) => (
                              <li key={i}>{p}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="empty-subtext">None documented</div>
                        )}
                      </div>

                      {/* Negative */}
                      <div className="consequence-display-box negative">
                        <span className="box-title">Tradeoffs & Costs (-{decision.consequences?.negative?.length || 0})</span>
                        {decision.consequences?.negative?.length > 0 ? (
                          <ul>
                            {decision.consequences.negative.map((n, i) => (
                              <li key={i}>{n}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="empty-subtext">None documented</div>
                        )}
                      </div>

                      {/* Risks */}
                      <div className="consequence-display-box risk">
                        <span className="box-title">Risks & Watchpoints (!{decision.consequences?.risks?.length || 0})</span>
                        {decision.consequences?.risks?.length > 0 ? (
                          <ul>
                            {decision.consequences.risks.map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="empty-subtext">None documented</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: ALTERNATIVES */}
              {activeTab === 'alternatives' && (
                <div className="tab-pane">
                  <div className="record-section">
                    <h3 className="section-title">Evaluated Alternatives ({decision.alternatives?.length || 0})</h3>
                    <p className="section-intro">
                      Documented technical alternatives considered during decision formulation and the rationale for rejection.
                    </p>

                    {decision.alternatives?.length === 0 ? (
                      <div className="empty-state-card">No competing alternatives were formally recorded for this ADR.</div>
                    ) : (
                      <div className="alternatives-display-list">
                        {decision.alternatives.map((alt, i) => (
                          <div key={i} className="alt-display-card">
                            <div className="alt-display-header">
                              <span className="alt-number">Option {i + 1}</span>
                              <h4 className="alt-display-title">{alt.title}</h4>
                            </div>
                            {alt.reasonRejected && (
                              <div className="alt-rejection-reason">
                                <strong>Reason for Rejection:</strong> {alt.reasonRejected}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: DELIVERY IMPACT */}
              {activeTab === 'impact' && (
                <div className="tab-pane">
                  {loadingImpact ? (
                    <div className="drawer-loading-spinner">Computing deterministic delivery impact...</div>
                  ) : impact ? (
                    <div className="impact-container">
                      {/* Impact Header KPIs */}
                      <div className="impact-kpis-grid">
                        <div className="impact-kpi-card">
                          <span className="kpi-label">Structural Classification</span>
                          <span className="kpi-val classification-val">
                            {(impact.impactClassification || impact.classification).replace('_', ' ')}
                          </span>
                        </div>
                        <div className="impact-kpi-card">
                          <span className="kpi-label">Path Availability</span>
                          <span className="kpi-val">
                            {impact.pathAnalysis?.availability || 'insufficient_data'}
                          </span>
                        </div>
                        <div className="impact-kpi-card">
                          <span className="kpi-label">Total Affected Tasks</span>
                          <span className="kpi-val">
                            {impact.summary?.totalAffectedTasks != null
                              ? impact.summary.totalAffectedTasks
                              : (impact.summary?.visibleDirectTasksCount || 0) + (impact.summary?.visibleDownstreamTasksCount || 0)}
                          </span>
                        </div>
                        <div className="impact-kpi-card">
                          <span className="kpi-label">Affected Milestones</span>
                          <span className="kpi-val">{impact.affectedMilestones?.length || 0}</span>
                        </div>
                      </div>

                      {/* Structured Drivers */}
                      {impact.drivers?.length > 0 && (
                        <div className="record-section">
                          <h3 className="section-title">Deterministic Impact Drivers</h3>
                          <div className="drivers-list">
                            {impact.drivers.map((d, i) => (
                              <div key={i} className={`driver-item driver-${d.type}`}>
                                <span className="driver-bullet">•</span>
                                <span className="driver-message">{d.message || d.reason}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Directly Linked Tasks */}
                      <div className="record-section">
                        <h3 className="section-title">
                          Directly Linked Tasks ({impact.directlyLinkedTasks?.length || 0})
                        </h3>
                        {impact.directlyLinkedTasks?.length === 0 ? (
                          <div className="empty-subtext">No tasks directly linked.</div>
                        ) : (
                          <div className="tasks-impact-table">
                            {impact.directlyLinkedTasks.map((t) => (
                              <div key={t.id} className="task-impact-row">
                                <div className="task-info">
                                  <span className="task-title">{t.title}</span>
                                  {t.onCriticalPath && (
                                    <span className="critical-path-indicator">⚡ Critical Path</span>
                                  )}
                                  {t.isBlocked && (
                                    <span className="blocked-indicator">⛔ Blocked</span>
                                  )}
                                </div>
                                <div className="task-meta">
                                  {t.estimateDays != null && <span>{t.estimateDays}d est</span>}
                                  <span className={`status-pill pill-${t.status.toLowerCase().replace(/\s+/g, '-')}`}>
                                    {t.status}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Downstream Affected Tasks */}
                      <div className="record-section">
                        <h3 className="section-title">
                          Downstream Dependent Tasks ({impact.downstreamTasks?.length || 0})
                        </h3>
                        {impact.downstreamTasks?.length === 0 ? (
                          <div className="empty-subtext">No downstream dependent tasks affected.</div>
                        ) : (
                          <div className="tasks-impact-table">
                            {impact.downstreamTasks.map((t) => (
                              <div key={t.id} className="task-impact-row">
                                <div className="task-info">
                                  <span className="task-title">{t.title}</span>
                                  {t.onCriticalPath && (
                                    <span className="critical-path-indicator">⚡ Critical Path</span>
                                  )}
                                  {t.isBlocked && (
                                    <span className="blocked-indicator">⛔ Blocked</span>
                                  )}
                                </div>
                                <div className="task-meta">
                                  {t.estimateDays != null && <span>{t.estimateDays}d est</span>}
                                  <span className={`status-pill pill-${t.status.toLowerCase().replace(/\s+/g, '-')}`}>
                                    {t.status}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Affected Milestones & Releases */}
                      {(impact.affectedMilestones?.length > 0 || impact.affectedReleases?.length > 0) && (
                        <div className="record-section">
                          <h3 className="section-title">Milestone & Release Exposure</h3>
                          <div className="milestones-releases-grid">
                            {impact.affectedMilestones?.map((m) => (
                              <div key={m.id} className="mr-card milestone-card">
                                <span className="mr-type">Milestone</span>
                                <span className="mr-name">{m.title}</span>
                                <span className="mr-status">{m.status}</span>
                              </div>
                            ))}
                            {impact.affectedReleases?.map((r) => (
                              <div key={r.id} className="mr-card release-card">
                                <span className="mr-type">Release</span>
                                <span className="mr-name">{r.name} ({r.version})</span>
                                <span className="mr-status">{r.forecastStatus || r.status}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="empty-state-card">Impact data could not be computed.</div>
                  )}
                </div>
              )}

              {/* TAB 4: AUDIT */}
              {activeTab === 'audit' && (
                <div className="tab-pane">
                  <div className="record-section">
                    <h3 className="section-title">Decision Lifecycle Record</h3>
                    <p className="section-intro">
                      TaskFlow records decision lifecycle state and transitions. Terminal and accepted decisions cannot be mutated.
                    </p>

                    {new Date(decision.createdAt) < new Date('2026-09-13T00:00:00.000Z') && (
                      <div
                        style={{
                          background: 'rgba(245, 158, 11, 0.08)',
                          border: '1px solid rgba(245, 158, 11, 0.25)',
                          borderRadius: '8px',
                          padding: '10px 14px',
                          marginBottom: '16px',
                          fontSize: '12px',
                          color: '#fbbf24',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <span>ℹ️</span>
                        <span>
                          <strong>Pre-Ledger Record:</strong> This decision was created prior to Phase 7 Ledger enablement. Subsequent lifecycle transitions and mutations are tracked in the versioned execution ledger.
                        </span>
                      </div>
                    )}

                    <div className="audit-details-card">
                      <div className="audit-row">
                        <span className="audit-label">ADR Identifier:</span>
                        <span className="audit-val mono">{decision._id}</span>
                      </div>
                      <div className="audit-row">
                        <span className="audit-label">Current State:</span>
                        <span className="audit-val font-semibold">{decision.status}</span>
                      </div>
                      <div className="audit-row">
                        <span className="audit-label">Proposed By:</span>
                        <span className="audit-val">{decision.proposedBy?.name || 'Unknown'} ({decision.proposedBy?.email || '—'})</span>
                      </div>
                      <div className="audit-row">
                        <span className="audit-label">Created At:</span>
                        <span className="audit-val">{new Date(decision.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="audit-row">
                        <span className="audit-label">Last Updated:</span>
                        <span className="audit-val">{new Date(decision.updatedAt).toLocaleString()}</span>
                      </div>
                      {decision.decidedBy && (
                        <>
                          <div className="audit-row">
                            <span className="audit-label">Decided By:</span>
                            <span className="audit-val">{decision.decidedBy?.name} ({decision.decidedBy?.role})</span>
                          </div>
                          <div className="audit-row">
                            <span className="audit-label">Decided At:</span>
                            <span className="audit-val">{new Date(decision.decidedAt).toLocaleString()}</span>
                          </div>
                        </>
                      )}
                      {decision.supersededBy && (
                        <div className="audit-row">
                          <span className="audit-label">Superseded By ADR:</span>
                          <span className="audit-val mono">{decision.supersededBy._id || decision.supersededBy}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Drawer Footer Actions */}
        {decision && (
          <div className="drawer-footer-actions">
            {/* If Proposed: Author or Admin/Manager can withdraw, Admin/Manager can Accept/Reject */}
            {decision.status === 'proposed' && (
              <>
                {canEdit && onEditDecision && (
                  <button
                    type="button"
                    className="btn-drawer btn-edit"
                    onClick={() => onEditDecision(decision)}
                    disabled={transitioning}
                  >
                    Edit Decision
                  </button>
                )}
                {(isAuthor || canDecide) && (
                  <button
                    type="button"
                    className="btn-drawer btn-withdraw"
                    onClick={() => handleTransition('withdrawn')}
                    disabled={transitioning}
                  >
                    Withdraw
                  </button>
                )}
                {canDecide && (
                  <>
                    <button
                      type="button"
                      className="btn-drawer btn-reject"
                      onClick={() => handleTransition('rejected')}
                      disabled={transitioning}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="btn-drawer btn-accept"
                      onClick={() => handleTransition('accepted')}
                      disabled={transitioning}
                    >
                      Accept Decision
                    </button>
                  </>
                )}
              </>
            )}

            {/* If Accepted: Admin/Manager can supersede */}
            {decision.status === 'accepted' && canDecide && (
              <button
                type="button"
                className="btn-drawer btn-supersede"
                onClick={() => setShowSupersedeModal(true)}
                disabled={transitioning}
              >
                Supersede Decision...
              </button>
            )}
          </div>
        )}
      </div>

      {/* Supersession Selection Modal */}
      {showSupersedeModal && (
        <SupersedeModal
          decision={decision}
          isOpen={showSupersedeModal}
          onClose={() => setShowSupersedeModal(false)}
          onSuperseded={(updated) => {
            setDecision(updated);
            fetchImpact();
            if (onDecisionUpdated) onDecisionUpdated(updated);
          }}
        />
      )}
    </div>
  );
}
