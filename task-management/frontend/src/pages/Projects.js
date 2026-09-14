import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import api from "../utils/api";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";
import "./Projects.css";

const COLOR_PRESETS = [
  "#6366f1", // Indigo
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#ef4444", // Red
  "#14b8a6", // Teal
];

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Search & Filter
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");

  // New Project Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    description: "",
    color: "#6366f1",
    dueDate: "",
    status: "active",
  });

  const { user, isManager, isAdmin } = useAuth();
  const navigate = useNavigate();

  const canCreate = isAdmin || isManager;

  // Fetch Projects & Tasks
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectsRes, tasksRes] = await Promise.all([
        api.get("/projects"),
        api.get("/tasks"),
      ]);
      setProjects(projectsRes.data.projects || []);
      setTasks(tasksRes.data.tasks || []);
    } catch (err) {
      const msg = err.response?.data?.message || "Failed to load projects";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle Create Project
  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!createForm.name.trim()) {
      return toast.error("Project name is required");
    }
    if (createForm.name.trim().length > 80) {
      return toast.error("Project name cannot exceed 80 characters");
    }
    if (createForm.description && createForm.description.trim().length > 500) {
      return toast.error("Description cannot exceed 500 characters");
    }

    setIsSubmitting(true);
    try {
      const payload = {
        name: createForm.name.trim(),
        description: createForm.description.trim(),
        color: createForm.color,
        status: createForm.status,
        dueDate: createForm.dueDate ? new Date(createForm.dueDate).toISOString() : null,
      };

      const { data } = await api.post("/projects", payload);
      if (data.project) {
        setProjects((prev) => [data.project, ...prev]);
        setShowCreateModal(false);
        setCreateForm({
          name: "",
          description: "",
          color: "#6366f1",
          dueDate: "",
          status: "active",
        });
        toast.success("Project created successfully");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to create project");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Close modal on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && showCreateModal) {
        setShowCreateModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showCreateModal]);

  // Pre-index task metrics by project ID
  const projectMetrics = useMemo(() => {
    const map = {};
    for (const task of tasks) {
      const pid = task.project?._id
        ? task.project._id.toString()
        : task.project
        ? task.project.toString()
        : null;
      if (!pid) continue;

      if (!map[pid]) {
        map[pid] = { total: 0, done: 0, inProgress: 0, blocked: 0 };
      }
      map[pid].total += 1;
      if (task.status === "Done") map[pid].done += 1;
      if (task.status === "In Progress") map[pid].inProgress += 1;
      if (task.isBlocked) map[pid].blocked += 1;
    }
    return map;
  }, [tasks]);

  // Filtered projects
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (statusFilter === "active") {
        if (p.status !== "active") return false;
      } else if (statusFilter === "archived") {
        if (p.status !== "archived") return false;
      } else if (statusFilter !== "all") {
        if (p.status !== statusFilter) return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchesName = p.name?.toLowerCase().includes(q);
        const matchesDesc = p.description?.toLowerCase().includes(q);
        if (!matchesName && !matchesDesc) return false;
      }
      return true;
    });
  }, [projects, statusFilter, search]);

  return (
    <div className="projects-page fade-in">
      {/* HEADER */}
      <header className="projects-header">
        <div className="projects-header-left">
          <h1 className="projects-title">Project Control Room</h1>
          <p className="projects-sub">
            Track execution velocity, blockers, and deliverables across team projects
          </p>
        </div>

        {canCreate && (
          <button
            type="button"
            className="btn btn-primary new-project-btn"
            onClick={() => setShowCreateModal(true)}
            aria-label="Create new project"
          >
            + New Project
          </button>
        )}
      </header>

      {/* TOOLBAR: SEARCH & STATUS FILTER */}
      <div className="projects-toolbar">
        <div className="projects-search-wrapper">
          <input
            type="text"
            className="projects-search-input"
            placeholder="Search projects by name or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search projects"
          />
          {search && (
            <button
              type="button"
              className="projects-search-clear"
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <div className="projects-filter-group">
          <label htmlFor="project-status-filter" className="sr-only">
            Filter by status
          </label>
          <select
            id="project-status-filter"
            className="projects-status-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter projects by status"
          >
            <option value="active">Active Projects</option>
            <option value="on-hold">On Hold</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
            <option value="all">All Projects</option>
          </select>
        </div>
      </div>

      {/* CONTENT AREA: LOADING / ERROR / EMPTY / GRID */}
      {loading ? (
        <div className="projects-loading" aria-live="polite">
          <div className="projects-spinner" />
          <p>Loading projects...</p>
        </div>
      ) : error ? (
        <div className="projects-error card" role="alert">
          <span className="error-icon">⚠️</span>
          <h3>Unable to load projects</h3>
          <p>{error}</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={fetchData}
          >
            Retry
          </button>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="projects-empty card">
          <div className="empty-icon-box">◈</div>
          <h2>
            {projects.length === 0
              ? "No workspace projects yet"
              : "No projects match your filter"}
          </h2>
          <p>
            {projects.length === 0
              ? canCreate
                ? "Create your first project to organize deliverables and track team execution."
                : "You have not been added to any projects yet. Contact your manager or admin."
              : "Try adjusting your search keywords or status filter."}
          </p>
          {projects.length === 0 && canCreate && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowCreateModal(true)}
            >
              + Create First Project
            </button>
          )}
        </div>
      ) : (
        <div className="projects-grid" role="list" aria-label="Projects list">
          {filteredProjects.map((project) => {
            const metrics = projectMetrics[project._id] || {
              total: 0,
              done: 0,
              inProgress: 0,
              blocked: 0,
            };
            const completionPct =
              metrics.total > 0
                ? Math.round((metrics.done / metrics.total) * 100)
                : 0;

            const ownerName = project.owner?.name || "Unassigned";
            const ownerInitial = ownerName.charAt(0).toUpperCase();

            // Due Date formatting
            let dueLabel = null;
            let isOverdue = false;
            if (project.dueDate) {
              const d = new Date(project.dueDate);
              if (!isNaN(d.getTime())) {
                const now = new Date();
                const startOfToday = new Date(
                  now.getFullYear(),
                  now.getMonth(),
                  now.getDate()
                );
                isOverdue = d < startOfToday && project.status !== "completed";
                dueLabel = d.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year:
                    d.getFullYear() !== now.getFullYear()
                      ? "numeric"
                      : undefined,
                });
              }
            }

            return (
              <article
                key={project._id}
                className="project-card"
                role="listitem"
                tabIndex={0}
                aria-label={`Project: ${project.name}. Status: ${project.status}. ${metrics.total} tasks, ${completionPct}% completed.`}
                onClick={() => navigate(`/projects/${project._id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/projects/${project._id}`);
                  }
                }}
              >
                {/* COLOR ACCENT BAR */}
                <div
                  className="project-card-accent"
                  style={{ backgroundColor: project.color || "#6366f1" }}
                />

                {/* TOP: NAME & STATUS */}
                <div className="project-top">
                  <div className="project-heading-group">
                    <h2 className="project-name">{project.name}</h2>
                    {project.description ? (
                      <p className="project-desc">{project.description}</p>
                    ) : (
                      <p className="project-desc project-desc-empty">
                        No description provided
                      </p>
                    )}
                  </div>

                  <span className={`project-status project-status-${project.status}`}>
                    {project.status}
                  </span>
                </div>

                {/* MIDDLE: METADATA CHIPS */}
                <div className="project-meta-chips">
                  <div className="project-owner-chip" title={`Owner: ${ownerName}`}>
                    <span className="owner-avatar-mini">{ownerInitial}</span>
                    <span className="owner-name-mini">{ownerName}</span>
                  </div>

                  <div
                    className="project-members-chip"
                    title={`${project.members?.length || 1} team member(s)`}
                  >
                    <span>👥 {project.members?.length || 1}</span>
                  </div>

                  {dueLabel && (
                    <div
                      className={`project-due-chip ${
                        isOverdue ? "project-due-overdue" : ""
                      }`}
                      title={isOverdue ? "Project is overdue" : "Due date"}
                    >
                      <span>
                        {isOverdue ? "⚠️ " : "📅 "}
                        {dueLabel}
                      </span>
                    </div>
                  )}

                  {metrics.blocked > 0 && (
                    <div
                      className="project-blocked-chip"
                      title={`${metrics.blocked} blocked task(s)`}
                    >
                      <span>🚫 {metrics.blocked} blocked</span>
                    </div>
                  )}
                </div>

                {/* PROGRESS BAR & SUMMARY */}
                <div className="project-progress-container">
                  <div className="project-progress-header">
                    <span className="progress-task-count">
                      {user?.role === "member" ? (
                        <>
                          <span style={{ color: "var(--text-1, #fff)" }}>My Visible Work:</span>{" "}
                          {metrics.total === 0
                            ? "0 tasks"
                            : `${metrics.done}/${metrics.total} completed`}
                        </>
                      ) : (
                        <>
                          <span style={{ color: "var(--text-1, #fff)" }}>Project Progress:</span>{" "}
                          {metrics.total === 0
                            ? "0 tasks"
                            : `${metrics.done}/${metrics.total} completed`}
                        </>
                      )}
                    </span>
                    <span className="progress-percentage">
                      {completionPct}%
                    </span>
                  </div>

                  <div
                    className="progress-bar"
                    role="progressbar"
                    aria-valuenow={completionPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={
                      user?.role === "member"
                        ? `My visible task completion: ${completionPct}%`
                        : `Project completion: ${completionPct}%`
                    }
                  >
                    <div
                      className="progress-fill"
                      style={{
                        width: `${completionPct}%`,
                        backgroundColor: project.color || "#6366f1",
                      }}
                    />
                  </div>
                  {user?.role === "member" && (
                    <div
                      className="project-member-scope-hint"
                      style={{
                        fontSize: "11px",
                        color: "var(--text-3, #71717a)",
                        marginTop: "4px",
                      }}
                    >
                      * Reflects tasks assigned to or created by you
                    </div>
                  )}
                </div>

                {/* FOOTER ACTION LINK */}
                <div className="project-card-footer">
                  <span className="project-enter-link">
                    Open Control Room →
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* NEW PROJECT MODAL */}
      {showCreateModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowCreateModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-project-title"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="create-project-title">Create New Project</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowCreateModal(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="create-project-form">
              <div className="form-group">
                <label htmlFor="create-project-name" className="form-label">
                  Project Name *
                </label>
                <input
                  id="create-project-name"
                  type="text"
                  name="name"
                  className="form-input"
                  placeholder="e.g. Core Infrastructure Migration"
                  maxLength={80}
                  value={createForm.name}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, name: e.target.value })
                  }
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label htmlFor="create-project-desc" className="form-label">
                  Description
                </label>
                <textarea
                  id="create-project-desc"
                  name="description"
                  className="form-input form-textarea"
                  placeholder="Briefly describe the mission, scope, or objectives..."
                  maxLength={500}
                  rows={3}
                  value={createForm.description}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      description: e.target.value,
                    })
                  }
                />
              </div>

              <div className="form-row-two">
                <div className="form-group">
                  <label htmlFor="create-project-status" className="form-label">
                    Initial Status
                  </label>
                  <select
                    id="create-project-status"
                    className="form-input"
                    value={createForm.status}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, status: e.target.value })
                    }
                  >
                    <option value="active">Active</option>
                    <option value="on-hold">On Hold</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="create-project-due" className="form-label">
                    Target Due Date
                  </label>
                  <input
                    id="create-project-due"
                    type="date"
                    className="form-input"
                    value={createForm.dueDate}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, dueDate: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Project Color</label>
                <div className="color-presets-row" role="radiogroup" aria-label="Select project color">
                  {COLOR_PRESETS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`color-swatch-btn ${
                        createForm.color === color ? "selected" : ""
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => setCreateForm({ ...createForm, color })}
                      aria-label={`Select color ${color}`}
                      aria-checked={createForm.color === color}
                      role="radio"
                    />
                  ))}
                </div>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmitting || !createForm.name.trim()}
                >
                  {isSubmitting ? "Creating..." : "Create Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
