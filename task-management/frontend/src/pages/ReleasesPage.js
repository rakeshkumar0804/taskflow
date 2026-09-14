import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import DecisionDrawer from '../components/decisions/DecisionDrawer';
import toast from 'react-hot-toast';
import './ReleasesPage.css';

// Clean, local SVG icons (zero external packages)
const Icons = {
  Rocket: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-3.05 11a22.35 22.35 0 0 1-3.95 2z" />
    </svg>
  ),
  Plus: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Search: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  Blocker: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  ),
  Clock: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  Check: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Close: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  CriticalPath: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  AlertTriangle: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
};

export default function ReleasesPage() {
  const { user, isAdmin, isManager } = useAuth();
  const canManage = isAdmin || isManager;

  const [releases, setReleases] = useState([]);
  const [forecasts, setForecasts] = useState({});
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('active_targets');

  // Modals
  const [showCreateReleaseModal, setShowCreateReleaseModal] = useState(false);
  const [showCreateMilestoneModal, setShowCreateMilestoneModal] = useState(false);
  const [inspectingRelease, setInspectingRelease] = useState(null);
  const [inspectingMilestones, setInspectingMilestones] = useState([]);
  const [releaseDecisions, setReleaseDecisions] = useState([]);
  const [inspectingDecisionId, setInspectingDecisionId] = useState(null);

  useEffect(() => {
    if (!inspectingRelease?._id) {
      setReleaseDecisions([]);
      return;
    }
    api.get(`/decisions?release=${inspectingRelease._id}`)
      .then(({ data }) => {
        if (data?.success) setReleaseDecisions(data.decisions || []);
      })
      .catch(() => setReleaseDecisions([]));
  }, [inspectingRelease?._id]);

  // Create Release Form State
  const [releaseForm, setReleaseForm] = useState({
    name: '',
    version: '',
    description: '',
    targetDate: '',
    status: 'planning',
    project: '',
  });
  const [submittingRelease, setSubmittingRelease] = useState(false);
  const [releaseFormError, setReleaseFormError] = useState('');

  // Create Milestone Form State
  const [milestoneForm, setMilestoneForm] = useState({
    title: '',
    description: '',
    dueDate: '',
    sequence: 1,
    status: 'open',
    project: '',
    release: '',
  });
  const [submittingMilestone, setSubmittingMilestone] = useState(false);
  const [milestoneFormError, setMilestoneFormError] = useState('');

  // Fetch Projects
  const fetchProjects = useCallback(async () => {
    try {
      const { data } = await api.get('/projects');
      if (data?.success && Array.isArray(data.projects)) {
        setProjects(data.projects.filter((p) => p.status !== 'archived'));
      }
    } catch (err) {
      console.error('Failed to fetch projects', err);
    }
  }, []);

  // Fetch Releases
  const fetchReleases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/releases?includeCancelled=true');
      if (data?.success) {
        const rels = data.releases || [];
        setReleases(rels);

        // Fetch delivery intelligence forecasts asynchronously for active releases
        const active = rels.filter((r) => r.status !== 'cancelled' && r.status !== 'shipped');
        Promise.all(
          active.map((r) =>
            api
              .get(`/releases/${r._id}/delivery-intelligence`)
              .then((res) => ({ id: r._id, forecast: res.data?.forecast }))
              .catch(() => null)
          )
        ).then((results) => {
          const map = {};
          for (const item of results) {
            if (item?.forecast) map[item.id] = item.forecast;
          }
          setForecasts(map);
        });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load releases. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReleases();
    fetchProjects();
  }, [fetchReleases, fetchProjects]);

  // Filtered releases
  const filteredReleases = useMemo(() => {
    return releases.filter((r) => {
      const matchesSearch =
        searchQuery === '' ||
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.version.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesProject =
        selectedProject === 'all' ||
        (r.project && (r.project._id === selectedProject || r.project === selectedProject));

      const matchesStatus =
        selectedStatus === 'all'
          ? true
          : selectedStatus === 'active_targets'
          ? r.status !== 'cancelled'
          : r.status === selectedStatus;

      return matchesSearch && matchesProject && matchesStatus;
    });
  }, [releases, searchQuery, selectedProject, selectedStatus]);

  // Handle Create Release
  const handleCreateRelease = async (e) => {
    e.preventDefault();
    setReleaseFormError('');

    if (!releaseForm.name.trim()) {
      setReleaseFormError('Release name is required');
      return;
    }
    if (!releaseForm.version.trim()) {
      setReleaseFormError('Version is required');
      return;
    }
    if (!releaseForm.targetDate) {
      setReleaseFormError('Target date is required');
      return;
    }
    if (!releaseForm.project) {
      setReleaseFormError('Project is required');
      return;
    }

    setSubmittingRelease(true);
    try {
      await api.post('/releases', {
        name: releaseForm.name.trim(),
        version: releaseForm.version.trim(),
        description: releaseForm.description.trim(),
        targetDate: releaseForm.targetDate,
        status: releaseForm.status,
        project: releaseForm.project,
      });

      toast.success('Release created successfully');
      setShowCreateReleaseModal(false);
      setReleaseForm({
        name: '',
        version: '',
        description: '',
        targetDate: '',
        status: 'planning',
        project: '',
      });
      fetchReleases();
    } catch (err) {
      setReleaseFormError(err.response?.data?.message || 'Failed to create release');
    } finally {
      setSubmittingRelease(false);
    }
  };

  // Handle Create Milestone
  const handleCreateMilestone = async (e) => {
    e.preventDefault();
    setMilestoneFormError('');

    if (!milestoneForm.title.trim()) {
      setMilestoneFormError('Milestone title is required');
      return;
    }
    if (!milestoneForm.dueDate) {
      setMilestoneFormError('Due date is required');
      return;
    }
    if (!milestoneForm.project) {
      setMilestoneFormError('Project is required');
      return;
    }

    setSubmittingMilestone(true);
    try {
      await api.post('/milestones', {
        title: milestoneForm.title.trim(),
        description: milestoneForm.description.trim(),
        dueDate: milestoneForm.dueDate,
        sequence: Math.max(1, parseInt(milestoneForm.sequence, 10) || 1),
        status: milestoneForm.status,
        project: milestoneForm.project,
        release: milestoneForm.release || null,
      });

      toast.success('Milestone created successfully');
      setShowCreateMilestoneModal(false);
      setMilestoneForm({
        title: '',
        description: '',
        dueDate: '',
        sequence: 1,
        status: 'open',
        project: '',
        release: '',
      });
      fetchReleases();
    } catch (err) {
      setMilestoneFormError(err.response?.data?.message || 'Failed to create milestone');
    } finally {
      setSubmittingMilestone(false);
    }
  };

  // Inspect Release Detail
  const handleInspectRelease = async (release) => {
    setInspectingRelease({
      ...release,
      forecast: forecasts[release._id] || null,
    });
    try {
      const [detailRes, intelRes] = await Promise.all([
        api.get(`/releases/${release._id}`),
        api.get(`/releases/${release._id}/delivery-intelligence`).catch(() => null),
      ]);
      if (detailRes?.data?.success) {
        setInspectingRelease({
          ...detailRes.data.release,
          readiness: detailRes.data.readiness || release.readiness,
          forecast: intelRes?.data?.forecast || forecasts[release._id] || null,
          intelPayload: intelRes?.data || null,
        });
        setInspectingMilestones(detailRes.data.milestones || []);
      }
    } catch (err) {
      toast.error('Failed to load release details');
    }
  };

  // Cancel Release
  const handleCancelRelease = async (releaseId) => {
    if (!window.confirm('Cancel this release? Historical audit and task data will be preserved.')) {
      return;
    }
    try {
      await api.delete(`/releases/${releaseId}`);
      toast.success('Release cancelled safely');
      if (inspectingRelease && inspectingRelease._id === releaseId) {
        setInspectingRelease(null);
      }
      fetchReleases();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel release');
    }
  };

  return (
    <div className="releases-page">
      {/* HEADER */}
      <div className="releases-header">
        <div className="releases-header-left">
          <div className="releases-title-row">
            <h1 className="releases-title">Releases & Milestones</h1>
            <span className="releases-badge">DELIVERY INTELLIGENCE</span>
          </div>
          <p className="releases-subtitle">
            Delivery targets, milestone checkpoints, and release-readiness intelligence.
          </p>
        </div>

        {canManage && (
          <div className="releases-actions">
            <button
              type="button"
              className="btn-secondary-release"
              onClick={() => setShowCreateMilestoneModal(true)}
            >
              <Icons.Plus />
              <span>New Milestone</span>
            </button>
            <Link
              to="/activity?category=release"
              className="btn-secondary-release"
              style={{ textDecoration: 'none' }}
              title="View release & milestone activity ledger"
            >
              <Icons.Clock />
              <span>Release Ledger</span>
            </Link>
            <button
              type="button"
              className="btn-primary-release"
              onClick={() => setShowCreateReleaseModal(true)}
            >
              <Icons.Rocket />
              <span>New Release</span>
            </button>
          </div>
        )}
      </div>

      {/* CONTROLS BAR */}
      <div className="releases-controls">
        <div className="releases-search-wrap">
          <span className="releases-search-icon">
            <Icons.Search />
          </span>
          <input
            type="text"
            className="releases-search-input"
            placeholder="Search releases by name or version..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="releases-filter-group">
          <select
            className="releases-select"
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            aria-label="Filter by project"
          >
            <option value="all">All Projects</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            className="releases-select"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="active_targets">Active Targets (Default)</option>
            <option value="all">All Releases (Inc. Cancelled)</option>
            <option value="planning">Planning</option>
            <option value="active">Active</option>
            <option value="code-freeze">Code Freeze</option>
            <option value="shipped">Shipped</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* CONTENT AREA */}
      {loading ? (
        <div className="releases-loading">
          <div className="spinner" />
          <p>Loading delivery targets & release readiness...</p>
        </div>
      ) : error ? (
        <div className="releases-error">
          <Icons.Blocker />
          <h3>Error loading releases</h3>
          <p>{error}</p>
          <button type="button" className="btn-secondary-release" onClick={fetchReleases}>
            Retry
          </button>
        </div>
      ) : filteredReleases.length === 0 ? (
        <div className="releases-empty">
          <span className="releases-empty-icon"><Icons.Rocket /></span>
          <h2 className="releases-empty-title">No releases yet</h2>
          <p className="releases-empty-desc">
            Create a delivery target to track milestones, tasks, blockers, and release-readiness intelligence.
          </p>
          {canManage && (
            <button
              type="button"
              className="btn-primary-release"
              onClick={() => setShowCreateReleaseModal(true)}
            >
              <Icons.Plus />
              <span>Create Release</span>
            </button>
          )}
        </div>
      ) : (
        <div className="releases-grid">
          {filteredReleases.map((release) => {
            const readiness = release.readiness || {};
            const metrics = readiness.metrics || {};
            const labelClass = readiness.label
              ? readiness.label.toLowerCase().replace(/\s+/g, '-')
              : 'insufficient-data';

            const formattedTarget = release.targetDate
              ? new Date(release.targetDate).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : 'TBD';

            return (
              <div key={release._id} className="release-card">
                <div className="release-card-top">
                  <div>
                    <span className="release-version-pill">{release.version}</span>
                    <h3 className="release-card-title">{release.name}</h3>
                  </div>
                  <span className={`release-status-badge ${release.status}`}>
                    {release.status}
                  </span>
                </div>

                {release.project && (
                  <div>
                    <span
                      className="release-project-tag"
                      style={{
                        borderColor: `${release.project.color || '#6366f1'}55`,
                        color: release.project.color || '#818cf8',
                      }}
                    >
                      {release.project.name}
                    </span>
                  </div>
                )}

                {/* READINESS SUMMARY BOX */}
                <div className="release-readiness-box">
                  <div className="release-readiness-header">
                    <div className="readiness-score-group">
                      {readiness.score !== null ? (
                        <>
                          <span className="readiness-score-number">{readiness.score}</span>
                          <span className="readiness-score-total">/100</span>
                        </>
                      ) : forecasts[release._id].status === 'indeterminate' ? (
                        <span style={{ color: '#a5b4fc', fontWeight: 600, fontSize: '11px' }}>
                          Forecast unavailable
                        </span>
                      ) : (
                        <span className="readiness-score-number" style={{ fontSize: '18px' }}>
                          —
                        </span>
                      )}
                    </div>
                    <span className={`readiness-label-badge ${labelClass}`}>
                      {readiness.label || 'INSUFFICIENT DATA'}
                    </span>
                  </div>

                  {/* MILESTONE PROGRESS */}
                  <div className="release-progress-bar-wrap">
                    <div className="release-progress-labels">
                      <span>Milestones Progress</span>
                      <span>
                        {metrics.completedMilestones || 0}/{metrics.totalMilestones || release.milestonesCount || 0}
                      </span>
                    </div>
                    <div className="release-progress-track">
                      <div
                        className="release-progress-fill"
                        style={{
                          width: `${
                            (metrics.totalMilestones || release.milestonesCount || 0) > 0
                              ? Math.round(
                                  ((metrics.completedMilestones || 0) /
                                    (metrics.totalMilestones || release.milestonesCount || 1)) *
                                    100
                                )
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* SIGNALS ROW */}
                  <div className="release-signal-row">
                    {(metrics.blockedTasks || 0) > 0 && (
                      <span className="signal-chip blocked">
                        <Icons.Blocker />
                        <span>{metrics.blockedTasks} blocker{metrics.blockedTasks > 1 ? 's' : ''}</span>
                      </span>
                    )}
                    {(metrics.overdueTasks || 0) > 0 && (
                      <span className="signal-chip overdue">
                        <Icons.Clock />
                        <span>{metrics.overdueTasks} overdue</span>
                      </span>
                    )}
                    {(metrics.blockedTasks || 0) === 0 && (metrics.overdueTasks || 0) === 0 && (
                      <span className="signal-chip clean">
                        <Icons.Check />
                        <span>No active blockers</span>
                      </span>
                    )}
                    {(metrics.staleTasks || 0) > 0 && (
                      <span className="signal-chip" style={{ background: 'rgba(148, 163, 184, 0.1)', color: '#94a3b8', borderColor: 'rgba(148, 163, 184, 0.25)' }}>
                        <Icons.Clock />
                        <span>{metrics.staleTasks} stale (Context only)</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* DELIVERY SLIP FORECAST BOX (PHASE 4) */}
                {forecasts[release._id] && (
                  <div
                    className="release-forecast-box"
                    style={{
                      background: 'rgba(15, 23, 42, 0.6)',
                      border: '1px solid #1e293b',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      marginTop: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Icons.CriticalPath /> Delivery Forecast
                      </span>
                      <span
                        className="forecast-status-badge"
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background:
                            forecasts[release._id].status === 'on_track'
                              ? 'rgba(16, 185, 129, 0.15)'
                              : forecasts[release._id].status === 'slipping'
                              ? 'rgba(239, 68, 68, 0.15)'
                              : forecasts[release._id].status === 'at_risk'
                              ? 'rgba(245, 158, 11, 0.15)'
                              : 'rgba(99, 102, 241, 0.15)',
                          color:
                            forecasts[release._id].status === 'on_track'
                              ? '#34d399'
                              : forecasts[release._id].status === 'slipping'
                              ? '#f87171'
                              : forecasts[release._id].status === 'at_risk'
                              ? '#fbbf24'
                              : '#818cf8',
                          border: '1px solid currentColor',
                        }}
                      >
                        {forecasts[release._id].status === 'indeterminate'
                          ? (forecasts[release._id].drivers?.some((d) => d.type === 'critical_blocker') || forecasts[release._id].criticalBlockerCount > 0
                              ? 'Blocked · ETA Required'
                              : 'INDETERMINATE')
                          : forecasts[release._id].status?.replace('_', ' ').toUpperCase()}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                      <span style={{ color: '#94a3b8' }}>
                        Predicted: {forecasts[release._id].forecastDate ? new Date(forecasts[release._id].forecastDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                      </span>
                      {forecasts[release._id].slipDays > 0 ? (
                        <span style={{ color: '#f87171', fontWeight: 600, fontSize: '11px' }}>
                          +{forecasts[release._id].slipDays}d slip
                        </span>
                      ) : (
                        <span style={{ color: '#34d399', fontWeight: 600, fontSize: '11px' }}>
                          On Schedule
                        </span>
                      )}
                    </div>

                    {forecasts[release._id].criticalBlockerCount > 0 && (
                      <div style={{ fontSize: '11px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Icons.Blocker />
                        <span>{forecasts[release._id].criticalBlockerCount} critical blocker delay</span>
                      </div>
                    )}
                  </div>
                )}

                {/* FOOTER */}
                <div className="release-card-footer">
                  <span className="release-date">Target: {formattedTarget}</span>
                  <div className="release-card-actions">
                    <button
                      type="button"
                      className="btn-card-action"
                      onClick={() => handleInspectRelease(release)}
                    >
                      Inspect Readiness
                    </button>
                    {canManage && release.status !== 'cancelled' && (
                      <button
                        type="button"
                        className="btn-card-action"
                        style={{ color: '#fca5a5' }}
                        onClick={() => handleCancelRelease(release._id)}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE RELEASE MODAL */}
      {showCreateReleaseModal && (
        <div className="releases-modal-backdrop" onClick={() => setShowCreateReleaseModal(false)}>
          <div className="releases-modal" onClick={(e) => e.stopPropagation()}>
            <div className="releases-modal-header">
              <h2 className="releases-modal-title">Create Release Target</h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowCreateReleaseModal(false)}
                aria-label="Close modal"
              >
                <Icons.Close />
              </button>
            </div>

            {releaseFormError && <div className="alert-box error">{releaseFormError}</div>}

            <form onSubmit={handleCreateRelease} className="releases-form">
              <div className="form-group">
                <label>Release Name *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Core Engine GA Launch"
                  value={releaseForm.name}
                  onChange={(e) => setReleaseForm({ ...releaseForm, name: e.target.value })}
                  maxLength={80}
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Version *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. v3.2.0-GA"
                    value={releaseForm.version}
                    onChange={(e) => setReleaseForm({ ...releaseForm, version: e.target.value })}
                    maxLength={30}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Status</label>
                  <select
                    className="form-select"
                    value={releaseForm.status}
                    onChange={(e) => setReleaseForm({ ...releaseForm, status: e.target.value })}
                  >
                    <option value="planning">Planning</option>
                    <option value="active">Active</option>
                    <option value="code-freeze">Code Freeze</option>
                    <option value="shipped">Shipped</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Project *</label>
                  <select
                    className="form-select"
                    value={releaseForm.project}
                    onChange={(e) => setReleaseForm({ ...releaseForm, project: e.target.value })}
                    required
                  >
                    <option value="">Select Project</option>
                    {projects.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Target Delivery Date *</label>
                  <input
                    type="date"
                    className="form-input"
                    value={releaseForm.targetDate}
                    onChange={(e) => setReleaseForm({ ...releaseForm, targetDate: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Description (Optional)</label>
                <textarea
                  className="form-textarea"
                  placeholder="Scope summary, acceptance criteria, or release goals..."
                  value={releaseForm.description}
                  onChange={(e) => setReleaseForm({ ...releaseForm, description: e.target.value })}
                  maxLength={1000}
                />
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn-secondary-release"
                  onClick={() => setShowCreateReleaseModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary-release"
                  disabled={submittingRelease}
                >
                  {submittingRelease ? 'Creating...' : 'Create Target'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE MILESTONE MODAL */}
      {showCreateMilestoneModal && (
        <div className="releases-modal-backdrop" onClick={() => setShowCreateMilestoneModal(false)}>
          <div className="releases-modal" onClick={(e) => e.stopPropagation()}>
            <div className="releases-modal-header">
              <h2 className="releases-modal-title">Create Milestone Checkpoint</h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowCreateMilestoneModal(false)}
                aria-label="Close modal"
              >
                <Icons.Close />
              </button>
            </div>

            {milestoneFormError && <div className="alert-box error">{milestoneFormError}</div>}

            <form onSubmit={handleCreateMilestone} className="releases-form">
              <div className="form-group">
                <label>Milestone Title *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. M1: Storage Layer & Redis Sentinel"
                  value={milestoneForm.title}
                  onChange={(e) => setMilestoneForm({ ...milestoneForm, title: e.target.value })}
                  maxLength={100}
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Project *</label>
                  <select
                    className="form-select"
                    value={milestoneForm.project}
                    onChange={(e) =>
                      setMilestoneForm({ ...milestoneForm, project: e.target.value, release: '' })
                    }
                    required
                  >
                    <option value="">Select Project</option>
                    {projects.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Linked Release (Optional)</label>
                  <select
                    className="form-select"
                    value={milestoneForm.release}
                    onChange={(e) => setMilestoneForm({ ...milestoneForm, release: e.target.value })}
                    disabled={!milestoneForm.project}
                  >
                    <option value="">None (Independent)</option>
                    {releases
                      .filter(
                        (r) =>
                          r.project &&
                          (r.project._id === milestoneForm.project || r.project === milestoneForm.project)
                      )
                      .map((r) => (
                        <option key={r._id} value={r._id}>
                          {r.version} - {r.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Due Date *</label>
                  <input
                    type="date"
                    className="form-input"
                    value={milestoneForm.dueDate}
                    onChange={(e) => setMilestoneForm({ ...milestoneForm, dueDate: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Sequence Order (1-based)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="form-input"
                    value={milestoneForm.sequence}
                    onChange={(e) =>
                      setMilestoneForm({ ...milestoneForm, sequence: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Status</label>
                <select
                  className="form-select"
                  value={milestoneForm.status}
                  onChange={(e) => setMilestoneForm({ ...milestoneForm, status: e.target.value })}
                >
                  <option value="open">Open</option>
                  <option value="at-risk">At Risk</option>
                  <option value="completed">Completed</option>
                </select>
              </div>

              <div className="form-group">
                <label>Description (Optional)</label>
                <textarea
                  className="form-textarea"
                  placeholder="Checkpoint requirements, deliverables..."
                  value={milestoneForm.description}
                  onChange={(e) => setMilestoneForm({ ...milestoneForm, description: e.target.value })}
                  maxLength={500}
                />
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn-secondary-release"
                  onClick={() => setShowCreateMilestoneModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary-release"
                  disabled={submittingMilestone}
                >
                  {submittingMilestone ? 'Creating...' : 'Create Milestone'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INSPECT RELEASE MODAL */}
      {inspectingRelease && (
        <div className="releases-modal-backdrop" onClick={() => setInspectingRelease(null)}>
          <div className="releases-modal" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
            <div className="releases-modal-header">
              <div>
                <span className="release-version-pill">{inspectingRelease.version}</span>
                <h2 className="releases-modal-title" style={{ marginTop: '4px' }}>
                  {inspectingRelease.name}
                </h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setInspectingRelease(null)}
                aria-label="Close modal"
              >
                <Icons.Close />
              </button>
            </div>

            {inspectingRelease.description && (
              <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
                {inspectingRelease.description}
              </p>
            )}

            {/* READINESS AUDIT */}
            {inspectingRelease.readiness && (
              <div className="release-readiness-box">
                <div className="release-readiness-header">
                  <div className="readiness-score-group">
                    {inspectingRelease.readiness.score !== null ? (
                      <>
                        <span className="readiness-score-number">
                          {inspectingRelease.readiness.score}
                        </span>
                        <span className="readiness-score-total">/100 Readiness Score</span>
                      </>
                    ) : (
                      <span className="readiness-score-number" style={{ fontSize: '18px' }}>
                        {inspectingRelease.readiness.label === 'SHIPPED'
                          ? 'Shipped (Scoring Closed)'
                          : inspectingRelease.readiness.label === 'CANCELLED'
                          ? 'Cancelled'
                          : 'Insufficient Data'}
                      </span>
                    )}
                  </div>
                  <span
                    className={`readiness-label-badge ${
                      inspectingRelease.readiness.label
                        ? inspectingRelease.readiness.label.toLowerCase().replace(/\s+/g, '-')
                        : 'insufficient-data'
                    }`}
                  >
                    {inspectingRelease.readiness.label}
                  </span>
                </div>

                {inspectingRelease.readiness.message && (
                  <p style={{ fontSize: '12px', color: '#94a3b8', margin: '6px 0 0 0' }}>
                    {inspectingRelease.readiness.message}
                  </p>
                )}

                {inspectingRelease.readiness.metrics?.staleTasks > 0 && (
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '6px', fontStyle: 'italic' }}>
                    ℹ️ {inspectingRelease.readiness.metrics.staleTasks} stale in-progress task{inspectingRelease.readiness.metrics.staleTasks > 1 ? 's' : ''} detected (Context only — 0 pts deduction)
                  </div>
                )}

                {inspectingRelease.readiness.drivers && inspectingRelease.readiness.drivers.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#f87171', marginBottom: '6px' }}>
                      Active Friction Drivers:
                    </div>
                    {inspectingRelease.readiness.drivers.map((d, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '12px',
                          padding: '4px 8px',
                          background: 'rgba(239, 68, 68, 0.1)',
                          borderRadius: '4px',
                          marginBottom: '4px',
                        }}
                      >
                        <span>
                          {d.label} ({d.count})
                        </span>
                        <span style={{ fontWeight: 700, color: '#ef4444' }}>
                          -{d.deduction} pts
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* DELIVERY FORECAST & CRITICAL PATH AUDIT (PHASE 4) */}
            {inspectingRelease.forecast && (
              <div
                className="release-readiness-box"
                style={{
                  marginTop: '12px',
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid #334155',
                }}
              >
                <div className="release-readiness-header">
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Icons.CriticalPath /> Delivery Slip & Critical Path Forecasting
                    </div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                      Deterministic delivery prediction based on task estimates & blocker chains
                    </div>
                  </div>
                  <span
                    className="forecast-status-badge"
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: '4px',
                      background:
                        inspectingRelease.forecast.status === 'on_track'
                          ? 'rgba(16, 185, 129, 0.2)'
                          : inspectingRelease.forecast.status === 'slipping'
                          ? 'rgba(239, 68, 68, 0.2)'
                          : inspectingRelease.forecast.status === 'at_risk'
                          ? 'rgba(245, 158, 11, 0.2)'
                          : 'rgba(99, 102, 241, 0.2)',
                      color:
                        inspectingRelease.forecast.status === 'on_track'
                          ? '#34d399'
                          : inspectingRelease.forecast.status === 'slipping'
                          ? '#f87171'
                          : inspectingRelease.forecast.status === 'at_risk'
                          ? '#fbbf24'
                          : '#818cf8',
                      border: '1px solid currentColor',
                    }}
                  >
                    {inspectingRelease.forecast.status === 'indeterminate'
                      ? (inspectingRelease.forecast.drivers?.some((d) => d.type === 'critical_blocker') || inspectingRelease.forecast.criticalBlockerCount > 0
                          ? 'Blocked · ETA Required'
                          : 'INDETERMINATE')
                      : inspectingRelease.forecast.status?.replace('_', ' ').toUpperCase()}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '10px', fontSize: '12px' }}>
                  <div style={{ background: '#090d16', padding: '8px 10px', borderRadius: '6px', border: '1px solid #1e293b' }}>
                    <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>Predicted Date</span>
                    <strong style={{ color: '#38bdf8' }}>
                      {inspectingRelease.forecast.forecastDate ? new Date(inspectingRelease.forecast.forecastDate).toLocaleDateString() : 'Indeterminate'}
                    </strong>
                  </div>
                  <div style={{ background: '#090d16', padding: '8px 10px', borderRadius: '6px', border: '1px solid #1e293b' }}>
                    <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>Slip Days</span>
                    <strong style={{ color: inspectingRelease.forecast.slipDays > 0 ? '#f87171' : '#34d399' }}>
                      {inspectingRelease.forecast.slipDays > 0 ? `+${inspectingRelease.forecast.slipDays} days` : '0 days (On Track)'}
                    </strong>
                  </div>
                  <div style={{ background: '#090d16', padding: '8px 10px', borderRadius: '6px', border: '1px solid #1e293b' }}>
                    <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>Critical Path</span>
                    <strong style={{ color: '#fbbf24' }}>
                      {inspectingRelease.forecast.criticalPath?.length || 0} tasks ({inspectingRelease.forecast.totalRemainingDays || 0}d)
                    </strong>
                  </div>
                </div>

                {inspectingRelease.forecast.drivers?.length > 0 && (
                  <div style={{ marginTop: '10px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b', marginBottom: '4px' }}>
                      Delivery Slip Drivers:
                    </div>
                    {inspectingRelease.forecast.drivers.map((drv, i) => (
                      <div
                        key={i}
                        style={{
                          fontSize: '11px',
                          padding: '4px 8px',
                          background: 'rgba(245, 158, 11, 0.1)',
                          borderRadius: '4px',
                          marginBottom: '4px',
                          color: '#fbbf24',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span>•</span>
                        <span>{drv.message || drv.type}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* CAPACITY & OWNERSHIP COVERAGE (PHASE 6) */}
            <div
              className="release-readiness-box"
              style={{
                marginTop: '12px',
                background: 'rgba(99, 102, 241, 0.05)',
                border: '1px solid rgba(99, 102, 241, 0.2)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#e0e7ff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    👥 Forecast-Path Ownership & Capacity
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                    Connects active release commitments with configured team availability and WIP limits
                  </div>
                </div>
                <Link
                  to={`/team-capacity?project=${inspectingRelease.project?._id || inspectingRelease.project}`}
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '11px', padding: '4px 10px', textDecoration: 'none', color: '#a5b4fc', borderColor: 'rgba(99, 102, 241, 0.3)' }}
                >
                  View Capacity →
                </Link>
              </div>
            </div>

            {/* MILESTONES CHECKLIST */}
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: 700, margin: '14px 0 8px 0', color: '#cbd5e1' }}>
                Checkpoints & Milestones ({inspectingMilestones.length})
              </h3>
              {inspectingMilestones.length === 0 ? (
                <p style={{ fontSize: '12.5px', color: '#64748b' }}>
                  No milestones linked to this release target yet.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {inspectingMilestones.map((m) => (
                    <div
                      key={m._id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: '#0d111a',
                        border: '1px solid #262d40',
                        padding: '10px 14px',
                        borderRadius: '6px',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                          {m.title}
                        </div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                          Due: {new Date(m.dueDate).toLocaleDateString()}
                        </div>
                      </div>
                      <span className={`release-status-badge ${m.status}`}>
                        {m.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* LINKED ARCHITECTURAL DECISIONS (PHASE 5) */}
            <div style={{ marginTop: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: '#cbd5e1' }}>
                  Linked Engineering Decisions ({releaseDecisions.length})
                </h3>
                <Link to="/decisions" style={{ fontSize: '12px', color: '#818cf8', textDecoration: 'none' }}>
                  Open Decisions Hub &rarr;
                </Link>
              </div>

              {releaseDecisions.length === 0 ? (
                <p style={{ fontSize: '12.5px', color: '#64748b' }}>
                  No architectural decisions directly linked to this release target.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {releaseDecisions.map((dec) => (
                    <div
                      key={dec._id}
                      onClick={() => setInspectingDecisionId(dec._id)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        background: '#090d16',
                        borderRadius: '6px',
                        border: '1px solid #1e293b',
                        cursor: 'pointer',
                      }}
                    >
                      <div>
                        <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#818cf8', marginRight: '8px' }}>
                          ADR-{dec._id.slice(-4).toUpperCase()}
                        </span>
                        <strong style={{ fontSize: '12.5px', color: '#f1f5f9' }}>{dec.title}</strong>
                      </div>
                      <span className={`status-pill status-${dec.status}`} style={{ fontSize: '10px' }}>
                        {dec.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* DECISION DRAWER INTEGRATION */}
      {inspectingDecisionId && (
        <DecisionDrawer
          decisionId={inspectingDecisionId}
          onClose={() => setInspectingDecisionId(null)}
        />
      )}
    </div>
  );
}
