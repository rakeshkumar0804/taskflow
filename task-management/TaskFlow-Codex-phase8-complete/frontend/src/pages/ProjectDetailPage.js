import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api from "../utils/api";
import { useAuth } from "../context/AuthContext";
import { useTasks } from "../hooks/useTasks";
import toast from "react-hot-toast";
import TaskDrawer from "../components/tasks/TaskDrawer";
import GitHubEvidenceBadge from "../components/tasks/GitHubEvidenceBadge";
import FlowHealthWidget from "../components/tasks/FlowHealthWidget";
import DecisionDrawer from "../components/decisions/DecisionDrawer";
import DecisionModal from "../components/decisions/DecisionModal";
import {
  COLUMNS,
  getDueDateInfo,
  isTaskInMyFocus,
  getPrimaryRiskReason,
  isTaskAtRisk,
  formatRelativeTime,
} from "../utils/taskHelpers";
import "./ProjectDetailPage.css";
import "./TasksPage.css";

const COLOR_PRESETS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#14b8a6",
];

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user, isManager, isAdmin } = useAuth();

  // Project state
  const [project, setProject] = useState(null);
  const [loadingProject, setLoadingProject] = useState(true);
  const [projectError, setProjectError] = useState(null);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    color: "#6366f1",
    status: "active",
    dueDate: "",
  });

  // Archive / Restore state
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Task filtering & view
  const [view, setView] = useState("kanban");
  const [smartFilter, setSmartFilter] = useState("all");

  // Selected task for Task Drawer
  const [activeTask, setActiveTask] = useState(null);

  // Project-scoped tasks hook
  const {
    tasks,
    loading: loadingTasks,
    updateTask,
    deleteTask,
    addComment,
    fetchTasks,
  } = useTasks({ project: projectId });

  // Fetch single project
  const fetchProject = useCallback(async () => {
    setLoadingProject(true);
    setProjectError(null);
    try {
      const { data } = await api.get(`/projects/${projectId}`);
      setProject(data.project);
      setEditForm({
        name: data.project.name || "",
        description: data.project.description || "",
        color: data.project.color || "#6366f1",
        status: data.project.status || "active",
        dueDate: data.project.dueDate ? data.project.dueDate.split("T")[0] : "",
      });
    } catch (err) {
      const status = err.response?.status;
      const msg =
        status === 404
          ? "Project not found"
          : status === 403
          ? "Not authorized to access this project"
          : err.response?.data?.message || "Failed to load project details";
      setProjectError({ status, message: msg });
    } finally {
      setLoadingProject(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  // Releases & Milestones state
  const [projectReleases, setProjectReleases] = useState([]);
  const [projectMilestones, setProjectMilestones] = useState([]);
  const [loadingReleases, setLoadingReleases] = useState(false);

  const fetchProjectReleases = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoadingReleases(true);
      const [relRes, msRes] = await Promise.all([
        api.get(`/releases?project=${projectId}`),
        api.get(`/milestones?project=${projectId}`),
      ]);
      if (relRes.data?.success) setProjectReleases(relRes.data.releases || []);
      if (msRes.data?.success) setProjectMilestones(msRes.data.milestones || []);
    } catch (err) {
      console.error("Failed to load project delivery targets", err);
    } finally {
      setLoadingReleases(false);
    }
  }, [projectId]);

  const [deliveryIntel, setDeliveryIntel] = useState(null);

  const fetchDeliveryIntel = useCallback(async () => {
    if (!projectId) return;
    try {
      const { data } = await api.get(`/projects/${projectId}/delivery-intelligence`);
      if (data?.success) {
        setDeliveryIntel(data);
      }
    } catch (e) {
      // fallback
    }
  }, [projectId]);

  // Decisions state & fetch
  const [projectDecisions, setProjectDecisions] = useState([]);
  const [loadingDecisions, setLoadingDecisions] = useState(false);
  const [inspectingDecisionId, setInspectingDecisionId] = useState(null);
  const [showProposeDecisionModal, setShowProposeDecisionModal] = useState(false);

  const fetchProjectDecisions = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoadingDecisions(true);
      const { data } = await api.get(`/decisions?project=${projectId}&limit=6`);
      if (data?.success) {
        setProjectDecisions(data.decisions || []);
      }
    } catch (e) {
      console.error("Failed to load project decisions", e);
    } finally {
      setLoadingDecisions(false);
    }
  }, [projectId]);

  // Capacity Intelligence state & fetch
  const [capacityIntel, setCapacityIntel] = useState(null);
  const [loadingCapacity, setLoadingCapacity] = useState(false);

  const fetchCapacityIntel = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoadingCapacity(true);
      const { data } = await api.get(`/projects/${projectId}/capacity-intelligence?horizonDays=14`);
      if (data?.success) {
        setCapacityIntel(data.data);
      }
    } catch (e) {
      // fallback
    } finally {
      setLoadingCapacity(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProjectReleases();
    fetchDeliveryIntel();
    fetchProjectDecisions();
    fetchCapacityIntel();
  }, [fetchProjectReleases, fetchDeliveryIntel, fetchProjectDecisions, fetchCapacityIntel]);

  // Authorization for Edit / Delete
  const canEditDelete = useMemo(() => {
    if (!project || !user) return false;
    if (isAdmin) return true;
    if (isManager) {
      const ownerId = (project.owner?._id || project.owner)?.toString();
      const currentUserId = (user._id || user.id)?.toString();
      return Boolean(ownerId && currentUserId && ownerId === currentUserId);
    }
    return false;
  }, [project, user, isAdmin, isManager]);

  // Handle Edit Submit
  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editForm.name.trim()) {
      return toast.error("Project name cannot be empty");
    }
    if (editForm.name.trim().length > 80) {
      return toast.error("Project name cannot exceed 80 characters");
    }
    if (editForm.description && editForm.description.trim().length > 500) {
      return toast.error("Description cannot exceed 500 characters");
    }

    setIsUpdating(true);
    try {
      const payload = {
        name: editForm.name.trim(),
        description: editForm.description.trim(),
        color: editForm.color,
        status: editForm.status,
        dueDate: editForm.dueDate ? new Date(editForm.dueDate).toISOString() : null,
      };

      const { data } = await api.put(`/projects/${projectId}`, payload);
      if (data.project) {
        setProject(data.project);
        setShowEditModal(false);
        toast.success("Project updated successfully");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update project");
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle Safe Archival
  const handleArchiveProject = async () => {
    setIsArchiving(true);
    try {
      const { data } = await api.put(`/projects/${projectId}`, { status: "archived" });
      if (data.project) {
        setProject(data.project);
      }
      setShowArchiveModal(false);
      toast.success("Project archived. All tasks and history have been preserved.");
      navigate("/projects");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to archive project");
    } finally {
      setIsArchiving(false);
    }
  };

  // Handle Restore Project
  const handleRestoreProject = async () => {
    setIsRestoring(true);
    try {
      const { data } = await api.put(`/projects/${projectId}`, { status: "active" });
      if (data.project) {
        setProject(data.project);
        setEditForm((prev) => ({ ...prev, status: "active" }));
      }
      toast.success("Project restored to active status");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to restore project");
    } finally {
      setIsRestoring(false);
    }
  };

  // Escape key listener for modals
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        if (showEditModal) setShowEditModal(false);
        if (showArchiveModal) setShowArchiveModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showEditModal, showArchiveModal]);

  // Operational Execution Status
  const opStatus = useMemo(() => {
    if (!project) return { label: "Not available", class: "op-unknown", icon: "—", reason: "" };

    // Member view: Truthful progress scope - project-wide operational health is not available
    if (user?.role === "member") {
      return {
        label: "Project-wide health not available for this role",
        class: "op-restricted",
        icon: "🔒",
        reason: "Operational status requires full project task dataset.",
      };
    }
    if (project.status === "completed") {
      return { label: "Completed", class: "op-completed", icon: "✓", reason: "Deliverable marked complete" };
    }
    if (project.status === "archived") {
      return { label: "Archived", class: "op-archived", icon: "📦", reason: "Project archived" };
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const isProjectOverdue = project.dueDate && new Date(project.dueDate) < startOfToday;
    const overdueTasks = tasks.filter((t) => t.status !== "Done" && t.dueDate && new Date(t.dueDate) < startOfToday);
    const blockedTasks = tasks.filter((t) => t.isBlocked);

    if (isProjectOverdue || overdueTasks.length > 0) {
      return {
        label: "Overdue",
        class: "op-overdue",
        icon: "⚠️",
        reason: isProjectOverdue ? "Project target date passed" : `${overdueTasks.length} task(s) overdue`,
      };
    }

    if (blockedTasks.length > 0) {
      return {
        label: "Attention Needed",
        class: "op-attention",
        icon: "⚠️",
        reason: `${blockedTasks.length} blocked task(s) halting progress`,
      };
    }

    const stalledTasks = tasks.filter(
      (t) =>
        t.status === "In Progress" &&
        t.updatedAt &&
        new Date(t.updatedAt) <= new Date(now.getTime() - 4 * 24 * 3600 * 1000)
    );
    if (stalledTasks.length > 0) {
      return {
        label: "Attention Needed",
        class: "op-attention",
        icon: "⚠️",
        reason: `${stalledTasks.length} task(s) stalled in progress (4d+)`,
      };
    }

    const unstartedHigh = tasks.filter(
      (t) => (t.priority === "critical" || t.priority === "high") && t.status === "To Do"
    );
    if (unstartedHigh.length > 0) {
      return {
        label: "Attention Needed",
        class: "op-attention",
        icon: "⚠️",
        reason: `${unstartedHigh.length} high priority task(s) not started`,
      };
    }

    return {
      label: "On Track",
      class: "op-ontrack",
      icon: "●",
      reason: "Deliverables progressing normally",
    };
  }, [project, tasks]);

  // Metrics
  const metrics = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "Done").length;
    const inProgress = tasks.filter((t) => t.status === "In Progress").length;
    const toDo = tasks.filter((t) => t.status === "To Do").length;
    const blocked = tasks.filter((t) => t.isBlocked === true).length;
    const completionPct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, inProgress, toDo, blocked, completionPct };
  }, [tasks]);

  // Smart Filter Counts
  const filterCounts = useMemo(() => {
    return {
      all: tasks.length,
      focus: tasks.filter((t) => isTaskInMyFocus(t, user)).length,
      atRisk: tasks.filter(isTaskAtRisk).length,
      blocked: tasks.filter((t) => t.isBlocked === true).length,
      criticalHigh: tasks.filter((t) => t.priority === "critical" || t.priority === "high").length,
    };
  }, [tasks, user]);

  // Dependency Signal Metrics
  const dependencySignals = useMemo(() => {
    const taskMap = new Map();
    for (const t of tasks) {
      const id = t._id?.toString() || t.id?.toString();
      if (id) taskMap.set(id, t);
    }

    let totalRelationships = 0;
    let waitingOnDependencies = 0;
    const dependentCounts = new Map();

    for (const t of tasks) {
      const prereqs = Array.isArray(t.dependsOn) ? t.dependsOn : [];
      const validPrereqs = prereqs.filter((p) => {
        const pId = p?._id?.toString() || p?.toString();
        return pId && taskMap.has(pId);
      });

      totalRelationships += validPrereqs.length;

      if (t.status !== "Done") {
        const hasUnresolvedPrereq = validPrereqs.some((p) => {
          const pId = p?._id?.toString() || p?.toString();
          const pt = taskMap.get(pId);
          return pt && pt.status !== "Done";
        });
        if (hasUnresolvedPrereq) {
          waitingOnDependencies++;
        }
      }

      for (const p of validPrereqs) {
        const pId = p?._id?.toString() || p?.toString();
        if (pId) {
          dependentCounts.set(pId, (dependentCounts.get(pId) || 0) + 1);
        }
      }
    }

    let maxFanOut = 0;
    for (const count of dependentCounts.values()) {
      if (count > maxFanOut) maxFanOut = count;
    }

    return {
      totalRelationships,
      waitingOnDependencies,
      maxFanOut,
    };
  }, [tasks]);

  // Filtered Tasks
  const filteredTasks = useMemo(() => {
    let list = tasks;
    if (smartFilter === "focus") {
      list = list.filter((t) => isTaskInMyFocus(t, user));
    } else if (smartFilter === "at-risk") {
      list = list.filter(isTaskAtRisk);
    } else if (smartFilter === "blocked") {
      list = list.filter((t) => t.isBlocked === true);
    } else if (smartFilter === "critical-high") {
      list = list.filter((t) => t.priority === "critical" || t.priority === "high");
    }
    return list;
  }, [tasks, smartFilter, user]);

  // Recent task updates (last 5 updated tasks)
  const recentUpdates = useMemo(() => {
    return [...tasks]
      .filter((t) => t.updatedAt)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 5);
  }, [tasks]);

  // Upcoming / Overdue Tasks
  const criticalWatchlist = useMemo(() => {
    return tasks
      .filter((t) => isTaskAtRisk(t) || t.isBlocked)
      .slice(0, 4);
  }, [tasks]);

  // Drawer Handler
  const handleOpenDrawer = (task) => {
    setActiveTask(task);
  };

  // Loading State
  if (loadingProject) {
    return (
      <div className="control-room-loading" aria-live="polite">
        <div className="control-room-spinner" />
        <p>Initializing Project Control Room...</p>
      </div>
    );
  }

  // Error State
  if (projectError) {
    return (
      <div className="control-room-error card" role="alert">
        <span className="control-room-error-icon">
          {projectError.status === 403 ? "🔒" : "◈"}
        </span>
        <h2>{projectError.message}</h2>
        <p>
          {projectError.status === 404
            ? "The requested project could not be located or may have been removed."
            : projectError.status === 403
            ? "You do not have permission to inspect this project workspace."
            : "An unexpected error occurred while communicating with the server."}
        </p>
        <div className="control-room-error-actions">
          <Link to="/projects" className="btn btn-primary">
            ← Back to Projects
          </Link>
          {projectError.status !== 404 && projectError.status !== 403 && (
            <button type="button" className="btn btn-secondary" onClick={fetchProject}>
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const ownerName = project.owner?.name || "Unassigned";
  const ownerInitial = ownerName.charAt(0).toUpperCase();

  // Due Date Formatting
  let dueLabel = "No due date";
  let isProjectOverdue = false;
  if (project.dueDate) {
    const d = new Date(project.dueDate);
    if (!isNaN(d.getTime())) {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      isProjectOverdue = d < startOfToday && project.status !== "completed";
      dueLabel = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
      });
      if (isProjectOverdue) {
        dueLabel = `Overdue (${dueLabel})`;
      }
    }
  }

  return (
    <div className="control-room-page fade-in">
      {/* TOP NAVIGATION / BREADCRUMB */}
      <nav className="control-room-nav" aria-label="Breadcrumb">
        <Link to="/projects" className="back-link">
          ← Back to Projects
        </Link>
        <span className="nav-separator">/</span>
        <span className="nav-current">{project.name}</span>
      </nav>

      {/* PROJECT COMMAND HEADER */}
      <header className="control-room-header card">
        <div
          className="header-accent-strip"
          style={{ backgroundColor: project.color || "#6366f1" }}
        />

        <div className="header-top-row">
          <div className="header-title-block">
            <div className="header-title-row">
              <span
                className="project-color-indicator"
                style={{ backgroundColor: project.color || "#6366f1" }}
                aria-hidden="true"
              />
              <h1 className="header-project-name">{project.name}</h1>
            </div>

            {project.description && (
              <p className="header-project-desc">{project.description}</p>
            )}
          </div>

          {/* ACTION BUTTONS (EDIT / ARCHIVE / RESTORE) */}
          <div className="header-actions">
            {canEditDelete && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary control-room-btn"
                  onClick={() => setShowEditModal(true)}
                  aria-label="Edit project metadata"
                >
                  ✎ Edit Project
                </button>
                {project.status === "archived" ? (
                  <button
                    type="button"
                    className="btn btn-primary control-room-btn"
                    onClick={handleRestoreProject}
                    disabled={isRestoring}
                    aria-label="Restore project"
                  >
                    {isRestoring ? "Restoring..." : "↺ Restore Project"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-danger control-room-btn"
                    onClick={() => setShowArchiveModal(true)}
                    aria-label="Archive project"
                  >
                    📦 Archive Project
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* STATUS & ATTRIBUTION METADATA BAR */}
        <div className="header-meta-bar">
          <div className="meta-group">
            <span className="meta-label">Status:</span>
            <span className={`project-status project-status-${project.status}`}>
              {project.status === "archived" ? "Archived" : project.status}
            </span>
          </div>

          <div className="meta-group">
            <span className="meta-label">Execution Pulse:</span>
            <span className={`op-status-badge ${opStatus.class}`} title={opStatus.reason}>
              <span className="op-status-icon">{opStatus.icon}</span>
              <span className="op-status-label">{opStatus.label}</span>
            </span>
          </div>

          <div className="meta-group">
            <span className="meta-label">Target Date:</span>
            <span className={`meta-value ${isProjectOverdue ? "text-danger" : ""}`}>
              {isProjectOverdue ? "⚠️ " : "📅 "}
              {dueLabel}
            </span>
          </div>

          <div className="meta-group">
            <span className="meta-label">Owner:</span>
            <div className="owner-chip-sm">
              <span className="owner-avatar-mini">{ownerInitial}</span>
              <span>{ownerName}</span>
            </div>
          </div>

          <div className="meta-group">
            <span className="meta-label">Team:</span>
            <div className="team-avatars-cluster" title={`${project.members?.length || 1} team members`}>
              {project.members?.slice(0, 4).map((m, idx) => {
                const name = m.user?.name || "Member";
                const initial = name.charAt(0).toUpperCase();
                return (
                  <span key={idx} className="cluster-avatar" title={name}>
                    {initial}
                  </span>
                );
              })}
              {project.members?.length > 4 && (
                <span className="cluster-more">+{project.members.length - 4}</span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* MEMBER SCOPE NOTICE */}
      {user?.role === "member" && (
        <div
          className="member-scope-banner card"
          role="note"
          style={{
            padding: "12px 18px",
            marginBottom: "20px",
            borderLeft: "4px solid #6366f1",
            background: "rgba(99, 102, 241, 0.08)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span style={{ fontSize: "18px" }}>ℹ️</span>
          <div>
            <strong style={{ color: "#fff" }}>My Project Tasks Scope:</strong>{" "}
            <span style={{ color: "var(--text-2, #a0a0aa)", fontSize: "13px" }}>
              Metrics below reflect only tasks assigned to or created by you. Project-wide totals and operational health are reserved for managers and admins.
            </span>
          </div>
        </div>
      )}

      {/* FLOW HEALTH V1: Project Flow Health */}
      <FlowHealthWidget
        projectId={projectId}
        user={user}
        isArchived={project.status === "archived"}
      />

      {/* EXECUTION PULSE METRICS GRID */}
      <section className="control-room-metrics-grid" aria-label="Project metrics">
        <div className="metric-card card">
          <span className="metric-label">
            {user?.role === "member" ? "My Visible Work" : "Total Deliverables"}
          </span>
          <div className="metric-value-row">
            <span className="metric-number">{metrics.total}</span>
            <span className="metric-sublabel">tasks</span>
          </div>
          <div className="metric-progress-track">
            <div
              className="metric-progress-fill"
              style={{
                width: `${metrics.completionPct}%`,
                backgroundColor: project.color || "#6366f1",
              }}
            />
          </div>
        </div>

        <div className="metric-card card">
          <span className="metric-label">
            {user?.role === "member" ? "My Completed" : "Completed"}
          </span>
          <div className="metric-value-row">
            <span className="metric-number text-success">{metrics.done}</span>
            <span className="metric-badge-pct">{metrics.completionPct}%</span>
          </div>
          <span className="metric-footnote">
            {metrics.total - metrics.done} remaining to deliver
          </span>
        </div>

        <div className="metric-card card">
          <span className="metric-label">
            {user?.role === "member" ? "My In Progress" : "In Progress"}
          </span>
          <div className="metric-value-row">
            <span className="metric-number text-purple">{metrics.inProgress}</span>
            <span className="metric-sublabel">active</span>
          </div>
          <span className="metric-footnote">Tasks currently moving</span>
        </div>

        <div className="metric-card card">
          <span className="metric-label">
            {user?.role === "member" ? "My Backlog" : "Backlog / To Do"}
          </span>
          <div className="metric-value-row">
            <span className="metric-number text-blue">{metrics.toDo}</span>
            <span className="metric-sublabel">queued</span>
          </div>
          <span className="metric-footnote">Awaiting pickup</span>
        </div>

        <div className={`metric-card card ${metrics.blocked > 0 ? "metric-card-alert" : ""}`}>
          <span className="metric-label">
            {user?.role === "member" ? "My Blocked Work" : "Blocked Work"}
          </span>
          <div className="metric-value-row">
            <span className={`metric-number ${metrics.blocked > 0 ? "text-danger" : "text-muted"}`}>
              {metrics.blocked}
            </span>
            <span className="metric-sublabel">issues</span>
          </div>
          <span className="metric-footnote">
            {metrics.blocked > 0 ? "⚠️ Requires intervention" : "✓ No active blockers"}
          </span>
        </div>
      </section>

      {/* DELIVERY TARGETS & CHECKPOINTS (RELEASES & MILESTONES) */}
      <section className="project-releases-section card" aria-label="Project delivery targets and milestones">
        <div className="section-head-bar">
          <div className="section-head-title">
            <div className="section-icon-badge">🎯</div>
            <div>
              <h2 className="section-title">Delivery Targets & Checkpoints</h2>
              <p className="section-subtitle">
                Track ship targets, milestone completion gates, and delivery readiness for this project.
              </p>
            </div>
          </div>
          <div className="section-actions">
            {(isAdmin || isManager) && (
              <Link to="/releases" className="btn btn-secondary btn-sm">
                Open Releases Hub &rarr;
              </Link>
            )}
          </div>
        </div>

        {loadingReleases ? (
          <div className="releases-loading-subtle">
            <div className="skeleton-line" style={{ height: "40px", borderRadius: "8px" }} />
          </div>
        ) : projectReleases.length === 0 && projectMilestones.length === 0 ? (
          <div className="releases-empty-panel">
            <p className="releases-empty-text">No delivery targets or checkpoints configured for this project yet.</p>
            {(isAdmin || isManager) && (
              <Link to="/releases" className="btn btn-primary btn-sm">
                Define First Release Target
              </Link>
            )}
          </div>
        ) : (
          <div className="project-targets-grid">
            {/* RELEASES COLUMN */}
            <div className="targets-col">
              <h3 className="targets-col-title">
                Active Releases <span className="count-pill">{projectReleases.length}</span>
              </h3>
              {projectReleases.length === 0 ? (
                <div className="empty-subpanel">No active releases linked to this project.</div>
              ) : (
                <div className="releases-mini-list">
                  {projectReleases.map((rel) => {
                    const rScore = rel.readiness?.score;
                    const rLabel = rel.readiness?.label || "INSUFFICIENT DATA";
                    const isOptimal = rLabel === "OPTIMAL";
                    const isStable = rLabel === "STABLE";
                    const isAtRisk = rLabel === "AT RISK";
                    const isCritical = rLabel === "CRITICAL";

                    return (
                      <div key={rel._id} className="release-mini-card">
                        <div className="release-mini-top">
                          <div className="release-mini-title-wrap">
                            <span className="release-version-pill">{rel.version || "v1.0"}</span>
                            <span className="release-mini-name">{rel.name}</span>
                          </div>
                          <span className={`status-pill status-${rel.status}`}>{rel.status}</span>
                        </div>
                        {rel.targetDate && (
                          <div className="release-mini-date">
                            📅 Target: {new Date(rel.targetDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                          </div>
                        )}
                        <div className="release-readiness-row">
                          <span className="readiness-label-tag">Readiness:</span>
                          <span
                            className={`readiness-pill ${
                              isOptimal
                                ? "readiness-optimal"
                                : isStable
                                ? "readiness-stable"
                                : isAtRisk
                                ? "readiness-at-risk"
                                : isCritical
                                ? "readiness-critical"
                                : "readiness-insufficient"
                            }`}
                          >
                            {rScore != null ? `${rScore}% · ${rLabel}` : rLabel}
                          </span>
                        </div>
                        {rel.readiness && (
                          <div className="release-mini-metrics">
                            <span>Tasks: {rel.readiness.completedTasks}/{rel.readiness.totalTasks}</span>
                            <span>Milestones: {rel.readiness.completedMilestones}/{rel.readiness.totalMilestones}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* MILESTONES COLUMN */}
            <div className="targets-col">
              <h3 className="targets-col-title">
                Milestone Checkpoints <span className="count-pill">{projectMilestones.length}</span>
              </h3>
              {projectMilestones.length === 0 ? (
                <div className="empty-subpanel">No milestones defined for this project.</div>
              ) : (
                <div className="milestones-mini-list">
                  {projectMilestones.map((ms) => (
                    <div key={ms._id} className="milestone-mini-card">
                      <div className="milestone-mini-top">
                        <div className="milestone-seq-title">
                          <span className="milestone-seq-badge">#{ms.sequence || 1}</span>
                          <span className="milestone-mini-title">{ms.title}</span>
                        </div>
                        <span className={`status-pill status-${ms.status}`}>{ms.status}</span>
                      </div>
                      {ms.dueDate && (
                        <div className="milestone-mini-date">
                          🏁 Due: {new Date(ms.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* DIRECTED DEPENDENCY INTELLIGENCE / EXECUTION GRAPH */}
      <section className="card execution-graph-summary-card" style={{ marginBottom: "24px", padding: "20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "10px",
                background: "rgba(124, 106, 255, 0.15)",
                color: "var(--accent, #7c6aff)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="12" r="3" />
                <line x1="8.5" y1="7.5" x2="15.5" y2="10.5" />
                <line x1="8.5" y1="16.5" x2="15.5" y2="13.5" />
              </svg>
            </div>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "#fff" }}>
                Directed Task Dependency Graph
              </h2>
              <p style={{ fontSize: "13px", color: "var(--text-2, #a0a0aa)", margin: "3px 0 0" }}>
                Map prerequisites, detect blocker propagation, and see topological execution paths for this project.
              </p>
            </div>
          </div>

          <Link
            to={`/execution-graph?project=${projectId}`}
            className="btn btn-primary"
            style={{ display: "flex", alignItems: "center", gap: "8px", textDecoration: "none" }}
          >
            <span>Open Execution Graph</span>
            <span>&rarr;</span>
          </Link>
        </div>

        {/* COMPACT DEPENDENCY & DELIVERY INTELLIGENCE SIGNAL METRICS */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "12px",
            marginTop: "16px",
            paddingTop: "16px",
            borderTop: "1px solid rgba(255, 255, 255, 0.07)",
          }}
        >
          <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "10px 14px", borderRadius: "8px" }}>
            <span style={{ fontSize: "11px", color: "var(--text-2, #a0a0aa)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block" }}>
              Delivery Forecast
            </span>
            <span
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color:
                  deliveryIntel?.forecast?.status === "on_track"
                    ? "#34d399"
                    : deliveryIntel?.forecast?.status === "slipping"
                    ? "#f87171"
                    : deliveryIntel?.forecast?.status === "at_risk"
                    ? "#fbbf24"
                    : "#a5b4fc",
                marginTop: "2px",
                display: "block",
                textTransform: "uppercase",
              }}
            >
              {deliveryIntel?.forecast?.status === "indeterminate"
                ? (deliveryIntel?.forecast?.drivers?.some((d) => d.type === "critical_blocker")
                    ? "Blocked · ETA Required"
                    : "INDETERMINATE")
                : deliveryIntel?.forecast?.status
                ? deliveryIntel.forecast.status.replace(/_/g, " ")
                : "ON TRACK"}
            </span>
            <span style={{ fontSize: "11px", color: "var(--text-3, #606068)" }}>
              {deliveryIntel?.forecast?.slipDays > 0 ? `+${deliveryIntel.forecast.slipDays}d slip` : "0d slip predicted"}
            </span>
          </div>

          <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "10px 14px", borderRadius: "8px" }}>
            <span style={{ fontSize: "11px", color: "var(--text-2, #a0a0aa)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block" }}>
              Critical Path
            </span>
            <span style={{ fontSize: "16px", fontWeight: 700, color: "#fbbf24", marginTop: "2px", display: "block" }}>
              {deliveryIntel?.criticalPath?.length || 0} tasks
            </span>
            <span style={{ fontSize: "11px", color: "var(--text-3, #606068)" }}>
              {deliveryIntel?.forecast?.totalRemainingDays || 0} calendar days remaining
            </span>
          </div>

          <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "10px 14px", borderRadius: "8px" }}>
            <span style={{ fontSize: "11px", color: "var(--text-2, #a0a0aa)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block" }}>
              Blocker Impact
            </span>
            <span style={{ fontSize: "16px", fontWeight: 700, color: (deliveryIntel?.summary?.blockedDirectCount || 0) > 0 ? "#f87171" : "#10b981", marginTop: "2px", display: "block" }}>
              {deliveryIntel?.summary?.blockedDirectCount || 0} direct / {deliveryIntel?.summary?.blockedPropagatedCount || 0} affected
            </span>
            <span style={{ fontSize: "11px", color: "var(--text-3, #606068)" }}>propagated bottlenecks</span>
          </div>

          <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "10px 14px", borderRadius: "8px" }}>
            <span style={{ fontSize: "11px", color: "var(--text-2, #a0a0aa)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block" }}>
              Relationships
            </span>
            <span style={{ fontSize: "16px", fontWeight: 700, color: "#fff", marginTop: "2px", display: "block" }}>
              {dependencySignals.totalRelationships} edges
            </span>
            <span style={{ fontSize: "11px", color: "var(--text-3, #606068)" }}>
              {dependencySignals.waitingOnDependencies} waiting tasks
            </span>
          </div>
        </div>
      </section>

      {/* ENGINEERING DECISIONS & ADRs */}
      <section className="card project-decisions-section" style={{ marginBottom: "24px", padding: "20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px", marginBottom: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "10px",
                background: "rgba(99, 102, 241, 0.15)",
                color: "#818cf8",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "20px",
                flexShrink: 0,
              }}
            >
              ⚖
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "#fff" }}>
                  Engineering Decisions & ADRs
                </h2>
                <span className="count-pill">{projectDecisions.length}</span>
              </div>
              <p style={{ fontSize: "13px", color: "var(--text-2, #a0a0aa)", margin: "3px 0 0" }}>
                Architectural Decision Records with deterministic delivery impact analysis for this project.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            {project.status !== "archived" && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowProposeDecisionModal(true)}
              >
                + Propose Decision
              </button>
            )}
            <Link to={`/decisions?project=${projectId}`} className="btn btn-primary btn-sm">
              Open Decisions Hub &rarr;
            </Link>
          </div>
        </div>

        {loadingDecisions ? (
          <div style={{ color: "var(--text-3, #606068)", fontSize: "13px" }}>Loading architectural decisions...</div>
        ) : projectDecisions.length === 0 ? (
          <div style={{ padding: "16px", background: "rgba(255,255,255,0.02)", borderRadius: "8px", color: "var(--text-2, #a0a0aa)", fontSize: "13px" }}>
            No Architectural Decision Records recorded for this project yet. Propose an ADR to capture technical context, tradeoffs, and delivery impact.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
            {projectDecisions.map((dec) => (
              <div
                key={dec._id}
                onClick={() => setInspectingDecisionId(dec._id)}
                style={{
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                  borderRadius: "8px",
                  padding: "12px 14px",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  transition: "background 0.15s, border-color 0.15s",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "11px", color: "#a5b4fc" }}>
                    ADR-{dec._id.slice(-4).toUpperCase()}
                  </span>
                  <span className={`status-pill status-${dec.status}`} style={{ fontSize: "10px", padding: "2px 6px" }}>
                    {dec.status}
                  </span>
                </div>
                <strong style={{ fontSize: "13px", color: "#fff", lineHeight: 1.3 }}>{dec.title}</strong>
                <span style={{ fontSize: "11px", color: "var(--text-3, #606068)" }}>
                  {dec.linkedTasks?.length || 0} tasks linked • By {dec.proposedBy?.name || "Member"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* SECTION: TEAM CAPACITY & OWNERSHIP RISK INTELLIGENCE */}
      <section className="card" style={{ marginBottom: "24px", padding: "20px" }} aria-label="Team capacity & ownership intelligence">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: "600", color: "#fff", margin: 0 }}>
              Team Capacity & Ownership
            </h3>
            <span style={{ fontSize: "11px", background: "rgba(99, 102, 241, 0.15)", color: "#a5b4fc", padding: "2px 8px", borderRadius: "9999px", fontWeight: "600" }}>
              Phase 6
            </span>
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate(`/team-capacity?project=${projectId}`)}
            style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}
          >
            Open Capacity Workbench →
          </button>
        </div>

        {loadingCapacity ? (
          <div style={{ color: "var(--text-3, #606068)", fontSize: "13px" }}>Loading team capacity intelligence...</div>
        ) : capacityIntel?.scope === "personal" ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "rgba(255, 255, 255, 0.02)", borderRadius: "8px", flexWrap: "wrap", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ fontSize: "13px", color: "#fff" }}>
                <strong>Personal Scope:</strong> Your 14-day allocated capacity is {capacityIntel.personal?.availableCapacityDays != null ? `${capacityIntel.personal.availableCapacityDays}d` : "Unconfigured"}.
              </span>
              <span className={`status-badge badge-${capacityIntel.personal?.loadStatus || "unconfigured"}`} style={{ fontSize: "11px" }}>
                {capacityIntel.personal?.loadStatus?.replace("_", " ") || "Unconfigured"}
              </span>
            </div>
            <span style={{ fontSize: "12px", color: "#93c5fd" }}>🔒 Additional project capacity data restricted</span>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }}>
            <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "12px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.06)" }}>
              <span style={{ fontSize: "11px", color: "var(--text-3, #606068)", textTransform: "uppercase" }}>Overloaded</span>
              <div style={{ fontSize: "20px", fontWeight: "700", color: (capacityIntel?.summary?.overloadedMembers || 0) > 0 ? "#f87171" : "#34d399", marginTop: "4px" }}>
                {capacityIntel?.summary?.overloadedMembers || 0}
              </div>
            </div>
            <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "12px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.06)" }}>
              <span style={{ fontSize: "11px", color: "var(--text-3, #606068)", textTransform: "uppercase" }}>WIP Limit Pressure</span>
              <div style={{ fontSize: "20px", fontWeight: "700", color: (capacityIntel?.summary?.membersAtOrOverWipLimit || 0) > 0 ? "#fbbf24" : "#fff", marginTop: "4px" }}>
                {capacityIntel?.summary?.membersAtOrOverWipLimit || 0}
              </div>
            </div>
            <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "12px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.06)" }}>
              <span style={{ fontSize: "11px", color: "var(--text-3, #606068)", textTransform: "uppercase" }}>Unassigned Work</span>
              <div style={{ fontSize: "20px", fontWeight: "700", color: (capacityIntel?.summary?.unassignedCommittedTasks || 0) > 0 ? "#fbbf24" : "#fff", marginTop: "4px" }}>
                {capacityIntel?.summary?.unassignedCommittedTasks || 0}
              </div>
            </div>
            <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "12px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.06)" }}>
              <span style={{ fontSize: "11px", color: "var(--text-3, #606068)", textTransform: "uppercase" }}>Ownership Risks</span>
              <div style={{ fontSize: "20px", fontWeight: "700", color: (capacityIntel?.riskDrivers?.length || 0) > 0 ? "#f87171" : "#34d399", marginTop: "4px" }}>
                {capacityIntel?.riskDrivers?.length || 0}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* TWO-COLUMN WORKSPACE: TASKS (LEFT) & AT-RISK WATCHLIST / ACTIVITY (RIGHT) */}
      <div className="control-room-workspace-layout">
        {/* LEFT / MAIN COLUMN: PROJECT TASKS */}
        <section className="control-room-tasks-section" aria-label="Project tasks workspace">
          {/* TOOLBAR */}
          <div className="control-room-tasks-header">
            <div className="tasks-header-title">
              <h2>{user?.role === "member" ? "My Visible Tasks" : "Project Tasks"}</h2>
              <span className="task-count-pill">{filteredTasks.length}</span>
            </div>

            <div className="tasks-header-controls">
              {/* VIEW SWITCHER */}
              <div className="view-toggle-group" role="radiogroup" aria-label="Task layout view">
                <button
                  type="button"
                  className={`view-btn ${view === "kanban" ? "active" : ""}`}
                  onClick={() => setView("kanban")}
                  aria-label="Kanban board view"
                >
                  ▦ Board
                </button>
                <button
                  type="button"
                  className={`view-btn ${view === "list" ? "active" : ""}`}
                  onClick={() => setView("list")}
                  aria-label="List view"
                >
                  ☰ List
                </button>
                <Link
                  to={`/activity?project=${projectId}`}
                  className="view-btn"
                  title="View full project activity ledger"
                  style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  ◷ Activity
                </Link>
              </div>
            </div>
          </div>

          {/* SMART EXECUTION FILTERS */}
          <div className="smart-filters-bar" role="toolbar" aria-label="Execution filters">
            <button
              type="button"
              className={`smart-filter-btn ${smartFilter === "all" ? "active" : ""}`}
              onClick={() => setSmartFilter("all")}
            >
              <span>All Tasks</span>
              <span className="smart-filter-badge">{filterCounts.all}</span>
            </button>

            <button
              type="button"
              className={`smart-filter-btn ${smartFilter === "focus" ? "active" : ""}`}
              onClick={() => setSmartFilter("focus")}
            >
              <span>🎯 My Focus</span>
              <span className="smart-filter-badge">{filterCounts.focus}</span>
            </button>

            <button
              type="button"
              className={`smart-filter-btn ${smartFilter === "at-risk" ? "active" : ""}`}
              onClick={() => setSmartFilter("at-risk")}
            >
              <span>⚠️ At Risk</span>
              <span className="smart-filter-badge">{filterCounts.atRisk}</span>
            </button>

            <button
              type="button"
              className={`smart-filter-btn ${smartFilter === "blocked" ? "active" : ""}`}
              onClick={() => setSmartFilter("blocked")}
            >
              <span>🚫 Blocked</span>
              <span className="smart-filter-badge">{filterCounts.blocked}</span>
            </button>

            <button
              type="button"
              className={`smart-filter-btn ${smartFilter === "critical-high" ? "active" : ""}`}
              onClick={() => setSmartFilter("critical-high")}
            >
              <span>🔥 Critical / High</span>
              <span className="smart-filter-badge">{filterCounts.criticalHigh}</span>
            </button>
          </div>

          {/* TASK VIEW: KANBAN OR LIST */}
          {loadingTasks ? (
            <div className="control-room-loading" style={{ padding: "40px 0" }}>
              <div className="control-room-spinner" />
              <p>Loading project tasks...</p>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="control-room-empty-tasks card">
              <p>No tasks found for this filter in {project.name}.</p>
            </div>
          ) : view === "kanban" ? (
            <div className="project-kanban-board">
              {COLUMNS.map((col) => {
                const colTasks = filteredTasks.filter((t) => t.status === col.key);

                return (
                  <div key={col.key} className="project-kanban-col card">
                    <div className="kanban-col-head">
                      <div className="col-title-left">
                        <span className="col-icon">{col.icon}</span>
                        <span className="col-title-text">{col.label}</span>
                      </div>
                      <span className="col-count-badge">{colTasks.length}</span>
                    </div>

                    <div className="kanban-col-task-list">
                      {colTasks.length === 0 ? (
                        <p className="col-empty-text">No tasks</p>
                      ) : (
                        colTasks.map((task) => {
                          const dueInfo = getDueDateInfo(task.dueDate, task.status);
                          const primaryRisk = getPrimaryRiskReason(task);
                          const assigneeInitial = task.assignedTo?.name
                            ? task.assignedTo.name.charAt(0).toUpperCase()
                            : null;

                          return (
                            <article
                              key={task._id}
                              className="task-card"
                              tabIndex={0}
                              role="button"
                              aria-label={`Task: ${task.title}`}
                              onClick={() => handleOpenDrawer(task)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  handleOpenDrawer(task);
                                }
                              }}
                            >
                              {task.isBlocked && (
                                <div className="task-card-blocker">
                                  <strong>🚫 Blocked:</strong>
                                  <span>{task.blockedReason || "Work is blocked"}</span>
                                </div>
                              )}

                              {primaryRisk && (
                                <div className="task-card-risk-banner">
                                  <span>⚠️ {primaryRisk}</span>
                                </div>
                              )}

                              <h3 className="task-card-title">{task.title}</h3>
                              <GitHubEvidenceBadge task={task} />

                              {task.description && (
                                <p className="task-card-snippet">{task.description}</p>
                              )}

                              <div className="task-card-meta">
                                <div className="task-meta-left">
                                  <span className={`badge badge-${task.priority}`}>
                                    {task.priority}
                                  </span>
                                </div>

                                <div className="task-meta-right">
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

                                  {task.comments?.length > 0 && (
                                    <span className="task-card-comment-count">
                                      💬 {task.comments.length}
                                    </span>
                                  )}

                                  {assigneeInitial && (
                                    <span className="mini-avatar" title={task.assignedTo?.name}>
                                      {assigneeInitial}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </article>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* LIST VIEW */
            <div className="task-list-view card">
              {filteredTasks.map((task) => {
                const dueInfo = getDueDateInfo(task.dueDate, task.status);
                const primaryRisk = getPrimaryRiskReason(task);

                return (
                  <div
                    key={task._id}
                    className="task-list-row"
                    tabIndex={0}
                    role="button"
                    aria-label={`Task: ${task.title}`}
                    onClick={() => handleOpenDrawer(task)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleOpenDrawer(task);
                      }
                    }}
                  >
                    <div className="tlr-left">
                      {task.isBlocked && (
                        <span className="risk-tag risk-tag-overdue" title={task.blockedReason}>
                          🚫 Blocked
                        </span>
                      )}

                      {primaryRisk && (
                        <span className="risk-tag risk-tag-atrisk" title={`At Risk: ${primaryRisk}`}>
                          ⚠️ {primaryRisk}
                        </span>
                      )}

                      <span className={`badge badge-${task.priority}`}>{task.priority}</span>
                      <span className={`badge badge-${task.status}`}>{task.status}</span>
                      <span className="tlr-title">{task.title}</span>
                      <GitHubEvidenceBadge task={task} />
                    </div>

                    <div className="tlr-right">
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
                      {task.assignedTo?.name && (
                        <span className="tlr-assignee">{task.assignedTo.name}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* RIGHT / SIDEBAR COLUMN: RISK WATCHLIST & RECENT UPDATES */}
        <aside className="control-room-side-column" aria-label="Project intelligence panels">
          {/* SECTION: ATTENTION WATCHLIST */}
          <div className="side-panel card">
            <div className="side-panel-header">
              <h3>Execution Watchlist</h3>
              <span className="side-panel-count">{criticalWatchlist.length}</span>
            </div>

            {criticalWatchlist.length === 0 ? (
              <p className="side-panel-empty">
                ✓ All deliverables are progressing normally with no active blockers or critical risks.
              </p>
            ) : (
              <div className="watchlist-items">
                {criticalWatchlist.map((task) => {
                  const risk = getPrimaryRiskReason(task);
                  return (
                    <div
                      key={task._id}
                      className="watchlist-item"
                      onClick={() => handleOpenDrawer(task)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="watchlist-item-top">
                        <span className="watchlist-item-title">{task.title}</span>
                        <span className={`badge badge-${task.priority}`}>{task.priority}</span>
                      </div>
                      <div className="watchlist-item-reasons">
                        {task.isBlocked && (
                          <span className="watchlist-tag-blocked">🚫 {task.blockedReason || "Blocked"}</span>
                        )}
                        {risk && (
                          <span className="watchlist-tag-risk">⚠️ {risk}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SECTION: RECENT UPDATES (BASED ON UPDATEDAT) */}
          <div className="side-panel card">
            <div className="side-panel-header">
              <h3>Recent Task Updates</h3>
            </div>

            {recentUpdates.length === 0 ? (
              <p className="side-panel-empty">No updates recorded for this project yet.</p>
            ) : (
              <div className="recent-updates-list">
                {recentUpdates.map((task) => (
                  <div
                    key={task._id}
                    className="update-item"
                    onClick={() => handleOpenDrawer(task)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="update-item-left">
                      <span className="update-title">{task.title}</span>
                      <div className="update-meta">
                        <span className={`badge badge-${task.status}`}>{task.status}</span>
                        <span className="update-time">{formatRelativeTime(task.updatedAt)}</span>
                      </div>
                    </div>
                    {task.assignedTo?.name && (
                      <span className="update-assignee" title={task.assignedTo.name}>
                        {task.assignedTo.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* TASK DETAIL DRAWER */}
      <TaskDrawer
        task={activeTask}
        onClose={() => setActiveTask(null)}
        onUpdateTask={async (taskId, updates) => {
          const updated = await updateTask(taskId, updates);
          setActiveTask(updated);
          return updated;
        }}
        onAddComment={async (taskId, text) => {
          const comments = await addComment(taskId, text);
          setActiveTask((prev) => (prev ? { ...prev, comments } : null));
          return comments;
        }}
        onDeleteTask={
          canEditDelete
            ? async (taskId) => {
                await deleteTask(taskId);
                setActiveTask(null);
              }
            : undefined
        }
        canDelete={canEditDelete}
      />

      {/* EDIT PROJECT MODAL */}
      {showEditModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowEditModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-project-modal-title"
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="edit-project-modal-title">Edit Project</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowEditModal(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="create-project-form">
              <div className="form-group">
                <label htmlFor="edit-pname" className="form-label">Project Name *</label>
                <input
                  id="edit-pname"
                  type="text"
                  className="form-input"
                  maxLength={80}
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="edit-pdesc" className="form-label">Description</label>
                <textarea
                  id="edit-pdesc"
                  className="form-input form-textarea"
                  maxLength={500}
                  rows={3}
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                />
              </div>

              <div className="form-row-two">
                <div className="form-group">
                  <label htmlFor="edit-pstatus" className="form-label">Project Status</label>
                  <select
                    id="edit-pstatus"
                    className="form-input"
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="on-hold">On Hold</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="edit-pdue" className="form-label">Due Date</label>
                  <input
                    id="edit-pdue"
                    type="date"
                    className="form-input"
                    value={editForm.dueDate}
                    onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })}
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
                      className={`color-swatch-btn ${editForm.color === color ? "selected" : ""}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setEditForm({ ...editForm, color })}
                      aria-label={`Select color ${color}`}
                      aria-checked={editForm.color === color}
                      role="radio"
                    />
                  ))}
                </div>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowEditModal(false)}
                  disabled={isUpdating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isUpdating || !editForm.name.trim()}
                >
                  {isUpdating ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ARCHIVE PROJECT CONFIRMATION MODAL */}
      {showArchiveModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowArchiveModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-modal-title"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "500px" }}
          >
            <div className="modal-header">
              <h2 id="archive-modal-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span>📦</span> Archive Project
              </h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowArchiveModal(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ color: "var(--text-2, #a0a0aa)", fontSize: "14px", lineHeight: "1.6", padding: "16px 0" }}>
              <p>
                Are you sure you want to archive <strong>"{project?.name}"</strong>?
              </p>
              <div
                style={{
                  marginTop: "12px",
                  padding: "12px 14px",
                  background: "rgba(99, 102, 241, 0.08)",
                  borderRadius: "8px",
                  borderLeft: "3px solid #6366f1",
                  color: "#f4f4f6",
                  fontSize: "13px",
                }}
              >
                ✓ <strong>All linked tasks, comments, and project history are preserved.</strong> Nothing will be deleted.
              </div>
              <p style={{ marginTop: "12px", fontSize: "13px" }}>
                The project will be excluded from the default Active project view. You can view or restore it at any time using the "Archived" status filter.
              </p>
            </div>

            <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowArchiveModal(false)}
                disabled={isArchiving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleArchiveProject}
                disabled={isArchiving}
              >
                {isArchiving ? "Archiving..." : "Archive Project"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Decision Inspect Drawer */}
      {inspectingDecisionId && (
        <DecisionDrawer
          decisionId={inspectingDecisionId}
          onClose={() => setInspectingDecisionId(null)}
          onDecisionUpdated={() => fetchProjectDecisions()}
        />
      )}

      {/* Propose Decision Modal */}
      {showProposeDecisionModal && (
        <DecisionModal
          isOpen={showProposeDecisionModal}
          projects={project ? [project] : []}
          defaultProjectId={projectId}
          onClose={() => setShowProposeDecisionModal(false)}
          onSaved={() => fetchProjectDecisions()}
        />
      )}
    </div>
  );
}
