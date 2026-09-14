import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import api from "../../utils/api";

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await api.get("/projects");

      setProjects(
        Array.isArray(res.data)
          ? res.data
          : res.data.projects || [],
      );
    } catch (err) {
      console.log(err);
    } finally {
      setLoading(false);
    }
  };

  const createSampleProject = async () => {
    try {
      await api.post("/projects", {
        name: "TaskFlow Web App",
        description: "Main productivity platform",
        color: "#8b5cf6",
      });

      fetchProjects();
    } catch (err) {
      console.log(err);
    }
  };

  if (loading) {
    return (
      <div
        style={{
          color: "white",
          padding: "30px",
          fontSize: "20px",
        }}
      >
        Loading...
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "30px",
        color: "white",
      }}
    >
      <h1
        style={{ fontSize: "40px", marginBottom: "10px" }}
      >
        Dashboard
      </h1>

      <button
        onClick={createSampleProject}
        style={{
          padding: "12px 18px",
          background: "#8b5cf6",
          border: "none",
          borderRadius: "10px",
          color: "white",
          cursor: "pointer",
          marginBottom: "30px",
          fontSize: "16px",
        }}
      >
        Create Sample Project
      </button>

      <h2 style={{ marginBottom: "20px" }}>
        Projects ({projects.length})
      </h2>

      {projects.length === 0 ? (
        <div>No projects yet.</div>
      ) : (
        <div
          style={{
            display: "grid",
            gap: "20px",
          }}
        >
          {projects.map((project) => (
            <div
              key={project._id}
              style={{
                background: "#111827",
                padding: "20px",
                borderRadius: "12px",
                border: "1px solid #374151",
              }}
            >
              <h3>{project.name}</h3>

              <p
                style={{
                  color: "#9ca3af",
                  marginTop: "10px",
                }}
              >
                {project.description}
              </p>

              <Link
                to={`/projects/${project._id}`}
                style={{
                  color: "#8b5cf6",
                  marginTop: "15px",
                  display: "inline-block",
                }}
              >
                Open Project →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
