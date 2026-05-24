import React, { useEffect, useState } from "react";
import api from "../utils/api";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";

const ROLE_COLORS = {
  admin: "#ef4444",
  manager: "#f59e0b",
  member: "#22c55e",
};

export default function Team() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user: currentUser } = useAuth();

  const fetchUsers = () =>
    api
      .get("/users")
      .then((res) => setUsers(res.data))
      .catch(() => toast.error("Failed to load team"))
      .finally(() => setLoading(false));

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleRoleChange = async (userId, role) => {
    try {
      await api.put(`/users/${userId}`, { role });
      toast.success("Role updated");
      fetchUsers();
    } catch {
      toast.error("Failed to update role");
    }
  };

  const handleDeactivate = async (userId) => {
    if (!window.confirm("Deactivate this user?")) return;
    try {
      await api.delete(`/users/${userId}`);
      toast.success("User deactivated");
      fetchUsers();
    } catch {
      toast.error("Failed");
    }
  };

  if (loading)
    return (
      <div className="loading-state">
        <div className="spinner" />
      </div>
    );

  return (
    <div style={{ maxWidth: 900 }}>
      <div
        className="projects-header"
        style={{ marginBottom: 24 }}
      >
        <div>
          <h1>Team</h1>
          <p
            style={{
              color: "var(--text-2)",
              fontSize: "0.875rem",
              marginTop: 4,
            }}
          >
            {users.length} members
          </p>
        </div>
      </div>

      <div
        className="card"
        style={{ padding: 0, overflow: "hidden" }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: "1px solid var(--border)",
              }}
            >
              {[
                "Member",
                "Role",
                "Status",
                "Joined",
                "Actions",
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "12px 16px",
                    textAlign: "left",
                    fontSize: "0.75rem",
                    color: "var(--text-3)",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u._id}
                style={{
                  borderBottom: "1px solid var(--border)",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background =
                    "var(--bg-3)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "")
                }
              >
                <td style={{ padding: "12px 16px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div
                      className="avatar"
                      style={{
                        background: stringToColor(u.name),
                      }}
                    >
                      {u.name
                        ?.split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: "0.875rem",
                          fontWeight: 500,
                        }}
                      >
                        {u.name}
                      </div>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--text-3)",
                        }}
                      >
                        {u.email}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: "12px 16px" }}>
                  {currentUser.role === "admin" &&
                  u._id !== currentUser._id ? (
                    <select
                      value={u.role}
                      onChange={(e) =>
                        handleRoleChange(
                          u._id,
                          e.target.value,
                        )
                      }
                      style={{
                        width: "auto",
                        fontSize: "0.8rem",
                        padding: "4px 8px",
                        background: `${ROLE_COLORS[u.role]}22`,
                        borderColor: `${ROLE_COLORS[u.role]}44`,
                        color: ROLE_COLORS[u.role],
                      }}
                    >
                      <option value="member">Member</option>
                      <option value="manager">
                        Manager
                      </option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    <span
                      className="badge"
                      style={{
                        background: `${ROLE_COLORS[u.role]}22`,
                        color: ROLE_COLORS[u.role],
                      }}
                    >
                      {u.role}
                    </span>
                  )}
                </td>
                <td style={{ padding: "12px 16px" }}>
                  <span
                    className={`badge ${u.isActive ? "badge-Done" : "badge-To Do"}`}
                  >
                    {u.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td
                  style={{
                    padding: "12px 16px",
                    fontSize: "0.8rem",
                    color: "var(--text-3)",
                  }}
                >
                  {new Date(
                    u.createdAt,
                  ).toLocaleDateString()}
                </td>
                <td style={{ padding: "12px 16px" }}>
                  {currentUser.role === "admin" &&
                    u._id !== currentUser._id &&
                    u.isActive && (
                      <button
                        className="btn btn-danger"
                        style={{
                          padding: "5px 12px",
                          fontSize: "0.78rem",
                        }}
                        onClick={() =>
                          handleDeactivate(u._id)
                        }
                      >
                        Deactivate
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function stringToColor(str = "") {
  let hash = 0;
  for (let i = 0; i < str.length; i++)
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`;
}
