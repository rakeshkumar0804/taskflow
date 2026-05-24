import React from "react";
import "./Dashboard.css";

export default function Dashboard() {
  return (
    <div className="dashboard fade-in">
      {/* Header */}
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-greeting">
            Good morning, Rakesh 👋
          </h1>

          <p className="dashboard-sub">
            Here's what's happening in your workspace
          </p>
        </div>

        <div className="dashboard-role-badge">
          <span className="badge badge-critical">
            ADMIN
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card card">
          <div
            className="stat-icon"
            style={{
              color: "var(--accent)",
              background: "rgba(124, 92, 255, 0.1)",
            }}
          >
            ✦
          </div>

          <div className="stat-info">
            <span className="stat-value">12</span>
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
          >
            ◉
          </div>

          <div className="stat-info">
            <span className="stat-value">5</span>
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
          >
            ✓
          </div>

          <div className="stat-info">
            <span className="stat-value">4</span>
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
          >
            ◎
          </div>

          <div className="stat-info">
            <span className="stat-value">3</span>
            <span className="stat-label">To Do</span>
          </div>
        </div>
      </div>

      {/* Bottom */}
      <div className="dashboard-bottom">
        {/* Tasks */}
        <div className="card recent-tasks">
          <h2 className="section-title">
            In Progress Tasks
          </h2>

          <div className="task-list">
            <div className="task-row">
              <div className="task-row-left">
                <span className="badge badge-high">
                  high
                </span>

                <span className="task-row-title">
                  Build dashboard UI
                </span>
              </div>

              <div className="task-row-right">
                <span className="task-due">24/05/2026</span>
              </div>
            </div>

            <div className="task-row">
              <div className="task-row-left">
                <span className="badge badge-medium">
                  medium
                </span>

                <span className="task-row-title">
                  Fix login authentication
                </span>
              </div>

              <div className="task-row-right">
                <span className="task-due">26/05/2026</span>
              </div>
            </div>
          </div>
        </div>

        {/* Priority */}
        <div className="card priority-chart">
          <h2 className="section-title">
            Priority Breakdown
          </h2>

          <div className="priority-bars">
            <div className="priority-bar-row">
              <span className="priority-bar-label">
                Critical
              </span>

              <div className="priority-bar-track">
                <div
                  className="priority-bar-fill"
                  style={{
                    width: "70%",
                    background: "#ef4444",
                  }}
                />
              </div>

              <span className="priority-bar-count">7</span>
            </div>

            <div className="priority-bar-row">
              <span className="priority-bar-label">
                High
              </span>

              <div className="priority-bar-track">
                <div
                  className="priority-bar-fill"
                  style={{
                    width: "50%",
                    background: "#f97316",
                  }}
                />
              </div>

              <span className="priority-bar-count">5</span>
            </div>

            <div className="priority-bar-row">
              <span className="priority-bar-label">
                Medium
              </span>

              <div className="priority-bar-track">
                <div
                  className="priority-bar-fill"
                  style={{
                    width: "40%",
                    background: "#eab308",
                  }}
                />
              </div>

              <span className="priority-bar-count">4</span>
            </div>

            <div className="priority-bar-row">
              <span className="priority-bar-label">
                Low
              </span>

              <div className="priority-bar-track">
                <div
                  className="priority-bar-fill"
                  style={{
                    width: "20%",
                    background: "#22c55e",
                  }}
                />
              </div>

              <span className="priority-bar-count">2</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
