import "./Projects.css";

export default function Projects() {
  const projects = [
    {
      name: "TaskFlow Web App",
      status: "Active",
      tasks: 12,
      progress: 70,
    },
    {
      name: "Portfolio Website",
      status: "Completed",
      tasks: 8,
      progress: 100,
    },
    {
      name: "Admin Dashboard",
      status: "In Progress",
      tasks: 5,
      progress: 45,
    },
  ];

  return (
    <div className="projects-page fade-in">
      <div className="projects-header">
        <div>
          <h1 className="projects-title">Projects</h1>

          <p className="projects-sub">
            Manage all your active projects
          </p>
        </div>

        <button className="btn btn-primary">
          + New Project
        </button>
      </div>

      <div className="projects-grid">
        {projects.map((project, index) => (
          <div key={index} className="project-card">
            <div className="project-top">
              <h2>{project.name}</h2>

              <span className="project-status">
                {project.status}
              </span>
            </div>

            <p>{project.tasks} Tasks</p>

            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${project.progress}%`,
                }}
              />
            </div>

            <span className="progress-text">
              {project.progress}% Completed
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
