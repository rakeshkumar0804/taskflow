import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../utils/api";
import FlowHealthWidget from "../components/tasks/FlowHealthWidget";
import "./Dashboard.css";

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
};

const getDueDateInfo = (dueDate, status) => {
  if (!dueDate) {
    return { label: "No due date", isOverdue: false, isToday: false };
  }
  const d = new Date(dueDate);
  if (isNaN(d.getTime())) {
    return { label: "No due date", isOverdue: false, isToday: false };
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const formatted = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  if (status !== "Done" && d < startOfToday) {
    return { label: `Overdue (${formatted})`, isOverdue: true, isToday: false };
  }
  if (status !== "Done" && d >= startOfToday && d <= endOfToday) {
    return { label: `Due today (${formatted})`, isOverdue: false, isToday: true };
  }
  return { label: formatted, isOverdue: false, isToday: false };
};

const getTaskRisk = (task) => {
  if (task.status === "Done") return null;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);

  const risks = [];

  // Rule 1: Overdue and not Done
  if (task.dueDate) {
    const due = new Date(task.dueDate);
    if (!isNaN(due.getTime())) {
      if (due < startOfToday) {
        risks.push({ reason: "Overdue", severity: 1, type: "overdue" });
      } else if (due <= in48Hours) {
        // Rule 2: Due within 48 hours and not Done
        risks.push({ reason: "Due within 48h", severity: 2, type: "soon" });
      }
    }
  }

  // Rule 3: In Progress but not updated for at least four days
  if (task.status === "In Progress" && task.updatedAt) {
    const updated = new Date(task.updatedAt);
    if (!isNaN(updated.getTime()) && updated <= fourDaysAgo) {
      risks.push({ reason: "Stalled in progress (4d+)", severity: 3, type: "stalled" });
    }
  }

  // Rule 4: High or critical priority and still To Do
  if ((task.priority === "critical" || task.priority === "high") && task.status === "To Do") {
    risks.push({ reason: "High priority not started", severity: 4, type: "unstarted" });
  }

  if (risks.length === 0) return null;

  // Deduplicate and select primary risk by highest severity
  risks.sort((a, b) => a.severity - b.severity);

  return {
    primaryReason: risks[0].reason,
    type: risks[0].type,
    additionalCount: risks.length - 1,
    severity: risks[0].severity,
  };
};

