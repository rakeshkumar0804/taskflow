import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";

import Dashboard from "./pages/Dashboard";
import TasksPage from "./pages/TasksPage";
import AuthPage from "./pages/AuthPage";

import AppLayout from "./components/layout/AppLayout";

function ProfilePage() {
  return (
    <div
      style={{
        color: "white",
        padding: "40px",
      }}
    >
      <h1
        style={{
          fontSize: "42px",
          marginBottom: "10px",
        }}
      >
        My Profile
      </h1>

      <p
        style={{
          color: "#aaa",
          fontSize: "18px",
        }}
      >
        Welcome back, Rakesh 👋
      </p>

      <div
        style={{
          marginTop: "30px",
          background: "#12121a",
          padding: "24px",
          borderRadius: "20px",
          border: "1px solid rgba(255,255,255,0.08)",
          maxWidth: "500px",
        }}
      >
        <p>
          <strong>Name:</strong> Rakesh Kumar
        </p>

        <p style={{ marginTop: "14px" }}>
          <strong>Role:</strong> Admin
        </p>

        <p style={{ marginTop: "14px" }}>
          <strong>Email:</strong> rakesh@example.com
        </p>
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        {/* LOGIN */}
        <Route path="/login" element={<AuthPage />} />

        {/* DASHBOARD */}
        <Route
          path="/"
          element={
            <AppLayout>
              <Dashboard />
            </AppLayout>
          }
        />

        <Route
          path="/dashboard"
          element={
            <AppLayout>
              <Dashboard />
            </AppLayout>
          }
        />

        {/* TASKS */}
        <Route
          path="/tasks"
          element={
            <AppLayout>
              <TasksPage />
            </AppLayout>
          }
        />

        {/* PROFILE */}
        <Route
          path="/profile"
          element={
            <AppLayout>
              <ProfilePage />
            </AppLayout>
          }
        />

        {/* REDIRECT */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;
