import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import CapacityConfigModal from '../components/capacity/CapacityConfigModal';
import toast from 'react-hot-toast';
import './TeamCapacityPage.css';

export default function TeamCapacityPage() {
  const { user, isAdmin, isManager } = useAuth();
  const isMember = !isAdmin && !isManager;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('project') || '');
  const [horizonDays, setHorizonDays] = useState(14);
  const [intelligence, setIntelligence] = useState(null);
  const [capacities, setCapacities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modal state
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [editingAllocation, setEditingAllocation] = useState(null);

  // Fetch accessible projects
  const fetchProjects = useCallback(async () => {
    try {
      const res = await api.get('/projects');
      if (res.data?.success && Array.isArray(res.data.projects)) {
        setProjects(res.data.projects);
        if (!selectedProjectId && res.data.projects.length > 0) {
          const defaultProj = res.data.projects.find((p) => p.status === 'active') || res.data.projects[0];
          setSelectedProjectId(defaultProj._id);
        }
      }
    } catch (err) {
      console.error('Failed to load projects', err);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Sync selected project with URL query
  useEffect(() => {
    const projQuery = searchParams.get('project');
    if (projQuery && projQuery !== selectedProjectId) {
      setSelectedProjectId(projQuery);
    }
  }, [searchParams, selectedProjectId]);

  const handleProjectChange = (projId) => {
    setSelectedProjectId(projId);
    setSearchParams(projId ? { project: projId } : {});
  };

  // Fetch capacity intelligence & project capacities
  const fetchCapacityData = useCallback(async () => {
    if (!selectedProjectId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const [intelRes, capRes] = await Promise.all([
        api.get(`/projects/${selectedProjectId}/capacity-intelligence`, {
          params: { horizonDays },
        }),
        api.get(`/projects/${selectedProjectId}/capacity`),
      ]);

      if (intelRes.data?.success) {
        setIntelligence(intelRes.data.data);
      }
      if (capRes.data?.success) {
        setCapacities(capRes.data.data || []);
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to load capacity intelligence';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId, horizonDays]);

  useEffect(() => {
    fetchCapacityData();
  }, [fetchCapacityData]);

  const selectedProject = useMemo(() => {
    return projects.find((p) => (p._id || p.id) === selectedProjectId) || null;
  }, [projects, selectedProjectId]);

  const canManageCapacity = Boolean(isAdmin || (isManager && selectedProject?.owner && (selectedProject.owner._id || selectedProject.owner) === (user?._id || user?.id)));

  const handleOpenConfig = (targetUser = null, allocation = null) => {
    setEditingUser(targetUser);
    setEditingAllocation(allocation);
    setConfigModalOpen(true);
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'balanced':
        return 'badge-balanced';
      case 'approaching_limit':
        return 'badge-approaching';
      case 'overloaded':
        return 'badge-overloaded';
      case 'insufficient_data':
        return 'badge-insufficient';
      default:
        return 'badge-unconfigured';
    }
  };

  const getWipBadgeClass = (wipState) => {
    switch (wipState) {
      case 'within_limit':
        return 'badge-wip-within';
      case 'at_limit':
        return 'badge-wip-at';
      case 'over_limit':
        return 'badge-wip-over';
      default:
        return 'badge-wip-unconfigured';
    }
  };

  const formatLoadStatus = (status) => {
    switch (status) {
      case 'balanced':
        return 'Balanced';
      case 'approaching_limit':
        return 'Approaching Limit';
      case 'overloaded':
        return 'Overloaded';
      case 'insufficient_data':
        return 'Insufficient Data';
      case 'on_hold':
        return 'Project On Hold';
      case 'completed':
        return 'Project Completed';
      case 'archived':
        return 'Project Archived';
      default:
        return 'Unconfigured';
    }
  };

  const isPersonalScope = intelligence?.scope === 'personal' || isMember;

  return (
    <div className="team-capacity-page">
      {/* PAGE HEADER */}
      <header className="team-capacity-header">
        <div className="header-left">
          <div className="title-row">
            <h1>Team Capacity & Ownership</h1>
            <span className="phase-pill">Phase 6</span>
          </div>
          <p className="page-subtitle">
            Deterministic workload pressure, delivery risk drivers, and allocation management across team members.
          </p>
        </div>

        <div className="header-controls">
          {/* PROJECT SELECTOR */}
          <div className="control-group">
            <label htmlFor="capacity-proj-select" className="control-label">Project</label>
            <select
              id="capacity-proj-select"
              className="control-select"
              value={selectedProjectId}
              onChange={(e) => handleProjectChange(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} {p.status !== 'active' ? `(${p.status})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* HORIZON SELECTOR */}
          <div className="control-group">
            <span className="control-label">Planning Horizon</span>
            <div className="horizon-btn-group" role="radiogroup" aria-label="Planning horizon">
              {[7, 14, 30].map((days) => (
                <button
                  key={days}
                  type="button"
                  className={`horizon-btn ${horizonDays === days ? 'active' : ''}`}
                  onClick={() => setHorizonDays(days)}
                  role="radio"
                  aria-checked={horizonDays === days}
                >
                  {days}d
                </button>
              ))}
            </div>
          </div>

          {/* CONFIGURE CAPACITY ACTION BUTTON */}
          {canManageCapacity && selectedProject?.status === 'active' && (
            <button
              type="button"
              className="btn btn-primary btn-config-cap"
              onClick={() => handleOpenConfig()}
            >
              + Configure Capacity
            </button>
          )}

          {selectedProjectId && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate(`/activity?project=${selectedProjectId}&category=capacity`)}
              title="View capacity configuration activity"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#cbd5e1',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              <span>◷ Capacity Ledger</span>
            </button>
          )}
        </div>
      </header>

      {/* METRIC EXPLANATION DISCLAIMER BANNER */}
      <div className="metric-disclaimer-banner" role="note">
        <div className="disclaimer-icon">ℹ️</div>
        <div className="disclaimer-content">
          <strong>{intelligence?.metricName || 'Commitment Pressure'}:</strong>{' '}
          {intelligence?.explanation ||
            'Commitment Pressure compares known remaining task estimates against configured project capacity for the selected horizon. It is not a measurement of time worked or individual performance.'}
        </div>
      </div>

      {/* PROJECT LIFECYCLE ALERT */}
      {selectedProject && selectedProject.status !== 'active' && (
        <div className="project-lifecycle-banner">
          ⚠️ <strong>Project is {selectedProject.status}:</strong> Capacity configurations are read-only and active overload conclusions are suppressed.
        </div>
      )}

      {loading ? (
        <div className="loading-state">
          <div className="spinner" />
          <p>Analyzing team capacity and commitment pressure...</p>
        </div>
      ) : error ? (
        <div className="error-card">
          <h3>Unable to load capacity intelligence</h3>
          <p>{error}</p>
        </div>
      ) : isPersonalScope ? (
        /* ================= MEMBER PERSONAL PRIVACY VIEW ================= */
        <div className="personal-capacity-view">
          {intelligence?.restrictedSignals?.map((sig, idx) => (
            <div key={idx} className="restricted-signal-banner">
              🔒 <strong>Privacy Guard:</strong> {sig.message}
            </div>
          ))}

          <div className="personal-card card">
            <div className="personal-card-header">
              <div className="user-profile-badge">
                <div className="member-avatar">
                  {intelligence?.personal?.user?.name?.charAt(0).toUpperCase() || 'M'}
                </div>
                <div>
                  <h2>{intelligence?.personal?.user?.name || user?.name}</h2>
                  <span className="user-role-label">Your Allocated Project Capacity</span>
                </div>
              </div>

              <div className="personal-status-pill">
                <span className={`status-badge ${getStatusBadgeClass(intelligence?.personal?.loadStatus)}`}>
                  {formatLoadStatus(intelligence?.personal?.loadStatus)}
                </span>
              </div>
            </div>

            <div className="personal-metrics-grid">
              <div className="kpi-metric">
                <span className="kpi-label">Weekly Allocation</span>
                <span className="kpi-value">
                  {intelligence?.personal?.isConfigured
                    ? `${intelligence.personal.allocation.availableDaysPerWeek} d/wk`
                    : 'Unconfigured'}
                </span>
                <span className="kpi-sub">Available working days</span>
              </div>

              <div className="kpi-metric">
                <span className="kpi-label">{horizonDays}-Day Available Capacity</span>
                <span className="kpi-value">
                  {intelligence?.personal?.availableCapacityDays != null
                    ? `${intelligence.personal.availableCapacityDays} d`
                    : '—'}
                </span>
                <span className="kpi-sub">Within horizon</span>
              </div>

              <div className="kpi-metric">
                <span className="kpi-label">Committed Estimates</span>
                <span className="kpi-value">
                  {intelligence?.personal?.committedEstimateDays != null
                    ? `${intelligence.personal.committedEstimateDays} d`
                    : 'Insufficient Data'}
                </span>
                <span className="kpi-sub">
                  {intelligence?.personal?.committedTasksCount || 0} active task(s)
                </span>
              </div>

              <div className="kpi-metric">
                <span className="kpi-label">WIP Limit & Concurrency</span>
                <span className="kpi-value">
                  {intelligence?.personal?.wip?.count || 0} /{' '}
                  {intelligence?.personal?.wip?.limit != null ? intelligence.personal.wip.limit : '—'}
                </span>
                <span className={`wip-tag ${getWipBadgeClass(intelligence?.personal?.wip?.state)}`}>
                  {intelligence?.personal?.wip?.state?.replace('_', ' ') || 'unconfigured'}
                </span>
              </div>
            </div>

            {/* COMMITMENT PRESSURE PROGRESS BAR */}
            <div className="pressure-bar-section">
              <div className="pressure-bar-header">
                <span>Commitment Pressure Ratio</span>
                <span className="pressure-ratio-text">
                  {intelligence?.personal?.loadRatio != null
                    ? `${Math.round(intelligence.personal.loadRatio * 100)}%`
                    : 'N/A'}
                </span>
              </div>
              <div className="pressure-bar-track">
                <div
                  className={`pressure-bar-fill fill-${intelligence?.personal?.loadStatus}`}
                  style={{
                    width: `${Math.min(
                      intelligence?.personal?.loadRatio != null
                        ? Math.round(intelligence.personal.loadRatio * 100)
                        : 0,
                      100
                    )}%`,
                  }}
                />
              </div>
            </div>

            {/* COMMITTED TASKS LIST */}
            <div className="personal-tasks-section">
              <h3>Committed Tasks in Scope ({intelligence?.personal?.tasks?.length || 0})</h3>
              {intelligence?.personal?.tasks?.length === 0 ? (
                <p className="empty-tasks-text">No active tasks assigned to you in this horizon.</p>
              ) : (
                <div className="personal-tasks-list">
                  {intelligence?.personal?.tasks?.map((t) => (
                    <div key={t.id} className="personal-task-item">
                      <div className="pti-left">
                        <span className={`badge badge-${t.priority}`}>{t.priority}</span>
                        <span className={`badge badge-${t.status}`}>{t.status}</span>
                        <span className="pti-title">{t.title}</span>
                        {t.isBlocked && <span className="tag-blocked">🚫 Blocked</span>}
                      </div>
                      <div className="pti-right">
                        <span className="pti-estimate">
                          {t.estimateDays != null ? `${t.estimateDays} d` : '⚠️ No estimate'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ================= MANAGER / ADMIN FULL TEAM VIEW ================= */
        <div className="team-capacity-view">
          {/* TEAM OVERVIEW KPIS */}
          <div className="team-kpis-row">
            <div className="team-kpi-card card">
              <span className="kpi-label">Active Team Members</span>
              <div className="kpi-main">
                <span className="kpi-big">{intelligence?.summary?.totalActiveMembers || 0}</span>
                <span className="kpi-hint">
                  {intelligence?.summary?.configuredActiveMembers || 0} configured
                </span>
              </div>
            </div>

            <div className="team-kpi-card card">
              <span className="kpi-label">Total Available Capacity</span>
              <div className="kpi-main">
                <span className="kpi-big">
                  {intelligence?.summary?.displayTotalAvailableCapacityDays != null
                    ? `${intelligence.summary.displayTotalAvailableCapacityDays}d`
                    : (intelligence?.summary?.totalAvailableCapacityDays != null ? `${Math.round(intelligence.summary.totalAvailableCapacityDays * 10) / 10}d` : '—')}
                </span>
                <span className="kpi-hint">{horizonDays}-day horizon</span>
              </div>
            </div>

            <div className="team-kpi-card card">
              <span className="kpi-label">Committed Effort</span>
              <div className="kpi-main">
                <span className="kpi-big">
                  {intelligence?.summary?.totalCommittedEstimateDays != null
                    ? `${intelligence.summary.totalCommittedEstimateDays}d`
                    : 'Insufficient Data'}
                </span>
                <span className="kpi-hint">
                  {intelligence?.summary?.hasMissingEstimatesOverall ? 'Estimates missing' : 'All estimated'}
                </span>
              </div>
            </div>

            <div className="team-kpi-card card">
              <span className="kpi-label">Overloaded Members</span>
              <div className="kpi-main">
                <span
                  className={`kpi-big ${
                    (intelligence?.summary?.overloadedMembers || 0) > 0 ? 'text-danger' : 'text-success'
                  }`}
                >
                  {intelligence?.summary?.overloadedMembers || 0}
                </span>
                <span className="kpi-hint">Load ratio &gt; 100%</span>
              </div>
            </div>

            <div className="team-kpi-card card">
              <span className="kpi-label">WIP Limit Congestion</span>
              <div className="kpi-main">
                <span
                  className={`kpi-big ${
                    (intelligence?.summary?.membersAtOrOverWipLimit || 0) > 0 ? 'text-warning' : ''
                  }`}
                >
                  {intelligence?.summary?.membersAtOrOverWipLimit || 0}
                </span>
                <span className="kpi-hint">Members at/over limit</span>
              </div>
            </div>

            <div className="team-kpi-card card">
              <span className="kpi-label">Unassigned Commitments</span>
              <div className="kpi-main">
                <span
                  className={`kpi-big ${
                    (intelligence?.summary?.unassignedCommittedTasks || 0) > 0 ? 'text-warning' : ''
                  }`}
                >
                  {intelligence?.summary?.unassignedCommittedTasks || 0}
                </span>
                <span className="kpi-hint">Need owner assignment</span>
              </div>
            </div>
          </div>

          {/* TWO-COLUMN INTELLIGENCE SECTION: RISK DRIVERS & ACTIONS */}
          <div className="capacity-intelligence-grid">
            {/* RISK DRIVERS PANEL */}
            <div className="card risk-drivers-panel">
              <div className="panel-header">
                <h3>Ownership Risk Drivers & Bottlenecks</h3>
                <span className="badge-counter">{intelligence?.riskDrivers?.length || 0}</span>
              </div>

              {intelligence?.riskDrivers?.length === 0 ? (
                <div className="empty-panel-notice">
                  ✓ No critical ownership risks, overload bottlenecks, or unassigned paths detected.
                </div>
              ) : (
                <div className="risk-drivers-list">
                  {intelligence?.riskDrivers?.map((driver, idx) => (
                    <div key={idx} className={`risk-driver-item severity-${driver.severity}`}>
                      <div className="rdi-header">
                        <span className={`severity-badge severity-${driver.severity}`}>
                          {driver.severity}
                        </span>
                        <span className="driver-type">{driver.type.replace(/_/g, ' ')}</span>
                      </div>
                      <p className="driver-message">{driver.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* SUGGESTED REBALANCING ACTIONS PANEL */}
            <div className="card suggested-actions-panel">
              <div className="panel-header">
                <h3>Suggested Rebalancing Actions</h3>
                <span className="badge-counter">{intelligence?.suggestedActions?.length || 0}</span>
              </div>

              {intelligence?.suggestedActions?.length === 0 ? (
                <div className="empty-panel-notice">
                  ✓ Team capacity is balanced; no immediate rebalancing actions required.
                </div>
              ) : (
                <div className="suggested-actions-list">
                  {intelligence?.suggestedActions?.map((act, idx) => (
                    <div key={idx} className="suggested-action-item">
                      <div className="action-left">
                        <span className="action-icon">⚡</span>
                        <span className="action-text">{act.message}</span>
                      </div>
                      {canManageCapacity && act.type === 'configure_capacity' && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            const targetMem = intelligence.members.find((m) => m.user.id === act.userId);
                            handleOpenConfig(targetMem?.user, targetMem?.allocation);
                          }}
                        >
                          Configure
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* MEMBER CAPACITY WORKBENCH */}
          <div className="card member-workbench-card">
            <div className="workbench-header">
              <div>
                <h3>Member Capacity & Workload Workbench</h3>
                <p className="workbench-subtitle">
                  Weekly availability, committed effort, Commitment Pressure, and WIP limit concurrency.
                </p>
              </div>
            </div>

            {/* DESKTOP TABLE VIEW */}
            <div className="capacity-table-wrapper">
              <table className="capacity-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Weekly Availability</th>
                    <th>Horizon Capacity ({horizonDays}d)</th>
                    <th>Committed Effort</th>
                    <th>Commitment Pressure</th>
                    <th>WIP Concurrency</th>
                    <th>Critical Tasks</th>
                    {canManageCapacity && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {intelligence?.members?.map((mem) => (
                    <tr key={mem.user.id}>
                      <td>
                        <div className="table-member-cell">
                          <div className="member-avatar">
                            {mem.user.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <span className="member-name">{mem.user.name}</span>
                            <span className="member-role">{mem.user.role}</span>
                          </div>
                        </div>
                      </td>

                      <td>
                        {mem.isConfigured ? (
                          <span className="table-val-bold">
                            {mem.allocation.availableDaysPerWeek} d/wk
                          </span>
                        ) : (
                          <span className="table-val-muted">Unconfigured</span>
                        )}
                      </td>

                      <td>
                        {mem.displayAvailableCapacityDays != null ? (
                          <span className="table-val-bold">{mem.displayAvailableCapacityDays} d</span>
                        ) : mem.availableCapacityDays != null ? (
                          <span className="table-val-bold">{Math.round(mem.availableCapacityDays * 10) / 10} d</span>
                        ) : (
                          <span className="table-val-muted">—</span>
                        )}
                      </td>

                      <td>
                        {mem.committedEstimateDays != null ? (
                          <span className="table-val-bold">{mem.committedEstimateDays} d</span>
                        ) : (
                          <span className="badge badge-insufficient">No Estimates</span>
                        )}
                      </td>

                      <td>
                        <div className="table-pressure-cell">
                          <div className="pressure-info">
                            <span className={`status-badge ${getStatusBadgeClass(mem.loadStatus)}`}>
                              {formatLoadStatus(mem.loadStatus)}
                            </span>
                            <span className="pressure-pct">
                              {mem.loadRatio != null ? `${Math.round(mem.loadRatio * 100)}%` : '—'}
                            </span>
                          </div>
                          <div className="pressure-bar-mini">
                            <div
                              className={`mini-fill fill-${mem.loadStatus}`}
                              style={{
                                width: `${Math.min(
                                  mem.loadRatio != null ? Math.round(mem.loadRatio * 100) : 0,
                                  100
                                )}%`,
                              }}
                            />
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="table-wip-cell">
                          <span className="wip-ratio">
                            {mem.wip.count} / {mem.wip.limit != null ? mem.wip.limit : '—'}
                          </span>
                          <span className={`wip-tag ${getWipBadgeClass(mem.wip.state)}`}>
                            {mem.wip.state.replace('_', ' ')}
                          </span>
                        </div>
                      </td>

                      <td>
                        <div className="table-critical-cell">
                          {mem.forecastDrivingTasksCount > 0 && (
                            <span className="tag-forecast" title="Tasks on active release forecast driving path">
                              🚀 {mem.forecastDrivingTasksCount} path
                            </span>
                          )}
                          {mem.blockedTasksCount > 0 && (
                            <span className="tag-blocked" title="Blocked tasks">
                              🚫 {mem.blockedTasksCount} blocked
                            </span>
                          )}
                          {mem.forecastDrivingTasksCount === 0 && mem.blockedTasksCount === 0 && (
                            <span className="table-val-muted">None</span>
                          )}
                        </div>
                      </td>

                      {canManageCapacity && (
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleOpenConfig(mem.user, mem.allocation)}
                          >
                            Configure
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* MOBILE CARDS VIEW (<= 768px) */}
            <div className="capacity-mobile-cards-view">
              {intelligence?.members?.map((mem) => (
                <div key={mem.user.id} className="member-mobile-card">
                  <div className="mmc-header">
                    <div className="mmc-user">
                      <div className="member-avatar">
                        {mem.user.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h4>{mem.user.name}</h4>
                        <span className="member-role">{mem.user.role}</span>
                      </div>
                    </div>
                    <span className={`status-badge ${getStatusBadgeClass(mem.loadStatus)}`}>
                      {formatLoadStatus(mem.loadStatus)}
                    </span>
                  </div>

                  <div className="mmc-stats-grid">
                    <div className="mmc-stat">
                      <span className="stat-label">Availability</span>
                      <span className="stat-val">
                        {mem.isConfigured ? `${mem.allocation.availableDaysPerWeek} d/wk` : 'Unconfigured'}
                      </span>
                    </div>
                    <div className="mmc-stat">
                      <span className="stat-label">Committed</span>
                      <span className="stat-val">
                        {mem.committedEstimateDays != null ? `${mem.committedEstimateDays} d` : '—'}
                      </span>
                    </div>
                    <div className="mmc-stat">
                      <span className="stat-label">WIP Count</span>
                      <span className="stat-val">
                        {mem.wip.count} / {mem.wip.limit != null ? mem.wip.limit : '—'}
                      </span>
                    </div>
                    <div className="mmc-stat">
                      <span className="stat-label">Critical Work</span>
                      <span className="stat-val">
                        {mem.forecastDrivingTasksCount} path • {mem.blockedTasksCount} blocked
                      </span>
                    </div>
                  </div>

                  {canManageCapacity && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm mmc-action-btn"
                      onClick={() => handleOpenConfig(mem.user, mem.allocation)}
                    >
                      Configure Capacity
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* CAPACITY CONFIGURATION MODAL */}
      {configModalOpen && (
        <CapacityConfigModal
          isOpen={configModalOpen}
          onClose={() => setConfigModalOpen(false)}
          project={selectedProject}
          userToEdit={editingUser}
          existingAllocation={editingAllocation}
          onSuccess={fetchCapacityData}
        />
      )}
    </div>
  );
}