const getFocusScore = (task, currentUserId) => {
  if (task.status === "Done") return 0;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  let score = 0;
  const isAssignedToMe = task.assignedTo?._id
    ? task.assignedTo._id.toString() === currentUserId?.toString()
    : task.assignedTo?.toString() === currentUserId?.toString();

  // 1. Overdue incomplete tasks
  if (task.dueDate) {
    const due = new Date(task.dueDate);
    if (!isNaN(due.getTime())) {
      if (due < startOfToday) {
        score += 1000;
      } else if (due <= endOfToday) {
        // 2. Tasks due today
        score += 500;
      }
    }
  }

  // 3. High or critical incomplete tasks
  if (task.priority === "critical") score += 200;
  if (task.priority === "high") score += 100;

  // 4. In-progress tasks assigned to current user
  if (task.status === "In Progress" && isAssignedToMe) {
    score += 50;
  } else if (task.status === "In Progress") {
    score += 25;
  }

  return score;
};

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/tasks");
      setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load workspace data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  if (loading) {
    return (
      <div className="dashboard fade-in" aria-busy="true" aria-label="Loading workspace data">
        <div className="dashboard-loading">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard fade-in" role="alert">
        <div className="card" style={{ padding: "40px", textAlign: "center" }}>
          <h2 style={{ color: "var(--red, #ef4444)", marginBottom: "12px", fontSize: "18px" }}>
            Workspace Connection Error
          </h2>
          <p style={{ color: "var(--text-2, #a0a0aa)", fontSize: "14px", marginBottom: "20px" }}>
            {error}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={loadDashboardData}
            aria-label="Retry connection to workspace"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  // SECTION 3: Summary counts from single authorized task dataset
  const total = tasks.length;
  const inProgressCount = tasks.filter((t) => t.status === "In Progress").length;
  const completedCount = tasks.filter((t) => t.status === "Done").length;
  const todoCount = tasks.filter((t) => t.status === "To Do").length;

  // SECTION 4: Priority distribution counts
  const criticalCount = tasks.filter((t) => t.priority === "critical").length;
  const highCount = tasks.filter((t) => t.priority === "high").length;
  const mediumCount = tasks.filter((t) => t.priority === "medium").length;
  const lowCount = tasks.filter((t) => t.priority === "low").length;

  // SECTION 5: Today's Focus (max 5 prioritized tasks)
  const focusTasks = tasks
    .filter((t) => t.status !== "Done")
    .map((task) => ({ task, score: getFocusScore(task, user?._id) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ task }) => task);

  // SECTION 6: At-Risk Work (max 5 at-risk tasks)
  const atRiskItems = tasks
    .map((task) => ({ task, risk: getTaskRisk(task) }))
    .filter(({ risk }) => risk !== null)
    .sort((a, b) => a.risk.severity - b.risk.severity)
    .slice(0, 5);

  const firstName = user?.name ? user.name.trim().split(" ")[0] : null;
  const greeting = firstName ? `${getGreeting()}, ${firstName} 👋` : `${getGreeting()} 👋`;

  const roleBadgeClass = {
    admin: "badge-critical",
    manager: "badge-high",
    member: "badge-medium",
  }[user?.role] || "badge-medium";

  return (
    <div className="dashboard fade-in">
      {/* SECTION 2 & 9: Header */}
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-greeting">{greeting}</h1>
          <p className="dashboard-sub">
            {total > 0
              ? `Real-time command center across ${total} workspace task${total === 1 ? "" : "s"}`
              : "Here's what's happening in your workspace"}
          </p>
        </div>

        <div className="dashboard-role-badge">
          <span className={`badge ${roleBadgeClass}`}>
            {user?.role ? user.role.toUpperCase() : "MEMBER"}
          </span>
        </div>
      </header>

      {/* FLOW HEALTH V1: Command Center Health Widget */}
      <FlowHealthWidget user={user} />

      {/* SECTION 3: Summary Cards */}
      <section className="stats-grid" aria-label="Task Summary">
        <div className="stat-card card">
          <div
            className="stat-icon"
            style={{
              color: "var(--accent)",
              background: "rgba(124, 92, 255, 0.1)",
            }}
            aria-hidden="true"
          >
            ✦
          </div>
          <div className="stat-info">
            <span className="stat-value">{total}</span>
            <span className="stat-label">Total Tasks</span>
          </div>
        </div>

        <div className="stat-card card">
          <div
            className="stat-icon"
            style={{
              color: "#3b82f6",
              background: "rgba(59,130,246,0.1)",
            }}
            aria-hidden="true"
          >
            ◉
          </div>
          <div className="stat-info">
            <span className="stat-value">{inProgressCount}</span>
            <span className="stat-label">In Progress</span>
          </div>
        </div>

        <div className="stat-card card">
          <div
            className="stat-icon"
            style={{
              color: "#22c55e",
              background: "rgba(34,197,94,0.1)",
            }}
            aria-hidden="true"
          >
            ✓
          </div>
          <div className="stat-info">
            <span className="stat-value">{completedCount}</span>
            <span className="stat-label">Completed</span>
          </div>
        </div>

        <div className="stat-card card">
          <div
            className="stat-icon"
            style={{
              color: "#eab308",
              background: "rgba(234,179,8,0.1)",
            }}
            aria-hidden="true"
          >
            ◎
          </div>
          <div className="stat-info">
            <span className="stat-value">{todoCount}</span>
            <span className="stat-label">To Do</span>
          </div>
        </div>
      </section>

      {/* SECTION 5 & 6: Command Center Grid (Today's Focus & At-Risk Work) */}
      <div className="command-center-grid">
        {/* SECTION 5: Today's Focus */}
        <section className="card command-card" aria-label="Today's Focus">
          <div className="command-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h2 className="section-title" style={{ margin: 0 }}>
                Today's Focus
              </h2>
              <span className="command-card-badge">{focusTasks.length}</span>
            </div>
            {total > 0 && (
              <button
                type="button"
                className="dashboard-link"
                onClick={() => navigate("/tasks")}
                aria-label="Open full task board"
              >
                Task board →
              </button>
            )}
          </div>

          {focusTasks.length === 0 ? (
            <div className="empty-state">
              <p>All clear for today. Pick up your next priority from the task board.</p>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: "12px", fontSize: "12px", padding: "6px 14px" }}
                onClick={() => navigate("/tasks")}
                aria-label="Pick up next priority from task board"
              >
                Go to Task Board →
              </button>
            </div>
          ) : (
            <div className="task-list">
              {focusTasks.map((task) => {
                const dueInfo = getDueDateInfo(task.dueDate, task.status);

                return (
                  <div
                    key={task._id}
                    className="task-row"
                    onClick={() => navigate("/tasks")}
                    style={{ cursor: "pointer" }}
                    title="Open in Tasks"
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => e.key === "Enter" && navigate("/tasks")}
                  >
                    <div className="task-row-left">
                      <span className={`badge badge-${task.priority || "medium"}`}>
                        {task.priority || "medium"}
                      </span>

                      {task.project?.name && (
                        <span
                          className="task-project-tag"
                          style={{
                            borderColor: task.project.color || "rgba(255,255,255,0.1)",
                          }}
                        >
                          {task.project.name}
                        </span>
                      )}

                      <span className="task-row-title">{task.title}</span>
                    </div>

                    <div className="task-row-right">
                      <span
                        className={`task-due ${
                          dueInfo.isOverdue
                            ? "task-due-overdue"
                            : dueInfo.isToday
                            ? "task-due-today"
                            : ""
                        }`}
                      >
                        {dueInfo.isOverdue ? "⚠️ " : dueInfo.isToday ? "⏰ " : ""}
                        {dueInfo.label}
                      </span>

                      <span className={`badge badge-${task.status}`}>
                        {task.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* SECTION 6: At-Risk Work */}
        <section className="card command-card" aria-label="At-Risk Work">
          <div className="command-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h2 className="section-title" style={{ margin: 0 }}>
                At-Risk Work
              </h2>
              <span
                className="command-card-badge"
                style={{
                  color: atRiskItems.length > 0 ? "#ef4444" : "var(--text-2)",
                }}
              >
                {atRiskItems.length}
              </span>
            </div>
            {total > 0 && (
              <button
                type="button"
                className="dashboard-link"
                onClick={() => navigate("/tasks")}
                aria-label="View all tasks"
              >
                View all ({total}) →
              </button>
            )}
          </div>

          {atRiskItems.length === 0 ? (
            <div className="empty-state">
              <p>No tasks are currently at risk.</p>
            </div>
          ) : (
            <div className="task-list">
              {atRiskItems.map(({ task, risk }) => {
                const dueInfo = getDueDateInfo(task.dueDate, task.status);

                return (
                  <div
                    key={task._id}
                    className="task-row"
                    onClick={() => navigate("/tasks")}
                    style={{ cursor: "pointer" }}
                    title="Open in Tasks"
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => e.key === "Enter" && navigate("/tasks")}
                  >
                    <div className="task-row-left">
                      <span className={`risk-tag risk-tag-${risk.type}`}>
                        {risk.primaryReason}
                        {risk.additionalCount > 0 ? ` (+${risk.additionalCount})` : ""}
                      </span>

                      <span className="task-row-title">{task.title}</span>
                    </div>

                    <div className="task-row-right">
                      <span className={`badge badge-${task.priority || "medium"}`}>
                        {task.priority || "medium"}
                      </span>

                      <span
                        className={`task-due ${
                          dueInfo.isOverdue ? "task-due-overdue" : ""
                        }`}
                      >
                        {dueInfo.label}
                      </span>

                      <span className={`badge badge-${task.status}`}>
                        {task.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* SECTION 4: Priority Breakdown */}
      <section className="card priority-section" aria-label="Priority Distribution">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "18px" }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            Priority Breakdown
          </h2>
          <span style={{ fontSize: "12px", color: "var(--text-3, #71717a)" }}>
            {total > 0 ? `${total} total task${total === 1 ? "" : "s"}` : "0 tasks"}
          </span>
        </div>

        {total === 0 ? (
          <div className="empty-state">
            <p>No tasks recorded in this workspace.</p>
          </div>
        ) : (
          <div className="priority-bars">
            <div className="priority-bar-row">
              <span className="priority-bar-label">Critical</span>
              <div className="priority-bar-track">
                <div
                  className="priority-bar-fill"
                  style={{
                    width: `${Math.round((criticalCount / total) * 100)}%`,
                    background: "#ef4444",
                  }}
                />
              </div>
              <div className="priority-bar-count">
                <span>{criticalCount}</span>
                <span className="priority-bar-pct">({Math.round((criticalCount / total) * 100)}%)</span>
              </div>
            </div>

            <div className="priority-bar-row">
              <span className="priority-bar-label">High</span>
              <div className="priority-bar-track">
                <div
                  className="priority-bar-fill"
                  style={{
                    width: `${Math.round((highCount / total) * 100)}%`,
                    background: "#f97316",
                  }}
                />
              </div>
              <div className="priority-bar-count">
                <span>{highCount}</span>
                <span className="priority-bar-pct">({Math.round((highCount / total) * 100)}%)</span>
              </div>
            </div>

            <div className="priority-bar-row">
              <span className="priority-bar-label">Medium</span>
              <div className="priority-bar-track">
                <div
                  className="priority-bar-fill"
                  style={{
                    width: `${Math.round((mediumCount / total) * 100)}%`,
                    background: "#eab308",
                  }}
                />
              </div>
              <div className="priority-bar-count">
                <span>{mediumCount}</span>
                <span className="priority-bar-pct">({Math.round((mediumCount / total) * 100)}%)</span>
              </div>
            </div>

            <div className="priority-bar-row">
              <span className="priority-bar-label">Low</span>
              <div className="priority-bar-track">
                <div
                  className="priority-bar-fill"
                  style={{
                    width: `${Math.round((lowCount / total) * 100)}%`,
                    background: "#22c55e",
                  }}
                />
              </div>
              <div className="priority-bar-count">
                <span>{lowCount}</span>
                <span className="priority-bar-pct">({Math.round((lowCount / total) * 100)}%)</span>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
