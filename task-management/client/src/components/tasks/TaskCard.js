import React from "react";
import { format } from "date-fns";

export default function TaskCard({
  task,
  onEdit,
  onDelete,
  onStatusChange,
  columns,
}) {
  const isOverdue =
    task.dueDate &&
    new Date(task.dueDate) < new Date() &&
    task.status !== "Done";

  return (
    <div className="task-card">
      <div className="task-card-top">
        <span className={`badge badge-${task.priority}`}>
          {task.priority}
        </span>
        <div className="task-card-actions">
          <button
            onClick={onEdit}
            className="card-btn"
            title="Edit"
          >
            ✎
          </button>
          <button
            onClick={onDelete}
            className="card-btn card-btn-danger"
            title="Delete"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="task-card-title">{task.title}</div>

      {task.description && (
        <p className="task-card-desc">
          {task.description.slice(0, 80)}
          {task.description.length > 80 ? "..." : ""}
        </p>
      )}

      {task.tags?.length > 0 && (
        <div className="task-card-tags">
          {task.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="task-card-footer">
        <div className="task-card-assignees">
          {task.assignedTo?.slice(0, 3).map((u) => (
            <div
              key={u._id}
              className="avatar avatar-sm"
              title={u.name}
              style={{ background: stringToColor(u.name) }}
            >
              {u.name?.charAt(0).toUpperCase()}
            </div>
          ))}
        </div>
        <div className="task-card-meta">
          {task.dueDate && (
            <span
              className={`due-date ${isOverdue ? "overdue" : ""}`}
            >
              {isOverdue ? "⚠ " : ""}
              {format(new Date(task.dueDate), "MMM d")}
            </span>
          )}
          <select
            value={task.status}
            onChange={(e) =>
              onStatusChange(task._id, e.target.value)
            }
            className="status-select"
            onClick={(e) => e.stopPropagation()}
          >
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
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
