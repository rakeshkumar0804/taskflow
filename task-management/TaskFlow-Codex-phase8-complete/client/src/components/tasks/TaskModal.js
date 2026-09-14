import React, { useState, useEffect } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";

export default function TaskModal({
  task,
  projects,
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    project: "",
    status: "To Do",
    priority: "medium",
    dueDate: "",
    tags: "",
  });
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (task) {
      setForm({
        title: task.title || "",
        description: task.description || "",
        project: task.project?._id || task.project || "",
        status: task.status || "To Do",
        priority: task.priority || "medium",
        dueDate: task.dueDate
          ? task.dueDate.slice(0, 10)
          : "",
        tags: task.tags?.join(", ") || "",
        assignedTo:
          task.assignedTo?.map((u) => u._id || u) || [],
      });
    }
  }, [task]);

  useEffect(() => {
    api.get("/users/search?q=").catch(() => {});
    // Load users for assignment
    api
      .get("/users/search?q= ")
      .then((res) => setUsers(res.data))
      .catch(() => {});
  }, []);

  const toggleAssign = (userId) => {
    setForm((prev) => ({
      ...prev,
      assignedTo: prev.assignedTo.includes(userId)
        ? prev.assignedTo.filter((id) => id !== userId)
        : [...prev.assignedTo, userId],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        ...form,
        tags: form.tags
          ? form.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        dueDate: form.dueDate || undefined,
      };
      if (task) {
        await api.put(`/tasks/${task._id}`, payload);
        toast.success("Task updated");
      } else {
        await api.post("/tasks", payload);
        toast.success("Task created");
      }
      onSaved();
    } catch (err) {
      toast.error(
        err.response?.data?.message ||
          "Failed to save task",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{task ? "Edit Task" : "New Task"}</h2>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Title *</label>
            <input
              value={form.title}
              onChange={(e) =>
                setForm({ ...form, title: e.target.value })
              }
              placeholder="What needs to be done?"
              required
            />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm({
                  ...form,
                  description: e.target.value,
                })
              }
              rows={3}
              placeholder="Add more details..."
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Project *</label>
              <select
                value={form.project}
                onChange={(e) =>
                  setForm({
                    ...form,
                    project: e.target.value,
                  })
                }
                required
              >
                <option value="">Select project</option>
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Priority</label>
              <select
                value={form.priority}
                onChange={(e) =>
                  setForm({
                    ...form,
                    priority: e.target.value,
                  })
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Status</label>
              <select
                value={form.status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.value,
                  })
                }
              >
                <option value="To Do">To Do</option>
                <option value="In Progress">
                  In Progress
                </option>
                <option value="Review">Review</option>
                <option value="Done">Done</option>
              </select>
            </div>
            <div className="form-group">
              <label>Due Date</label>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) =>
                  setForm({
                    ...form,
                    dueDate: e.target.value,
                  })
                }
              />
            </div>
          </div>
          <div className="form-group">
            <label>Tags (comma separated)</label>
            <input
              value={form.tags}
              onChange={(e) =>
                setForm({ ...form, tags: e.target.value })
              }
              placeholder="frontend, bug, urgent"
            />
          </div>
          {users.length > 0 && (
            <div className="form-group">
              <label>Assign To</label>
              <div className="assign-list">
                {users.map((u) => (
                  <div
                    key={u._id}
                    className={`assign-item ${form.assignedTo.includes(u._id) ? "selected" : ""}`}
                    onClick={() => toggleAssign(u._id)}
                  >
                    <div
                      className="avatar avatar-sm"
                      style={{
                        background: stringToColor(u.name),
                      }}
                    >
                      {u.name?.charAt(0).toUpperCase()}
                    </div>
                    <span>{u.name}</span>
                    {form.assignedTo.includes(u._id) && (
                      <span className="check">✓</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? (
                <span className="spinner" />
              ) : task ? (
                "Save Changes"
              ) : (
                "Create Task"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function stringToColor(str = "") {
  let hash = 0;
  for (let i = 0; i < str.length; i++)
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`;
}
