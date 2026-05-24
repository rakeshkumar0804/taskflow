import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import "./Sidebar.css";

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
];

const adminItems = [
  {
    to: "/users",
    icon: "◉",
    label: "Users",
  },
];

export default function Sidebar() {
  const { user, logout, isAdmin, isManager } = useAuth();

  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const roleColor = {
    admin: "var(--red)",
    manager: "var(--accent)",
    member: "var(--green)",
  };

  return (
    <aside className="sidebar">
      {/* LOGO */}
      <div
        className="sidebar-logo"
        onClick={() => navigate("/dashboard")}
        style={{ cursor: "pointer" }}
      >
        <span className="sidebar-logo-icon">⬡</span>

        <span className="sidebar-logo-text">TaskFlow</span>
      </div>

      {/* NAVIGATION */}
      <nav className="sidebar-nav">
        <span className="sidebar-section-label">Main</span>

        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
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
          onClick={() => navigate("/profile")}
          style={{ cursor: "pointer" }}
        >
          <div className="sidebar-avatar">
            {user?.name ? user.name[0].toUpperCase() : "R"}
          </div>

          <div className="sidebar-user-info">
            <span className="sidebar-user-name">
              {user?.name || "Rakesh Kumar"}
            </span>

            <span
              className="sidebar-user-role"
              style={{
                color:
                  roleColor[user?.role] || "var(--accent)",
              }}
            >
              {user?.role || "Admin"}
            </span>
          </div>
        </div>

        {/* LOGOUT */}
        <button
          className="sidebar-logout"
          onClick={handleLogout}
          title="Logout"
        >
          ⇥
        </button>
      </div>
    </aside>
  );
}
