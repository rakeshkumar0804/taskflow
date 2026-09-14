import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import "./Sidebar.css";

const ReleaseIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-3.05 11a22.35 22.35 0 0 1-3.95 2z" />
  </svg>
);

const GraphIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="12" r="3" />
    <line x1="8.5" y1="7.5" x2="15.5" y2="10.5" />
    <line x1="8.5" y1="16.5" x2="15.5" y2="13.5" />
  </svg>
);

const DecisionIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v3" />
    <path d="m19 14 3 3-3 3" />
    <path d="M5 14l-3 3 3 3" />
    <circle cx="12" cy="14" r="5" />
  </svg>
);

const CapacityIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const ActivityIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const navItems = [
  {
    to: "/dashboard",
    icon: "⬡",
    label: "Dashboard",
  },
  {
    to: "/tasks",
    icon: "✦",
    label: "My Tasks",
  },
  {
    to: "/projects",
    icon: "◈",
    label: "Projects",
  },
  {
    to: "/releases",
    icon: <ReleaseIcon />,
    label: "Releases",
  },
  {
    to: "/execution-graph",
    icon: <GraphIcon />,
    label: "Execution Graph",
  },
  {
    to: "/decisions",
    icon: <DecisionIcon />,
    label: "Decisions",
  },
  {
    to: "/team-capacity",
    icon: <CapacityIcon />,
    label: "Team Capacity",
  },
  {
    to: "/activity",
    icon: <ActivityIcon />,
    label: "Activity",
  },
];

const adminItems = [
  {
    to: "/users",
    icon: "◉",
    label: "Users",
  },
];

export default function Sidebar({ id = "app-sidebar", isOpen = false, onClose }) {
  const { user, logout, isAdmin, isManager } = useAuth();

  const navigate = useNavigate();

  const handleLogout = () => {
    if (onClose) onClose();
    logout();
    navigate("/login");
  };

  const handleNavClick = () => {
    if (onClose) onClose();
  };

  const roleColor = {
    admin: "var(--red)",
    manager: "var(--accent)",
    member: "var(--green)",
  };

  return (
    <aside
      id={id}
      className={`sidebar ${isOpen ? "open" : ""}`}
      aria-label="Main Navigation"
    >
      {/* LOGO & MOBILE CLOSE BUTTON */}
      <div className="sidebar-logo">
        <div
          className="sidebar-logo-brand"
          onClick={() => {
            navigate("/dashboard");
            handleNavClick();
          }}
          style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
        >
          <span className="sidebar-logo-icon">⬡</span>
          <span className="sidebar-logo-text">TaskFlow</span>
        </div>

        <button
          type="button"
          className="sidebar-close-btn"
          onClick={onClose}
          aria-label="Close navigation menu"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* NAVIGATION */}
      <nav className="sidebar-nav">
        <span className="sidebar-section-label">Main</span>

        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={handleNavClick}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? "active" : ""}`
            }
          >
            <span className="sidebar-icon">
              {item.icon}
            </span>

            {item.label}
          </NavLink>
        ))}

        {(isAdmin || isManager) && (
          <>
            <span
              className="sidebar-section-label"
              style={{ marginTop: 16 }}
            >
              Management
            </span>

            {isAdmin &&
              adminItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={handleNavClick}
                  className={({ isActive }) =>
                    `sidebar-link ${
                      isActive ? "active" : ""
                    }`
                  }
                >
                  <span className="sidebar-icon">
                    {item.icon}
                  </span>

                  {item.label}
                </NavLink>
              ))}
          </>
        )}
      </nav>

      {/* FOOTER */}
      <div className="sidebar-footer">
        {/* USER */}
        <div
          className="sidebar-user"
          onClick={() => {
            navigate("/profile");
            handleNavClick();
          }}
          style={{ cursor: "pointer" }}
        >
          <div className="sidebar-avatar">
            {user?.name ? user.name[0].toUpperCase() : "—"}
          </div>

          <div className="sidebar-user-info">
            <span className="sidebar-user-name">
              {user?.name || "—"}
            </span>

            <span
              className="sidebar-user-role"
              style={{
                color:
                  roleColor[user?.role] || "var(--accent)",
              }}
            >
              {user?.role || "—"}
            </span>
          </div>
        </div>

        {/* LOGOUT */}
        <button
          type="button"
          className="sidebar-logout"
          onClick={handleLogout}
          title="Logout"
          aria-label="Logout"
        >
          ⇥
        </button>
      </div>
    </aside>
  );
}
