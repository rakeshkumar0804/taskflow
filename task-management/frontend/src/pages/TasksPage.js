import {
  DragDropContext,
  Droppable,
  Draggable,
} from "react-beautiful-dnd";

import "./TasksPage.css";
import { useState } from "react";
import { useTasks } from "../hooks/useTasks";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";

const COLUMNS = [
  { key: "To Do", label: "To Do", icon: "○" },

  {
    key: "In Progress",
    label: "In Progress",
    icon: "◉",
  },

  { key: "Done", label: "Done", icon: "✓" },
];

export default function TasksPage() {
  const [filters, setFilters] = useState({});
  const [showModal, setShowModal] = useState(false);

  const [view, setView] = useState("kanban");

  const {
    tasks,
    loading,
    createTask,
    updateTask,
    deleteTask,
  } = useTasks(filters);

  const { isManager } = useAuth();

  const tasksByStatus = (status) =>
    tasks.filter((t) => t.status === status);

  const handleDelete = async (id) => {
    try {
      await deleteTask(id);

      toast.success("Task deleted");
    } catch (err) {
      toast.error("Failed to delete task");
    }
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();

    const formData = {
      title: e.target.title.value,
      description: e.target.description.value,

      status: e.target.status.value,

      priority: e.target.priority.value,

      dueDate: e.target.dueDate.value,
    };

    try {
      await createTask(formData);

      toast.success("Task created");

      setShowModal(false);

      e.target.reset();
    } catch (err) {
      console.log(err);

      toast.error("Failed to create task");
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
      toast.error("Failed to move task");
    }
  };

  return (
    <div className="tasks-page fade-in">
      <div className="tasks-header">
        <div>
          <h1 className="page-title">Tasks Board</h1>

          <p className="page-sub">
            {tasks.length} tasks total
          </p>
        </div>

        <div className="tasks-actions">
          <div className="view-toggle">
            <button
              className={`view-btn ${
                view === "kanban" ? "active" : ""
              }`}
              onClick={() => setView("kanban")}
            >
              ⬡ Board
            </button>

            <button
              className={`view-btn ${
                view === "list" ? "active" : ""
              }`}
              onClick={() => setView("list")}
            >
              ≡ List
            </button>
          </div>

          <button
            className="btn btn-primary"
            onClick={() => setShowModal(true)}
          >
            + New Task
          </button>
        </div>
      </div>

      <div className="tasks-filters">
        <select
          value={filters.status || ""}
          onChange={(e) =>
            setFilters({
              ...filters,
              status: e.target.value,
            })
          }
        >
          <option value="">All Status</option>

          <option value="To Do">To Do</option>

          <option value="In Progress">In Progress</option>

          <option value="Done">Done</option>
        </select>

        <select
          value={filters.priority || ""}
          onChange={(e) =>
            setFilters({
              ...filters,
              priority: e.target.value,
            })
          }
        >
          <option value="">All Priorities</option>

          <option value="critical">Critical</option>

          <option value="high">High</option>

          <option value="medium">Medium</option>

          <option value="low">Low</option>
        </select>

        <input
          type="text"
          placeholder="Search tasks..."
          value={filters.search || ""}
          onChange={(e) =>
            setFilters({
              ...filters,
              search: e.target.value,
            })
          }
        />
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : view === "kanban" ? (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="kanban-board">
            {COLUMNS.map((col) => (
              <div key={col.key} className="kanban-col">
                <div className="kanban-col-header">
                  <span>{col.icon}</span>

                  <span>{col.label}</span>

                  <span>
                    {tasksByStatus(col.key).length}
                  </span>
                </div>

                <Droppable droppableId={col.key}>
                  {(provided) => (
                    <div
                      className="kanban-col-body"
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                    >
                      {tasksByStatus(col.key).map(
                        (task, index) => (
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
                              >
                                <h3>{task.title}</h3>

                                <p>{task.description}</p>

                                <div className="task-card-footer">
                                  <span
                                    className={`badge badge-${task.priority}`}
                                  >
                                    {task.priority}
                                  </span>

                                  <span
                                    className={`badge badge-${task.status}`}
                                  >
                                    {task.status}
                                  </span>
                                </div>

                                {isManager && (
                                  <button
                                    className="icon-btn danger"
                                    onClick={() =>
                                      handleDelete(task._id)
                                    }
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            )}
                          </Draggable>
                        ),
                      )}

                      {provided.placeholder}

                      {tasksByStatus(col.key).length ===
                        0 && (
                        <div className="kanban-empty">
                          No tasks here
                        </div>
                      )}
                    </div>
                  )}
                </Droppable>
              </div>
            ))}
          </div>
        </DragDropContext>
      ) : (
        <div className="task-list-view card">
          {tasks.length === 0 ? (
            <p className="empty-state">No tasks found</p>
          ) : (
            tasks.map((task) => (
              <div key={task._id} className="task-list-row">
                <div className="tlr-left">
                  <span
                    className={`badge badge-${task.priority}`}
                  >
                    {task.priority}
                  </span>

                  <span
                    className={`badge badge-${task.status}`}
                  >
                    {task.status}
                  </span>

                  <span className="tlr-title">
                    {task.title}
                  </span>
                </div>

                <div className="tlr-right">
                  {task.dueDate && (
                    <span className="task-due">
                      {new Date(
                        task.dueDate,
                      ).toLocaleDateString()}
                    </span>
                  )}

                  {isManager && (
                    <button
                      className="icon-btn danger"
                      onClick={() => handleDelete(task._id)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {showModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>New Task</h2>

            <button
              className="modal-close"
              onClick={() => setShowModal(false)}
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

                <option value="In Progress">
                  In Progress
                </option>

                <option value="Done">Done</option>
              </select>

              <select
                name="priority"
                className="form-input"
              >
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

              <button
                type="submit"
                className="btn btn-primary"
                style={{
                  marginTop: "16px",
                }}
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
