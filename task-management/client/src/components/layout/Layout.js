import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import './Layout.css';

const NavItem = ({ to, icon, label }) => (
  <NavLink to={to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
    <span className="nav-icon">{icon}</span>
    <span>{label}</span>
  </NavLink>
);

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => {
    logout();
    toast.success('Logged out');
    navigate('/login');
  };

  const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <span className="sidebar-logo-icon">⬡</span>
          <span>TaskFlow</span>
        </div>

        <nav className="sidebar-nav">
          <NavItem to="/dashboard" icon="◈" label="Dashboard" />
          <NavItem to="/projects" icon="⊞" label="Projects" />
          <NavItem to="/tasks" icon="✦" label="My Tasks" />
          {(user?.role === 'admin' || user?.role === 'manager') && (
            <NavItem to="/team" icon="◎" label="Team" />
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="avatar" style={{ background: stringToColor(user?.name || '') }}>
              {initials}
            </div>
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{user?.name}</span>
              <span className="sidebar-user-role">{user?.role}</span>
            </div>
          </div>
          <button className="logout-btn" onClick={handleLogout} title="Logout">⏻</button>
        </div>
      </aside>

      <div className="main-wrapper">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}

function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}
