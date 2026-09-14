import {
  DragDropContext,
  Droppable,
  Draggable,
} from "react-beautiful-dnd";
import "./TasksPage.css";
import { useState, useMemo } from "react";
import { useTasks } from "../hooks/useTasks";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";
import TaskDrawer from "../components/tasks/TaskDrawer";
import GitHubEvidenceBadge from "../components/tasks/GitHubEvidenceBadge";
import {
  COLUMNS,
  getDueDateInfo,
  isTaskInMyFocus,
  getPrimaryRiskReason,
  isTaskAtRisk,
} from "../utils/taskHelpers";

export default function TasksPage() {
  const [filters, setFilters] = useState({});
  const [smartFilter, setSmartFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [view, setView] = useState("kanban");

  // Selected task for Task Drawer
  const [activeTask, setActiveTask] = useState(null);

  const {
    tasks,
    loading,
    createTask,
    updateTask,
    deleteTask,
    addComment,
  } = useTasks(filters);

  const { user, isManager } = useAuth();

  // Smart execution filter counts
  const counts = useMemo(() => {
    return {
      all: tasks.length,
      focus: tasks.filter((t) => isTaskInMyFocus(t, user)).length,
      atRisk: tasks.filter(isTaskAtRisk).length,
      blocked: tasks.filter((t) => t.isBlocked === true).length,
      criticalHigh: tasks.filter((t) => t.priority === "critical" || t.priority === "high").length,
    };
  }, [tasks, user]);

  // Composed filtered tasks
  const filteredTasks = useMemo(() => {
    let list = tasks;

    // 1. Smart filter
    if (smartFilter === "focus") {
      list = list.filter((t) => isTaskInMyFocus(t, user));
    } else if (smartFilter === "at-risk") {
      list = list.filter(isTaskAtRisk);
    } else if (smartFilter === "blocked") {
      list = list.filter((t) => t.isBlocked === true);
    } else if (smartFilter === "critical-high") {
      list = list.filter((t) => t.priority === "critical" || t.priority === "high");
    }

    // 2. Dropdown filters
    if (filters.status) {
      list = list.filter((t) => t.status === filters.status);
    }
    if (filters.priority) {
      list = list.filter((t) => t.priority === filters.priority);
    }
    if (filters.search && typeof filters.search === "string") {
      const q = filters.search.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q))
      );
    }

    return list;
  }, [tasks, smartFilter, filters, user]);

  const tasksByStatus = (status) =>
    filteredTasks.filter((t) => t.status === status);

  // Open Drawer
  const handleOpenDrawer = (task) => {
    setActiveTask(task);
  };

  const handleDelete = async (id, e) => {
    if (e) e.stopPropagation();
    try {
      await deleteTask(id);
      if (activeTask?._id === id) {
        setActiveTask(null);
      }
      toast.success("Task deleted");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to delete task");
    }
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();

    const isBlocked = e.target.isBlocked?.checked || false;
    const blockedReason = e.target.blockedReason?.value?.trim() || "";

    if (isBlocked && !blockedReason) {
      return toast.error("A reason is required when marking a task as blocked");
    }

    const formData = {
      title: e.target.title.value.trim(),
      description: e.target.description.value.trim(),
      status: e.target.status.value,
      priority: e.target.priority.value,
      dueDate: e.target.dueDate.value ? new Date(e.target.dueDate.value).toISOString() : null,
      isBlocked,
      blockedReason: isBlocked ? blockedReason : "",
    };

    try {
      await createTask(formData);
      toast.success("Task created");
      setShowModal(false);
      e.target.reset();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to create task");
    }
  };

  const handleDragEnd = async (result) => {
    if (!result.destination) return;

    const taskId = result.draggableId;
    const newStatus = result.destination.droppableId;

    const task = tasks.find((t) => t._id === taskId);
    if (!task || task.status === newStatus) return;

    try {
      await updateTask(taskId, {
        ...task,
        status: newStatus,
      });
      toast.success("Task moved");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to move task");
    }
  };

  return (
    <div className="tasks-page fade-in">
      {/* HEADER */}
      <div className="tasks-header">
        <div>
          <h1 className="page-title">Tasks Board</h1>
          <p className="page-sub">
            {filteredTasks.length} of {tasks.length} total tasks displayed
          </p>
        </div>

        <div className="tasks-actions">
          <div className="view-toggle">
            <button
              type="button"
              className={`view-btn ${view === "kanban" ? "active" : ""}`}
              onClick={() => setView("kanban")}
              aria-label="Switch to Kanban board view"
            >
              ⬡ Board
            </button>

            <button
              type="button"
              className={`view-btn ${view === "list" ? "active" : ""}`}
              onClick={() => setView("list")}
              aria-label="Switch to list view"
            >
              ≡ List
            </button>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowModal(true)}
            aria-label="Create new task"
          >
            + New Task
          </button>
        </div>
      </div>

      {/* SECTION 6: SMART EXECUTION FILTERS */}
      <div className="smart-filters" role="toolbar" aria-label="Smart Execution Filters">
        <button
          type="button"
          className={`smart-filter-btn ${smartFilter === "all" ? "active" : ""}`}
          onClick={() => setSmartFilter("all")}
          aria-label="View all tasks"
        >
          <span>All Tasks</span>
          <span className="smart-filter-badge">{counts.all}</span>
        </button>

        <button
          type="button"
          className={`smart-filter-btn ${smartFilter === "focus" ? "active" : ""}`}
          onClick={() => setSmartFilter("focus")}
          aria-label="View tasks assigned to you"
        >
          <span>✦ My Focus</span>
          <span className="smart-filter-badge">{counts.focus}</span>
        </button>

        <button
          type="button"
          className={`smart-filter-btn ${smartFilter === "at-risk" ? "active" : ""}`}
          onClick={() => setSmartFilter("at-risk")}
          aria-label="View at-risk tasks"
        >
          <span>⚠️ At Risk</span>
          <span className="smart-filter-badge">{counts.atRisk}</span>
        </button>

        <button
          type="button"
          className={`smart-filter-btn ${smartFilter === "blocked" ? "active" : ""}`}
          onClick={() => setSmartFilter("blocked")}
          aria-label="View blocked tasks"
        >
          <span>🚫 Blocked</span>
          <span className="smart-filter-badge">{counts.blocked}</span>
        </button>

        <button
          type="button"
          className={`smart-filter-btn ${smartFilter === "critical-high" ? "active" : ""}`}
          onClick={() => setSmartFilter("critical-high")}
          aria-label="View critical and high priority tasks"
        >
          <span>🔥 Critical/High</span>
          <span className="smart-filter-badge">{counts.criticalHigh}</span>
        </button>
      </div>

      {/* DROPDOWN & TEXT SEARCH FILTERS */}
      <div className="tasks-filters">
        <select
          value={filters.status || ""}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          aria-label="Filter by task status"
        >
          <option value="">All Statuses</option>
          <option value="To Do">To Do</option>
          <option value="In Progress">In Progress</option>
          <option value="Done">Done</option>
        </select>

        <select
          value={filters.priority || ""}
          onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
          aria-label="Filter by task priority"
        >
          <option value="">All Priorities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <input
          type="text"
          placeholder="Search tasks by title or description..."
          value={filters.search || ""}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          aria-label="Search tasks"
        />
      </div>

      {/* MAIN VIEW */}
      {loading ? (
        <div className="empty-state">
          <p>Loading workspace tasks...</p>
        </div>
      ) : view === "kanban" ? (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="kanban-board">
            {COLUMNS.map((col) => {
              const colTasks = tasksByStatus(col.key);

              return (
                <div key={col.key} className="kanban-col">
                  <div className="kanban-col-header">
                    <span>{col.icon}</span>
                    <span>{col.label}</span>
                    <span>{colTasks.length}</span>
                  </div>

                  <Droppable droppableId={col.key}>
                    {(provided) => (
                      <div
                        className="kanban-col-body"
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                      >
                        {colTasks.map((task, index) => {
                          const dueInfo = getDueDateInfo(task.dueDate, task.status);
                          const primaryRisk = getPrimaryRiskReason(task);
                          const assigneeInitial = task.assignedTo?.name
                            ? task.assignedTo.name.charAt(0).toUpperCase()
                            : null;

                          return (
                            <Draggable
                              draggableId={task._id}
                              index={index}
                              key={task._id}
                            >
                              {(provided) => (
                                <div
                                  className="task-card"
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  onClick={() => handleOpenDrawer(task)}
                                  tabIndex={0}
                                  role="button"
                                  aria-label={`Open details for ${task.title}`}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      handleOpenDrawer(task);
                                    }
                                  }}
                                >
                                  {/* SECTION 7: BLOCKER BANNER */}
                                  {task.isBlocked && (
                                    <div className="task-card-blocker">
                                      <strong>🚫 Blocked:</strong>
                                      <span>{task.blockedReason || "Work is blocked"}</span>
                                    </div>
                                  )}

                                  {/* AT RISK BANNER */}
                                  {primaryRisk && (
                                    <div className="task-card-risk-banner">
                                      <span>⚠️ {primaryRisk}</span>
                                    </div>
                                  )}

                                  <h3>{task.title}</h3>
                                  <GitHubEvidenceBadge task={task} />

                                  {task.description && (
                                    <p>{task.description}</p>
                                  )}

                                  {/* SECTION 7: CARD FOOTER METADATA */}
                                  <div className="task-card-meta">
                                    <div className="task-meta-left">
                                      <span className={`badge badge-${task.priority}`}>
                                        {task.priority}
                                      </span>

                                      {task.project?.name && (
                                        <span
                                          className="task-card-project"
                                          style={{
                                            borderColor: task.project.color || "rgba(255,255,255,0.1)",
                                          }}
                                        >
                                          {task.project.name}
                                        </span>
                                      )}
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
                                        <span className="task-card-comment-count" title={`${task.comments.length} comments`}>
                                          💬 {task.comments.length}
                                        </span>
                                      )}

                                      {assigneeInitial && (
                                        <span className="mini-avatar" title={task.assignedTo?.name}>
                                          {assigneeInitial}
                                        </span>
                                      )}

                                      {isManager && (
                                        <button
                                          type="button"
                                          className="icon-btn danger"
                                          onClick={(e) => handleDelete(task._id, e)}
                                          aria-label="Delete task"
                                        >
                                          ✕
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          );
                        })}

                        {provided.placeholder}

                        {colTasks.length === 0 && (
                          <div className="kanban-empty">
                            {smartFilter === "blocked"
                              ? "No blocked tasks in this column"
                              : smartFilter === "at-risk"
                              ? "No at-risk tasks here"
                              : "No tasks here"}
                          </div>
                        )}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      ) : (
        /* LIST VIEW */
        <div className="task-list-view card">
          {filteredTasks.length === 0 ? (
            <p className="empty-state">
              {smartFilter === "blocked"
                ? "No blocked tasks in this view"
                : smartFilter === "at-risk"
                ? "No at-risk tasks in this view"
                : "No tasks found"}
            </p>
          ) : (
            filteredTasks.map((task) => {
              const dueInfo = getDueDateInfo(task.dueDate, task.status);
              const primaryRisk = getPrimaryRiskReason(task);

              return (
                <div
                  key={task._id}
                  className="task-list-row"
                  onClick={() => handleOpenDrawer(task)}
                  style={{ cursor: "pointer" }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open details for ${task.title}`}
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

                    <span className={`badge badge-${task.priority}`}>
                      {task.priority}
                    </span>

                    <span className={`badge badge-${task.status}`}>
                      {task.status}
                    </span>

                    {task.project?.name && (
                      <span className="task-card-project">
                        {task.project.name}
                      </span>
                    )}

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

                    {task.comments?.length > 0 && (
                      <span className="task-card-comment-count">
                        💬 {task.comments.length}
                      </span>
                    )}

                    {isManager && (
                      <button
                        type="button"
                        className="icon-btn danger"
                        onClick={(e) => handleDelete(task._id, e)}
                        aria-label="Delete task"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* SECTION 4 & 5: TASK DETAIL DRAWER */}
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
          isManager
            ? async (taskId) => {
                await deleteTask(taskId);
                setActiveTask(null);
              }
            : undefined
        }
        canDelete={isManager}
      />

      {/* NEW TASK MODAL */}
      {showModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>New Task</h2>

            <button
              type="button"
              className="modal-close"
              onClick={() => setShowModal(false)}
              aria-label="Close modal"
            >
              ✕
            </button>

            <form onSubmit={handleCreateTask}>
              <input
                type="text"
                name="title"
                placeholder="Task title"
                required
                className="form-input"
              />

              <textarea
                name="description"
                placeholder="Description"
                className="form-input"
              />

              <select name="status" className="form-input">
                <option value="To Do">To Do</option>
                <option value="In Progress">In Progress</option>
                <option value="Done">Done</option>
              </select>

              <select name="priority" className="form-input">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>

              <input
                type="date"
                name="dueDate"
                className="form-input"
              />

              <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#fca5a5" }}>
                  <input type="checkbox" name="isBlocked" />
                  <span>Mark as blocked</span>
                </label>
                <textarea
                  name="blockedReason"
                  placeholder="Blocker reason (required if marked blocked)"
                  maxLength={300}
                  className="form-input"
                  style={{ minHeight: "60px" }}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{ marginTop: "16px" }}
              >
                Create Task
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
