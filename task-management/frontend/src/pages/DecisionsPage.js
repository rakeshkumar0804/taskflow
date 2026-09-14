import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import DecisionModal from '../components/decisions/DecisionModal';
import DecisionDrawer from '../components/decisions/DecisionDrawer';
import toast from 'react-hot-toast';
import './DecisionsPage.css';

function formatDecisionDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString();
}

export default function DecisionsPage() {
  const { user, isAdmin, isManager } = useAuth();
  const isMember = !isAdmin && !isManager;

  const [decisions, setDecisions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [impactFilter, setImpactFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 20;

  // Modals & Drawer state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingDecision, setEditingDecision] = useState(null);
  const [inspectingDecisionId, setInspectingDecisionId] = useState(null);

  // Cached impact data map: decisionId -> impact
  const [impactMap, setImpactMap] = useState({});

  // Fetch Projects for filter and creation
  const fetchProjects = useCallback(async () => {
    try {
      const res = await api.get('/projects');
      if (res.data?.success && Array.isArray(res.data.projects)) {
        setProjects(res.data.projects.filter((p) => p.status !== 'archived'));
      }
    } catch (err) {
      console.error('Failed to load projects', err);
    }
  }, []);

  // Fetch Decisions list
  const fetchDecisions = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const params = {
        page: currentPage,
        limit,
      };

      if (selectedProjectId && selectedProjectId !== 'all') {
        params.project = selectedProjectId;
      }
      if (statusFilter && statusFilter !== 'all') {
        params.status = statusFilter;
      }
      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }

      const res = await api.get('/decisions', { params });
      if (res.data?.success) {
        setDecisions(res.data.decisions || []);
        setTotalPages(res.data.totalPages || 1);
        setTotalCount(res.data.totalCount || 0);

        // Fetch impacts for the loaded decisions in background
        const decIds = (res.data.decisions || []).map((d) => d._id);
        decIds.forEach((id) => {
          api.get(`/decisions/${id}/impact`)
            .then((impRes) => {
              if (impRes.data?.success) {
                setImpactMap((prev) => ({ ...prev, [id]: impRes.data.impact }));
              }
            })
            .catch(() => {});
        });
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to load decisions';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [currentPage, selectedProjectId, statusFilter, searchQuery]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    fetchDecisions();
  }, [fetchDecisions]);

  // Client-side filtering for impact classification if set
  const filteredDecisions = useMemo(() => {
    if (impactFilter === 'all') return decisions;
    return decisions.filter((d) => {
      const imp = impactMap[d._id];
      if (!imp) return true; // keep while loading
      const classification = imp.impactClassification || imp.classification;
      return classification === impactFilter;
    });
  }, [decisions, impactFilter, impactMap]);

  // Derive KPI Metrics
  const kpiMetrics = useMemo(() => {
    const total = decisions.length;
    let accepted = 0;
    let proposed = 0;
    let criticalOrRelevant = 0;
    let historical = 0;

    decisions.forEach((d) => {
      if (d.status === 'accepted') accepted++;
      if (d.status === 'proposed') proposed++;
      if (['rejected', 'withdrawn', 'superseded'].includes(d.status)) historical++;

      const imp = impactMap[d._id];
      if (imp) {
        const cls = imp.impactClassification || imp.classification;
        if (cls === 'critical_path' || cls === 'delivery_relevant') {
          criticalOrRelevant++;
        }
      }
    });

    return { total: totalCount || total, accepted, proposed, criticalOrRelevant, historical };
  }, [decisions, impactMap, totalCount]);

  const handleDecisionSaved = (saved) => {
    fetchDecisions();
    if (saved?._id) {
      setInspectingDecisionId(saved._id);
    }
  };

  const statusPills = [
    { id: 'all', label: 'All States' },
    { id: 'proposed', label: 'Proposed' },
    { id: 'accepted', label: 'Accepted' },
    { id: 'superseded', label: 'Superseded' },
    { id: 'rejected', label: 'Rejected' },
    { id: 'withdrawn', label: 'Withdrawn' },
  ];

  const isVisualQaMode = process.env.REACT_APP_VISUAL_QA_MODE === 'true' || (typeof window !== 'undefined' && window.__VISUAL_QA_MODE__ === true);

  return (
    <div className="decisions-page-container">
      {/* Top Header */}
      <div className="decisions-header">
        <div className="decisions-header-left">
          <div className="decisions-title-row">
            <span className="decisions-icon">⚖</span>
            <h1 className="decisions-title">Engineering Decisions</h1>
            <span className="decisions-badge">ADR Intelligence</span>
            {isVisualQaMode && (
              <span className="decisions-demo-badge">Demo Workspace · Sample Data</span>
            )}
          </div>
          <p className="decisions-subtitle">
            Decision Lifecycle Records with deterministic delivery-impact analysis.
          </p>
        </div>

        <button
          type="button"
          className="btn-propose-decision"
          onClick={() => {
            setEditingDecision(null);
            setShowCreateModal(true);
          }}
        >
          <span className="plus-icon">+</span> Propose Decision
        </button>
      </div>

      {/* Member Scope Banner (Amendment 4) */}
      {isMember && (
        <div className="member-scope-notice">
          <span className="notice-icon">🔒</span>
          <div className="notice-content">
            <strong>Personal Scope Active</strong>
            <p>
              You are viewing decisions and linked delivery impact scoped to your authorized work.
              Authoritative project-wide critical path and forecast drivers are restricted.
            </p>
          </div>
        </div>
      )}

      {/* KPI Cards Row */}
      <div className="decisions-kpis-row">
        <div className="decisions-kpi-card">
          <span className="kpi-num">{kpiMetrics.total}</span>
          <span className="kpi-desc">Total Decisions</span>
        </div>
        <div className="decisions-kpi-card highlight-accepted">
          <span className="kpi-num text-emerald">{kpiMetrics.accepted}</span>
          <span className="kpi-desc">Accepted Active</span>
        </div>
        <div className="decisions-kpi-card highlight-proposed">
          <span className="kpi-num text-amber">{kpiMetrics.proposed}</span>
          <span className="kpi-desc">Under Review</span>
        </div>
        <div className="decisions-kpi-card highlight-relevant">
          <span className="kpi-num text-blue">{kpiMetrics.criticalOrRelevant}</span>
          <span className="kpi-desc">Delivery Relevant</span>
        </div>
        <div className="decisions-kpi-card">
          <span className="kpi-num text-purple">{kpiMetrics.historical}</span>
          <span className="kpi-desc">Historical / Superseded</span>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="decisions-filter-bar">
        {/* Search */}
        <div className="filter-search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search decisions by title, context, decision, rationale..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
          />
          {searchQuery && (
            <button className="clear-search-btn" onClick={() => setSearchQuery('')}>
              &times;
            </button>
          )}
        </div>

        {/* Project Selector */}
        <div className="filter-select-group">
          <label htmlFor="filter-project">Project:</label>
          <select
            id="filter-project"
            value={selectedProjectId}
            onChange={(e) => {
              setSelectedProjectId(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="all">All Accessible Projects</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Impact Selector */}
        <div className="filter-select-group">
          <label htmlFor="filter-impact">Impact:</label>
          <select
            id="filter-impact"
            value={impactFilter}
            onChange={(e) => setImpactFilter(e.target.value)}
          >
            <option value="all">All Impact Types</option>
            <option value="critical_path">Critical Path</option>
            <option value="delivery_relevant">Delivery Relevant</option>
            <option value="contained">Contained</option>
            <option value="historical">Historical</option>
            <option value="insufficient_data">Insufficient Data</option>
          </select>
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="status-tabs-row">
        {statusPills.map((pill) => (
          <button
            key={pill.id}
            type="button"
            className={`status-tab-btn ${statusFilter === pill.id ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter(pill.id);
              setCurrentPage(1);
            }}
          >
            {pill.label}
          </button>
        ))}
      </div>

      {/* ADR Table / Card List */}
      <div className="decisions-table-wrapper">
        {loading ? (
          <div className="table-loading-skeleton">
            <div className="skeleton-row" />
            <div className="skeleton-row" />
            <div className="skeleton-row" />
            <div className="skeleton-row" />
          </div>
        ) : filteredDecisions.length === 0 ? (
          <div className="empty-decisions-state">
            <span className="empty-icon">📂</span>
            <h3>No engineering decisions found</h3>
            <p>No Architectural Decision Records match your current filters or search query.</p>
            <button
              type="button"
              className="btn-propose-first"
              onClick={() => {
                setEditingDecision(null);
                setShowCreateModal(true);
              }}
            >
              Propose First Decision
            </button>
          </div>
        ) : (
          <>
            <table className="decisions-table">
            <thead>
              <tr>
                <th style={{ width: '38%' }}>Decision & Title</th>
                <th style={{ width: '14%' }}>Project</th>
                <th style={{ width: '12%' }}>Lifecycle</th>
                <th style={{ width: '16%' }}>Delivery Impact</th>
                <th style={{ width: '12%' }}>Author / Decided</th>
                <th style={{ width: '8%', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredDecisions.map((dec) => {
                const imp = impactMap[dec._id];
                const classification = imp?.impactClassification || imp?.classification || 'evaluating';
                const totalAffected = imp?.summary?.totalAffectedTasks != null
                  ? imp.summary.totalAffectedTasks
                  : (dec.linkedTasks?.length || 0);

                return (
                  <tr
                    key={dec._id}
                    className="decision-row"
                    onClick={() => setInspectingDecisionId(dec._id)}
                  >
                    {/* Title & Preview */}
                    <td className="cell-title">
                      <div className="title-container">
                        <span className="adr-id-tag">ADR-{dec._id.slice(-4).toUpperCase()}</span>
                        <span className="decision-row-title">{dec.title}</span>
                      </div>
                      <div className="decision-row-snippet">
                        {dec.decision.slice(0, 110)}...
                      </div>
                    </td>

                    {/* Project */}
                    <td className="cell-project">
                      <span className="project-badge">
                        {dec.project?.name || 'Project'}
                      </span>
                    </td>

                    {/* Lifecycle Status */}
                    <td className="cell-status">
                      <span className={`status-pill status-${dec.status}`}>
                        {dec.status}
                      </span>
                    </td>

                    {/* Delivery Impact Classification */}
                    <td className="cell-impact">
                      <div className="impact-cell-content">
                        <span className={`impact-badge impact-${classification}`}>
                          {classification.replace('_', ' ')}
                        </span>
                        <span className="impact-subtext">
                          {totalAffected} task{totalAffected === 1 ? '' : 's'} affected
                        </span>
                      </div>
                    </td>

                    {/* Author & Date */}
                    <td className="cell-meta">
                      <div className="meta-author">
                        {dec.decidedBy ? dec.decidedBy.name : (dec.proposedBy?.name || 'Member')}
                      </div>
                      <div className="meta-date">
                        {formatDecisionDate(dec.decidedAt || dec.updatedAt)}
                      </div>
                    </td>

                    {/* Action */}
                    <td className="cell-action" style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn-inspect-row"
                        onClick={(e) => {
                          e.stopPropagation();
                          setInspectingDecisionId(dec._id);
                        }}
                      >
                        Inspect →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Genuine Stacked Mobile Cards View (displayed at <=768px) */}
          <div className="decisions-mobile-cards">
            {filteredDecisions.map((dec) => {
              const imp = impactMap[dec._id];
              const classification = imp?.impactClassification || imp?.classification || 'evaluating';
              const totalAffected = imp?.summary?.totalAffectedTasks != null
                ? imp.summary.totalAffectedTasks
                : (dec.linkedTasks?.length || 0);

              return (
                <div
                  key={dec._id}
                  className="decision-mobile-card"
                  onClick={() => setInspectingDecisionId(dec._id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setInspectingDecisionId(dec._id);
                    }
                  }}
                >
                  <div className="mobile-card-top">
                    <div className="mobile-card-id-row">
                      <span className="adr-id-tag">ADR-{dec._id.slice(-4).toUpperCase()}</span>
                      <span className={`status-pill status-${dec.status}`}>
                        {dec.status}
                      </span>
                    </div>
                    <h3 className="mobile-card-title">{dec.title}</h3>
                  </div>

                  <div className="mobile-card-badges">
                    <span className="project-badge">
                      {dec.project?.name || 'Project'}
                    </span>
                    <span className={`impact-badge impact-${classification}`}>
                      {classification.replace('_', ' ')}
                    </span>
                    <span className="impact-subtext">
                      {totalAffected} task{totalAffected === 1 ? '' : 's'} affected
                    </span>
                  </div>

                  <p className="mobile-card-snippet">
                    {dec.decision.slice(0, 110)}...
                  </p>

                  <div className="mobile-card-footer">
                    <div className="mobile-card-author">
                      <span>{dec.decidedBy ? dec.decidedBy.name : (dec.proposedBy?.name || 'Member')}</span>
                      <span className="mobile-card-date">
                        {formatDecisionDate(dec.decidedAt || dec.updatedAt)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn-inspect-mobile"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInspectingDecisionId(dec._id);
                      }}
                    >
                      Inspect →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          </>
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="table-pagination-bar">
            <span className="pagination-info">
              Showing Page {currentPage} of {totalPages} ({totalCount} total decisions)
            </span>
            <div className="pagination-buttons">
              <button
                type="button"
                className="btn-page"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                ← Previous
              </button>
              <button
                type="button"
                className="btn-page"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Propose / Edit ADR Modal */}
      {showCreateModal && (
        <DecisionModal
          decision={editingDecision}
          isOpen={showCreateModal}
          projects={projects}
          defaultProjectId={selectedProjectId !== 'all' ? selectedProjectId : ''}
          onClose={() => {
            setShowCreateModal(false);
            setEditingDecision(null);
          }}
          onSaved={handleDecisionSaved}
        />
      )}

      {/* Decision Inspect Drawer */}
      {inspectingDecisionId && (
        <DecisionDrawer
          decisionId={inspectingDecisionId}
          onClose={() => setInspectingDecisionId(null)}
          onDecisionUpdated={() => fetchDecisions()}
          onEditDecision={(dec) => {
            setInspectingDecisionId(null);
            setEditingDecision(dec);
            setShowCreateModal(true);
          }}
        />
      )}
    </div>
  );
}
