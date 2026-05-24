import React, {
  useEffect,
  useState,
  useCallback,
} from "react";
import api from "../../utils/api";
import { useSocket } from "../../context/SocketContext";
import TaskCard from "./TaskCard";
import TaskModal from "./TaskModal";
import toast from "react-hot-toast";
import "./Tasks.css";

const COLUMNS = [
  { id: "To Do", label: "To Do", icon: "○" },
  { id: "In Progress", label: "In Progress", icon: "◑" },
  { id: "Review", label: "Review", icon: "◐" },
  { id: "Done", label: "Done", icon: "●" },
];

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [filterProject, setFilterProject] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const socket = useSocket();

  const fetchTasks = useCallback(async () => {
    try {
      const params = {};
      if (filterProject) params.project = filterProject;
      if (filterPriority) params.priority = filterPriority;
      const { data } = await api.get("/tasks", { params });

      setTasks(
        Array.isArray(data) ? data : data.tasks || [],
      );
    } catch (err) {
      toast.error("Failed to load tasks");
    }
  }, [filterProject, filterPriority]);
  useEffect(() => {
    Promise.all([fetchTasks(), api.get("/projects")])
      .then(([, projectRes]) => {
        setProjects(
          Array.isArray(projectRes.data)
            ? projectRes.data
            : projectRes.data.projects || [],
        );
      })
      .finally(() => setLoading(false));
  }, [fetchTasks]);

  useEffect(() => {
    if (!socket) return;
    socket.on("task_created", (task) =>
      setTasks((prev) => [task, ...prev]),
    );
    socket.on("task_updated", (task) =>
      setTasks((prev) =>
        prev.map((t) => (t._id === task._id ? task : t)),
      ),
    );
    socket.on("task_deleted", (id) =>
      setTasks((prev) => prev.filter((t) => t._id !== id)),
    );
    return () => {
      socket.off("task_created");
      socket.off("task_updated");
      socket.off("task_deleted");
    };
  }, [socket]);

  const handleStatusChange = async (taskId, newStatus) => {
    try {
      await api.put(`/tasks/${taskId}`, {
        status: newStatus,
      });
    } catch {
      toast.error("Failed to update status");
    }
  };

  const handleDelete = async (taskId) => {
    if (!window.confirm("Delete this task?")) return;
    try {
      await api.delete(`/tasks/${taskId}`);
      toast.success("Task deleted");
    } catch {
      toast.error("Failed to delete");
    }
  };

  const getColumnTasks = (status) =>
    tasks.filter((t) => t.status === status);

  if (loading)
    return (
      <div className="loading-state">
        <div className="spinner" />
      </div>
    );

  return (
    <div className="tasks-page">
      <div className="tasks-header">
        <div>
          <h1>Task Board</h1>
          <p className="tasks-sub">
            {tasks.length} tasks across all projects
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setEditTask(null);
            setShowModal(true);
          }}
        >
          + New Task
        </button>
      </div>

      <div className="tasks-filters">
        <select
          value={filterProject}
          onChange={(e) => setFilterProject(e.target.value)}
          style={{ maxWidth: 200 }}
        >
          <option value="">All Projects</option>
          {projects.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={filterPriority}
          onChange={(e) =>
            setFilterPriority(e.target.value)
          }
          style={{ maxWidth: 160 }}
        >
          <option value="">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      <div className="kanban-board">
        {COLUMNS.map((col) => (
          <div key={col.id} className="kanban-column">
            <div className="kanban-col-header">
              <span className={`col-icon col-${col.id}`}>
                {col.icon}
              </span>
              <span className="col-label">{col.label}</span>
              <span className="col-count">
                {getColumnTasks(col.id).length}
              </span>
            </div>
            <div className="kanban-cards">
              {getColumnTasks(col.id).map((task) => (
                <TaskCard
                  key={task._id}
                  task={task}
                  onEdit={() => {
                    setEditTask(task);
                    setShowModal(true);
                  }}
                  onDelete={() => handleDelete(task._id)}
                  onStatusChange={handleStatusChange}
                  columns={COLUMNS}
                />
              ))}
              {getColumnTasks(col.id).length === 0 && (
                <div className="kanban-empty">
                  No tasks here
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <TaskModal
          task={editTask}
          projects={projects}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            fetchTasks();
          }}
        />
      )}
    </div>
  );
}
