import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { Toaster } from "react-hot-toast";

import { useAuth } from "./context/AuthContext";
import Dashboard from "./pages/Dashboard";
import TasksPage from "./pages/TasksPage";
import Projects from "./pages/Projects";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import ReleasesPage from "./pages/ReleasesPage";
import ExecutionGraphPage from "./pages/ExecutionGraphPage";
import DecisionsPage from "./pages/DecisionsPage";
import TeamCapacityPage from "./pages/TeamCapacityPage";
import ActivityPage from "./pages/ActivityPage";
import AuthPage from "./pages/AuthPage";
import NotFoundPage from "./pages/NotFoundPage";
import CommandCenterPreview from "./pages/design-preview/CommandCenterPreview";

import AppLayout from "./components/layout/AppLayout";
import ProtectedRoute from "./components/auth/ProtectedRoute";

function RootRedirect() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg, #0d0d0f)",
          color: "var(--text-2, #a0a0aa)",
        }}
      >
        <div className="spinner" />
      </div>
    );
  }

  return user ? (
    <Navigate to="/dashboard" replace />
  ) : (
    <Navigate to="/login" replace />
  );
}

function ProfilePage() {
  const { user } = useAuth();

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
          fontFamily: "Syne, sans-serif",
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
        Welcome back, {user?.name || "User"} 👋
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
          <strong>Name:</strong> {user?.name || "—"}
        </p>

        <p style={{ marginTop: "14px" }}>
          <strong>Role:</strong>{" "}
          <span style={{ textTransform: "capitalize" }}>
            {user?.role || "—"}
          </span>
        </p>

        <p style={{ marginTop: "14px" }}>
          <strong>Email:</strong> {user?.email || "—"}
        </p>
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "#1c1c1f",
            color: "#f0f0f2",
            border: "1px solid #2a2a2e",
            fontSize: "14px",
            borderRadius: "10px",
          },
          success: {
            iconTheme: {
              primary: "#22c55e",
              secondary: "#1c1c1f",
            },
          },
          error: {
            iconTheme: {
              primary: "#ef4444",
              secondary: "#1c1c1f",
            },
          },
        }}
      />
      <Routes>
        {/* LOGIN */}
        <Route path="/login" element={<AuthPage />} />

        {/* ROOT REDIRECT */}
        <Route path="/" element={<RootRedirect />} />

        {/* DASHBOARD */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Dashboard />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        {/* TASKS */}
        <Route
          path="/tasks"
          element={
            <ProtectedRoute>
              <AppLayout>
                <TasksPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        {/* PROJECTS */}
        <Route
          path="/projects"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Projects />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        {/* PROJECT DETAIL / CONTROL ROOM */}
        <Route
          path="/projects/:projectId"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ProjectDetailPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        {/* RELEASES & MILESTONES */}
        <Route
          path="/releases"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ReleasesPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        {/* EXECUTION GRAPH */}
        <Route
          path="/execution-graph"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ExecutionGraphPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        {/* ENGINEERING DECISIONS */}
        <Route
          path="/decisions"
          element={
            <ProtectedRoute>
              <AppLayout>
                <DecisionsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        {/* TEAM CAPACITY & OWNERSHIP */}
        <Route
          path="/team-capacity"
          element={
            <ProtectedRoute>
              <AppLayout>
                <TeamCapacityPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        {/* ACTIVITY TIMELINE & VERSIONED EXECUTION LEDGER */}
        <Route
          path="/activity"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ActivityPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        {/* PROFILE */}
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ProfilePage />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        {/* DEV-ONLY ROUTE: ISOLATED DESIGN PREVIEW COMMAND CENTER */}
        {process.env.NODE_ENV !== "production" && (
          <Route
            path="/design-preview/dashboard"
            element={<CommandCenterPreview />}
          />
        )}

        {/* 404 NOT FOUND */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Router>
  );
}

export default App;
