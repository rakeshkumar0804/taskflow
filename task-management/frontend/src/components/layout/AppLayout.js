import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Sidebar from "./Sidebar";
import "./AppLayout.css";

const getSectionName = (pathname) => {
  if (pathname.startsWith("/execution-graph")) return "Execution Graph";
  if (pathname.startsWith("/releases")) return "Releases";
  if (pathname.startsWith("/tasks")) return "My Tasks";
  if (pathname.startsWith("/projects")) return "Projects";
  if (pathname.startsWith("/users")) return "Users";
  if (pathname.startsWith("/profile")) return "Profile";
  return "Dashboard";
};

export default function AppLayout({ children }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Close mobile drawer on route navigation
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  // Close mobile drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && mobileNavOpen) {
        setMobileNavOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileNavOpen]);

  // Prevent body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileNavOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileNavOpen]);

  const currentSection = getSectionName(location.pathname);

  return (
    <div className="app-layout">
      {/* MOBILE COMPACT TOPBAR (Visible only <= 768px) */}
      <header className="mobile-topbar" role="banner">
        <div
          className="mobile-topbar-brand"
          onClick={() => navigate("/dashboard")}
          style={{ cursor: "pointer" }}
        >
          <span className="mobile-topbar-logo-icon">⬡</span>
          <span className="mobile-topbar-logo-text">TaskFlow</span>
          <span className="mobile-topbar-section">{currentSection}</span>
        </div>

        <button
          type="button"
          className="mobile-hamburger-btn"
          onClick={() => setMobileNavOpen((prev) => !prev)}
          aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={mobileNavOpen}
          aria-controls="app-sidebar"
        >
          {mobileNavOpen ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
      </header>

      {/* SEMI-TRANSPARENT BACKDROP */}
      <div
        className={`sidebar-backdrop ${mobileNavOpen ? "active" : ""}`}
        onClick={() => setMobileNavOpen(false)}
        aria-hidden="true"
      />

      {/* SIDEBAR NAVIGATION (Desktop static / Mobile off-canvas drawer) */}
      <Sidebar
        id="app-sidebar"
        isOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />

      {/* MAIN CONTENT AREA */}
      <main className="app-main">{children}</main>
    </div>
  );
}
