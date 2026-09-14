import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../utils/api";
import { useAuth } from "../../context/AuthContext";
import toast from "react-hot-toast";
import "./Projects.css";

const COLORS = [
  "#7c6af7",
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

function ProjectModal({ project, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    color: "#7c6af7",
    dueDate: "",
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (project)
      setForm({
        name: project.name,
        description: project.description,
        color: project.color,
        dueDate: project.dueDate?.slice(0, 10) || "",
      });
  }, [project]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (project) {
        await api.put(`/projects/${project._id}`, form);
        toast.success("Project updated");
      } else {
        await api.post("/projects", form);
        toast.success("Project created");
      }
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed");
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
          <h2>
            {project ? "Edit Project" : "New Project"}
          </h2>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name *</label>
            <input
              value={form.name}
              onChange={(e) =>
                setForm({ ...form, name: e.target.value })
              }
              placeholder="Project name"
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
            />
          </div>
          <div className="form-group">
            <label>Color</label>
            <div className="color-picker">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-swatch ${form.color === c ? "active" : ""}`}
                  style={{ background: c }}
                  onClick={() =>
                    setForm({ ...form, color: c })
                  }
                />
              ))}
            </div>
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
              ) : project ? (
                "Save"
              ) : (
                "Create"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editProject, setEditProject] = useState(null);
  const { user } = useAuth();

  const fetchProjects = () => {
    api
      .get("/projects")
      .then((res) => {
        console.log(res.data);

        const data = Array.isArray(res.data)
          ? res.data
          : Array.isArray(res.data.projects)
            ? res.data.projects
            : [];

        setProjects(data);
      })
      .catch((err) => {
        console.error(err);
        toast.error("Failed to fetch projects");
        setProjects([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this project?")) return;
    try {
      await api.delete(`/projects/${id}`);
      toast.success("Project deleted");
      fetchProjects();
    } catch {
      toast.error("Failed to delete");
    }
  };

  const canManage =
    user?.role === "admin" || user?.role === "manager";

  if (loading)
    return (
      <div className="loading-state">
        <div className="spinner" />
      </div>
    );

  return (
    <div className="projects-page">
      <div className="projects-header">
        <div>
          <h1>Projects</h1>
          <p
            style={{
              color: "var(--text-2)",
              fontSize: "0.875rem",
              marginTop: 4,
            }}
          >
            {projects.length} projects
          </p>
        </div>
        {canManage && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditProject(null);
              setShowModal(true);
            }}
          >
            + New Project
          </button>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="empty-projects">
          <div className="empty-icon">⊞</div>
          <h3>No projects yet</h3>
          <p>Create your first project to get started</p>
          {canManage && (
            <button
              className="btn btn-primary"
              onClick={() => setShowModal(true)}
            >
              Create Project
            </button>
          )}
        </div>
      ) : (
        <div className="projects-grid">
          {projects.map((p) => (
            <div key={p._id} className="project-card">
              <div
                className="project-card-bar"
                style={{ background: p.color }}
              />
              <div className="project-card-body">
                <div className="project-card-top">
                  <h3>{p.name}</h3>
                  {canManage && (
                    <div className="project-card-actions">
                      <button
                        onClick={() => {
                          setEditProject(p);
                          setShowModal(true);
                        }}
                        className="card-btn"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => handleDelete(p._id)}
                        className="card-btn card-btn-danger"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
                {p.description && (
                  <p className="project-card-desc">
                    {p.description}
                  </p>
                )}
                <div className="project-card-footer">
                  <div className="project-card-members">
                    {p.members?.slice(0, 4).map((m) => (
                      <div
                        key={m.user?._id}
                        className="avatar avatar-sm"
                        title={m.user?.name}
                        style={{
                          background: stringToColor(
                            m.user?.name || "",
                          ),
                        }}
                      >
                        {m.user?.name
                          ?.charAt(0)
                          .toUpperCase()}
                      </div>
                    ))}
                    {(p.members?.length || 0) > 4 && (
                      <span className="more-members">
                        +{p.members.length - 4}
                      </span>
                    )}
                  </div>
                  <Link
                    to={`/projects/${p._id}`}
                    className="btn btn-ghost"
                    style={{
                      padding: "6px 12px",
                      fontSize: "0.8rem",
                    }}
                  >
                    Open →
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <ProjectModal
          project={editProject}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            fetchProjects();
          }}
        />
      )}
    </div>
  );
}

function stringToColor(str = "") {
  let hash = 0;
  for (let i = 0; i < str.length; i++)
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`;
}
