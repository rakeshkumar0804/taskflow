import React, { useState, useEffect, useCallback } from "react";
import api from "../../utils/api";
import "./FlowHealthWidget.css";

const getScoreColor = (score) => {
  if (score === null || score === undefined) return "var(--text-3, #71717a)";
  if (score >= 90) return "#22c55e"; // Green
  if (score >= 75) return "#3b82f6"; // Blue
  if (score >= 50) return "#eab308"; // Amber
  return "#ef4444"; // Red
};

const getScoreIcon = (score) => {
  if (score === null || score === undefined) return "⚪";
  if (score >= 90) return "🟢";
  if (score >= 75) return "🔵";
  if (score >= 50) return "🟡";
  return "🔴";
};

const formatCalculatedTime = (isoString) => {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

export default function FlowHealthWidget({
  projectId = null,
  user = null,
  titleOverride = null,
  className = "",
  isArchived = false,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const isMember = user?.role === "member";
  const isProjectScope = Boolean(projectId);

  const defaultTitle = isProjectScope
    ? "Project Flow Health"
    : isMember
    ? "My Flow Health"
    : "Workspace Flow Health";

  const title = titleOverride || defaultTitle;

  const fetchHealth = useCallback(async () => {
    // If member is viewing a project, project-wide health is restricted by design
    if (isMember && isProjectScope) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const url = isProjectScope
        ? `/tasks/health?project=${encodeURIComponent(projectId)}`
        : "/tasks/health";
      const res = await api.get(url);
      setData(res.data);
    } catch (err) {
      const errMsg =
        err.response?.data?.message || err.message || "Failed to load Flow Health";
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  }, [projectId, isMember, isProjectScope]);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  // If member on project scope: truthfully inform that project-wide health is not available
  if (isMember && isProjectScope) {
    return (
      <section
        className={`flow-health-card card ${className}`}
        aria-label={title}
      >
        <div className="flow-health-header">
          <div className="flow-health-title-group">
            <h3 className="flow-health-title">{title}</h3>
            <span className="flow-health-scope-tag">Personal Scope</span>
          </div>
        </div>
        <div className="flow-health-body">
          <div className="flow-health-restricted">
            <span className="flow-health-icon" aria-hidden="true">🔒</span>
            <p className="flow-health-message">
              Project-wide health is reserved for managers and administrators.
              Members view individual visible tasks.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // Archived state
  if (isArchived || data?.availability === "archived") {
    return (
      <section
        className={`flow-health-card card ${className}`}
        aria-label={title}
      >
        <div className="flow-health-header">
          <div className="flow-health-title-group">
            <h3 className="flow-health-title">{title}</h3>
            <span className="flow-health-badge badge-archived">ARCHIVED</span>
          </div>
        </div>
        <div className="flow-health-body">
          <div className="flow-health-empty-content">
            <span className="flow-health-icon" aria-hidden="true">📦</span>
            <p className="flow-health-message">
              Flow Health calculation is inactive for archived projects. All task records and history remain preserved.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const score = data?.score;
  const label = data?.label || "NOT ENOUGH DATA";
  const scoreColor = getScoreColor(score);
  const scoreIcon = getScoreIcon(score);
  const topPenalties = (data?.penalties || []).slice(0, 3);
  const activeTasks = data?.metrics?.activeTasks ?? 0;
  const calculatedAtStr = formatCalculatedTime(data?.calculatedAt);

  return (
    <section
      className={`flow-health-card card ${className}`}
      aria-label={title}
      aria-busy={loading}
    >
      <div className="flow-health-header">
        <div className="flow-health-title-group">
          <div className="flow-health-title-row">
            <h3 className="flow-health-title">{title}</h3>
            <span
              className="flow-health-scope-tag"
              title={
                isMember
                  ? "Computed only from tasks assigned to or created by you"
                  : isProjectScope
                  ? "Computed across all project deliverables"
                  : "Computed across all workspace tasks"
              }
            >
              {data?.scope === "personal"
                ? "Personal Scope"
                : data?.scope === "project"
                ? "Project Scope"
                : "Workspace Scope"}
            </span>
          </div>
          {isMember && !isProjectScope && (
            <span className="flow-health-subtext">
              Based exclusively on your assigned and created work
            </span>
          )}
        </div>

        <div className="flow-health-actions">
          {calculatedAtStr && !loading && (
            <span className="flow-health-timestamp" title="Calculation time">
              Updated {calculatedAtStr}
            </span>
          )}
          <button
            type="button"
            className="flow-health-refresh-btn"
            onClick={fetchHealth}
            disabled={loading}
            aria-label="Refresh Flow Health"
            title="Refresh Flow Health"
          >
            <span className={`refresh-icon ${loading ? "spinning" : ""}`} aria-hidden="true">
              ↻
            </span>
          </button>
        </div>
      </div>

      <div className="flow-health-body">
        {loading && !data ? (
          <div className="flow-health-loading" aria-live="polite">
            <span className="flow-health-spinner" aria-hidden="true" />
            <span>Calculating Flow Health...</span>
          </div>
        ) : error ? (
          <div className="flow-health-error" role="alert">
            <span className="error-icon" aria-hidden="true">⚠️</span>
            <div className="error-content">
              <p className="error-msg">{error}</p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={fetchHealth}
                aria-label="Retry loading Flow Health"
              >
                Retry
              </button>
            </div>
          </div>
        ) : data?.availability === "insufficient_data" ? (
          <div className="flow-health-insufficient">
            <div className="insufficient-header">
              <span className="insufficient-badge">NOT ENOUGH DATA</span>
              <span className="insufficient-count">
                {activeTasks} / 3 active tasks
              </span>
            </div>
            <p className="insufficient-msg">
              Add at least 3 active tasks to calculate Flow Health.
            </p>
            <div className="insufficient-track" aria-hidden="true">
              <div
                className="insufficient-fill"
                style={{ width: `${Math.min(100, Math.round((activeTasks / 3) * 100))}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flow-health-available">
            <div className="flow-health-metric-row">
              {/* Score Display */}
              <div className="flow-health-score-block">
                <div className="score-number-group">
                  <span
                    className="flow-health-score-value"
                    style={{ color: scoreColor }}
                  >
                    {score}
                  </span>
                  <span className="flow-health-score-max">/100</span>
                </div>
                <div
                  className="flow-health-label-badge"
                  style={{ borderColor: scoreColor, color: scoreColor }}
                >
                  <span aria-hidden="true">{scoreIcon}</span>
                  <span>{label}</span>
                </div>
              </div>

              {/* Mini Score Bar */}
              <div className="flow-health-progress-wrap" aria-hidden="true">
                <div className="flow-health-bar-track">
                  <div
                    className="flow-health-bar-fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, score || 0))}%`,
                      backgroundColor: scoreColor,
                    }}
                  />
                </div>
                <div className="flow-health-active-count">
                  {activeTasks} active task{activeTasks === 1 ? "" : "s"} evaluated
                </div>
              </div>
            </div>

            {/* Deductions / Top Risk Drivers */}
            <div className="flow-health-deductions-wrap">
              <h4 className="deductions-title">
                {topPenalties.length > 0 ? "Top Health Drivers" : "Flow Condition"}
              </h4>

              {topPenalties.length === 0 ? (
                <div className="flow-health-optimal-note">
                  <span aria-hidden="true">✓</span>
                  <span>All active work is progressing within expected flow limits. Zero deductions.</span>
                </div>
              ) : (
                <ul className="flow-health-penalties-list" aria-label="Health penalty deductions">
                  {topPenalties.map((penalty, idx) => (
                    <li key={idx} className="penalty-item">
                      <span className="penalty-points" aria-label={`Minus ${penalty.points} points`}>
                        -{penalty.points}
                      </span>
                      <span className="penalty-desc">{penalty.description}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
