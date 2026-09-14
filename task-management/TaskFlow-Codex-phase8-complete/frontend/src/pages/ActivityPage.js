import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import ActivityTimeline from '../components/activity/ActivityTimeline';
import ActivityDrawer from '../components/activity/ActivityDrawer';
import toast from 'react-hot-toast';
import './ActivityPage.css';

const CATEGORIES = [
  { id: 'all', label: 'All Activity' },
  { id: 'project', label: 'Projects' },
  { id: 'task', label: 'Tasks' },
  { id: 'dependency', label: 'Dependencies' },
  { id: 'blocker', label: 'Blockers' },
  { id: 'release', label: 'Releases' },
  { id: 'milestone', label: 'Milestones' },
  { id: 'decision', label: 'Decisions' },
  { id: 'capacity', label: 'Capacity' },
];

export default function ActivityPage() {
  const [events, setEvents] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [restrictedContext, setRestrictedContext] = useState(false);
  const [coverage, setCoverage] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);

  // 1. Fetch accessible projects for filter dropdown
  useEffect(() => {
    let mounted = true;
    api.get('/projects')
      .then((res) => {
        if (mounted && res.data?.projects) {
          setProjects(res.data.projects);
        }
      })
      .catch((err) => {
        console.error('Failed to load projects for activity filter:', err);
      });
    return () => { mounted = false; };
  }, []);

  // 2. Fetch ledger coverage diagnostics
  const fetchCoverage = useCallback(async (projId) => {
    try {
      const url = projId && projId !== 'all'
        ? `/activity/coverage?project=${projId}`
        : '/activity/coverage';
      const res = await api.get(url);
      if (res.data?.success) {
        setCoverage(res.data);
      }
    } catch (err) {
      console.warn('Coverage diagnostics unavailable:', err);
      setCoverage(null);
    }
  }, []);

  // 3. Fetch activity feed
  const fetchFeed = useCallback(async (reset = true) => {
    if (reset) {
      setLoading(true);
      setNextCursor(null);
    } else {
      setLoadingMore(true);
    }

    try {
      const params = new URLSearchParams();
      if (selectedProject && selectedProject !== 'all') {
        params.append('project', selectedProject);
      }
      if (selectedCategory && selectedCategory !== 'all') {
        params.append('category', selectedCategory);
      }
      params.append('limit', '25');

      if (!reset && nextCursor) {
        params.append('cursor', nextCursor);
      }

      const res = await api.get(`/activity?${params.toString()}`);
      if (res.data?.success) {
        const newEvents = res.data.events || [];
        setEvents((prev) => (reset ? newEvents : [...prev, ...newEvents]));
        setNextCursor(res.data.nextCursor || null);
        setHasMore(Boolean(res.data.hasMore));
        setRestrictedContext(Boolean(res.data.restricted_activity_context));
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to load activity';
      toast.error(msg);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [selectedProject, selectedCategory, nextCursor]);

  // Initial fetch and on filter changes
  useEffect(() => {
    fetchFeed(true);
    fetchCoverage(selectedProject);
  }, [selectedProject, selectedCategory, fetchFeed, fetchCoverage]);

  const handleLoadMore = () => {
    if (!loadingMore && hasMore && nextCursor) {
      fetchFeed(false);
    }
  };

  return (
    <div className="activity-page">
      {/* Header */}
      <div className="activity-header">
        <div className="activity-title-row">
          <h1 className="activity-title">
            Activity Timeline & Execution Ledger
            <span className="activity-ledger-tag">Execution History</span>
          </h1>
        </div>
        <p className="activity-subtitle">
          Application-level versioned execution history answering what changed, who changed it,
          when did it change, and which delivery object was affected across the engineering lifecycle.
        </p>
        <p className="activity-disclaimer">
          Application-level versioned execution history for operational traceability and delivery observability.
        </p>
      </div>

      {/* Member Privacy Banner */}
      {restrictedContext && (
        <div className="activity-privacy-banner" role="status">
          <span>🔒</span>
          <div>
            <strong>Restricted Activity Context Active:</strong> You are viewing activity filtered to your explicit project memberships and assigned execution scope. Colleague private streams are omitted.
          </div>
        </div>
      )}

      {/* Ledger Coverage Diagnostics */}
      {coverage && (
        <div className="activity-coverage-card">
          <div className="activity-coverage-stats">
            <div className="activity-stat-item">
              <span className="activity-stat-label">Total Events</span>
              <span className="activity-stat-value">{coverage.ledger?.totalEvents ?? '—'}</span>
            </div>
            <div className="activity-stat-item">
              <span className="activity-stat-label">Aggregates Tracked</span>
              <span className="activity-stat-value">{coverage.ledger?.distinctAggregatesTracked ?? '—'}</span>
            </div>
            <div className="activity-stat-item">
              <span className="activity-stat-label">Domains</span>
              <span className="activity-stat-value">8 Domains</span>
            </div>
          </div>
          <div className="activity-coverage-status">
            <span style={{ color: '#10b981' }}>●</span>
            <span>Ledger Active: Monotonic Versioning &amp; Synchronous Append</span>
          </div>
        </div>
      )}

      {/* Filters Bar */}
      <div className="activity-filters-bar">
        <div className="activity-filters-row">
          <select
            className="activity-select"
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            aria-label="Filter activity by project"
          >
            <option value="all">All Accessible Projects</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>

          <div className="activity-category-pills" role="tablist" aria-label="Event category filters">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                role="tab"
                aria-selected={selectedCategory === cat.id}
                className={`activity-pill ${selectedCategory === cat.id ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
          <div className="activity-spinner" style={{ width: '28px', height: '28px', borderWidth: '3px' }} />
          <p style={{ marginTop: '16px', fontSize: '14px' }}>Loading execution ledger events...</p>
        </div>
      ) : (
        <>
          <ActivityTimeline
            events={events}
            onSelectEvent={(ev) => setSelectedEvent(ev)}
          />

          {hasMore && (
            <div className="activity-load-more-wrap">
              <button
                className="activity-load-more-btn"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <>
                    <span className="activity-spinner" />
                    <span>Fetching older events...</span>
                  </>
                ) : (
                  <span>Load More Activity</span>
                )}
              </button>
            </div>
          )}
        </>
      )}

      {/* Detail Drawer */}
      {selectedEvent && (
        <ActivityDrawer
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}
