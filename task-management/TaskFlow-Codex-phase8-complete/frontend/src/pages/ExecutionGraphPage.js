import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../utils/api";
import { useAuth } from "../context/AuthContext";
import TaskDrawer from "../components/tasks/TaskDrawer";
import DecisionDrawer from "../components/decisions/DecisionDrawer";
import "./ExecutionGraphPage.css";

const CriticalPathIcon = ({ size = 12, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const BlockerIcon = ({ size = 12, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
    <circle cx="12" cy="12" r="10" />
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
  </svg>
);

const WarningIcon = ({ size = 12, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const CheckIcon = ({ size = 12, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ClockIcon = ({ size = 12, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const ImpactIcon = ({ size = 12, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
    <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
    <polyline points="16 17 22 17 22 11" />
  </svg>
);

const LockIcon = ({ size = 12, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export default function ExecutionGraphPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Project selection & Graph data
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get("project") || "");
  const [graphData, setGraphData] = useState(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [graphError, setGraphError] = useState(null);

  // View & Filter modes
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
  const [viewMode, setViewMode] = useState(isMobile ? "list" : "canvas");
  const [engineView, setEngineView] = useState("delivery_impact"); // "delivery_impact" | "dependencies"
  const [selectedReleaseId, setSelectedReleaseId] = useState("");
  const [deliveryIntel, setDeliveryIntel] = useState(null);
  const [loadingIntel, setLoadingIntel] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [zoom, setZoom] = useState(1);

  // Selection & Inspector
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [activeTaskForDrawer, setActiveTaskForDrawer] = useState(null);
  const [candidateTasks, setCandidateTasks] = useState([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [addingDependency, setAddingDependency] = useState(false);
  const [nodeDecisions, setNodeDecisions] = useState([]);
  const [inspectingDecisionId, setInspectingDecisionId] = useState(null);

  // Fetch linked decisions for selected task
  useEffect(() => {
    if (!selectedNodeId) {
      setNodeDecisions([]);
      return;
    }
    api.get(`/decisions?task=${selectedNodeId}`)
      .then(({ data }) => {
        if (data?.success) setNodeDecisions(data.decisions || []);
      })
      .catch(() => setNodeDecisions([]));
  }, [selectedNodeId]);

  // Fetch capacity intelligence for selected project
  const [capacityIntel, setCapacityIntel] = useState(null);

  useEffect(() => {
    if (!selectedProjectId) {
      setCapacityIntel(null);
      return;
    }
    api.get(`/projects/${selectedProjectId}/capacity-intelligence?horizonDays=14`)
      .then(({ data }) => {
        if (data?.success) setCapacityIntel(data.data);
      })
      .catch(() => setCapacityIntel(null));
  }, [selectedProjectId]);

  // Refs for SVG connectors
  const canvasRef = useRef(null);
  const nodeRefs = useRef(new Map());
  const [edgePaths, setEdgePaths] = useState([]);

  // Fetch accessible projects
  useEffect(() => {
    let mounted = true;
    setLoadingProjects(true);
    api.get("/projects")
      .then(({ data }) => {
        if (!mounted) return;
        const projs = data.projects || [];
        setProjects(projs);
        if (projs.length > 0) {
          const currentParam = searchParams.get("project");
          const found = projs.find((p) => p._id === currentParam);
          const initialId = found ? found._id : projs[0]._id;
          setSelectedProjectId(initialId);
          if (!currentParam) {
            setSearchParams({ project: initialId }, { replace: true });
          }
        }
      })
      .catch((err) => {
        if (!mounted) return;
        toast.error("Failed to load projects");
      })
      .finally(() => {
        if (mounted) setLoadingProjects(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Fetch project dependency graph
  const fetchGraph = useCallback(() => {
    if (!selectedProjectId) return;
    setLoadingGraph(true);
    setGraphError(null);

    api.get(`/projects/${selectedProjectId}/dependency-graph`)
      .then(({ data }) => {
        if (data.success) {
          setGraphData(data);
        } else {
          setGraphError(data.message || "Failed to load dependency graph");
        }
      })
      .catch((err) => {
        setGraphError(err.response?.data?.message || "Failed to load dependency graph");
      })
      .finally(() => {
        setLoadingGraph(false);
      });
  }, [selectedProjectId]);

  // Fetch project delivery intelligence
  const fetchDeliveryIntel = useCallback(() => {
    if (!selectedProjectId) return;
    setLoadingIntel(true);
    const url = `/projects/${selectedProjectId}/delivery-intelligence${selectedReleaseId ? `?release=${selectedReleaseId}` : ""}`;
    api.get(url)
      .then(({ data }) => {
        if (data && data.success) {
          setDeliveryIntel(data);
        }
      })
      .catch((err) => {
        console.error("Failed to load delivery intelligence:", err);
      })
      .finally(() => {
        setLoadingIntel(false);
      });
  }, [selectedProjectId, selectedReleaseId]);

  useEffect(() => {
    fetchGraph();
    fetchDeliveryIntel();
    setSelectedNodeId(null);
  }, [fetchGraph, fetchDeliveryIntel]);

  // Sync URL search params when project changes
  const handleProjectChange = (projectId) => {
    setSelectedProjectId(projectId);
    setSelectedReleaseId("");
    setSearchParams({ project: projectId }, { replace: true });
  };

  // Fetch candidate tasks for selected node to allow adding dependencies
  useEffect(() => {
    if (!selectedNodeId || !selectedProjectId) {
      setCandidateTasks([]);
      return;
    }
    api.get(`/tasks?project=${selectedProjectId}&limit=150`)
      .then(({ data }) => {
        const tasks = data.tasks || [];
        setCandidateTasks(tasks);
      })
      .catch(() => setCandidateTasks([]));
  }, [selectedNodeId, selectedProjectId]);

  // Selected node details
  const selectedNode = useMemo(() => {
    if (!graphData || !selectedNodeId) return null;
    return graphData.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [graphData, selectedNodeId]);

  const selectedNodeTask = useMemo(() => {
    if (!selectedNodeId) return null;
    return candidateTasks.find((t) => (t._id || t.id) === selectedNodeId) || null;
  }, [selectedNodeId, candidateTasks]);

  const ownerCapacity = useMemo(() => {
    if (!selectedNodeTask?.assignedTo || !capacityIntel) return null;
    const assigneeId = selectedNodeTask.assignedTo._id || selectedNodeTask.assignedTo.id || selectedNodeTask.assignedTo;
    if (capacityIntel.scope === 'personal') {
      if (capacityIntel.personal?.user?.id === assigneeId) {
        return capacityIntel.personal;
      }
      return null;
    }
    return capacityIntel.members?.find((m) => m.user.id === assigneeId) || null;
  }, [selectedNodeTask, capacityIntel]);

  // Upstream prerequisites & downstream dependents of the selected node
  const { upstreamIds, downstreamIds, highlightedEdgeIds } = useMemo(() => {
    if (!graphData || !selectedNodeId) {
      return { upstreamIds: new Set(), downstreamIds: new Set(), highlightedEdgeIds: new Set() };
    }

    const upIds = new Set();
    const downIds = new Set();
    const hlEdges = new Set();

    // Direct and transitive upstream
    const queueUp = [selectedNodeId];
    while (queueUp.length > 0) {
      const curr = queueUp.shift();
      for (const edge of graphData.edges) {
        if (edge.target === curr && !upIds.has(edge.source)) {
          upIds.add(edge.source);
          hlEdges.add(edge.id);
          queueUp.push(edge.source);
        }
      }
    }

    // Direct and transitive downstream
    const queueDown = [selectedNodeId];
    while (queueDown.length > 0) {
      const curr = queueDown.shift();
      for (const edge of graphData.edges) {
        if (edge.source === curr && !downIds.has(edge.target)) {
          downIds.add(edge.target);
          hlEdges.add(edge.id);
          queueDown.push(edge.target);
        }
      }
    }

    return { upstreamIds: upIds, downstreamIds: downIds, highlightedEdgeIds: hlEdges };
  }, [graphData, selectedNodeId]);

  // Filtered nodes
  const filteredNodeIds = useMemo(() => {
    if (!graphData) return new Set();
    const q = searchQuery.toLowerCase().trim();

    return new Set(
      graphData.nodes
        .filter((n) => {
          if (q && !n.title.toLowerCase().includes(q)) return false;
          if (statusFilter !== "all" && n.status !== statusFilter) return false;
          if (priorityFilter !== "all" && n.priority?.toLowerCase() !== priorityFilter.toLowerCase()) return false;
          return true;
        })
        .map((n) => n.id)
    );
  }, [graphData, searchQuery, statusFilter, priorityFilter]);

  // Layout calculations: SVG Connectors
  const updateEdgePaths = useCallback(() => {
    if (!graphData || !canvasRef.current || viewMode !== "canvas") {
      setEdgePaths([]);
      return;
    }

    const canvasRect = canvasRef.current.getBoundingClientRect();
    const scrollLeft = canvasRef.current.scrollLeft;
    const scrollTop = canvasRef.current.scrollTop;

    const paths = [];

    for (const edge of graphData.edges) {
      const sourceEl = nodeRefs.current.get(edge.source);
      const targetEl = nodeRefs.current.get(edge.target);

      if (!sourceEl || !targetEl) continue;

      const sRect = sourceEl.getBoundingClientRect();
      const tRect = targetEl.getBoundingClientRect();

      // Start: right middle of source card
      const x1 = (sRect.right - canvasRect.left + scrollLeft) / zoom;
      const y1 = (sRect.top + sRect.height / 2 - canvasRect.top + scrollTop) / zoom;

      // End: left middle of target card
      const x2 = (tRect.left - canvasRect.left + scrollLeft) / zoom;
      const y2 = (tRect.top + tRect.height / 2 - canvasRect.top + scrollTop) / zoom;

      const dx = Math.max(36, Math.abs(x2 - x1) * 0.45);
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

      const isSourceVisible = filteredNodeIds.has(edge.source);
      const isTargetVisible = filteredNodeIds.has(edge.target);
      const isHighlighted = highlightedEdgeIds.has(edge.id);
      const isUpstream = upstreamIds.has(edge.source) && (selectedNodeId === edge.target || upstreamIds.has(edge.target));
      const isCriticalEdge = Boolean(
        deliveryIntel?.criticalEdges?.some((ce) => ce.from === edge.source && ce.to === edge.target) ||
        (deliveryIntel?.criticalPath &&
          deliveryIntel.criticalPath.includes(edge.source) &&
          deliveryIntel.criticalPath.includes(edge.target) &&
          deliveryIntel.criticalPath.indexOf(edge.source) + 1 === deliveryIntel.criticalPath.indexOf(edge.target))
      );

      paths.push({
        id: edge.id,
        d,
        resolved: edge.resolved,
        visible: isSourceVisible && isTargetVisible,
        highlighted: isHighlighted,
        isUpstream,
        isCriticalEdge,
      });
    }

    setEdgePaths(paths);
  }, [graphData, viewMode, zoom, filteredNodeIds, highlightedEdgeIds, upstreamIds, selectedNodeId, deliveryIntel]);

  // Update edge coordinates when data, filters, or scroll changes
  useEffect(() => {
    const timer = setTimeout(updateEdgePaths, 50);
    return () => clearTimeout(timer);
  }, [updateEdgePaths]);

  useEffect(() => {
    window.addEventListener("resize", updateEdgePaths);
    return () => window.removeEventListener("resize", updateEdgePaths);
  }, [updateEdgePaths]);

  // Dismiss inspector on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && selectedNodeId) {
        setSelectedNodeId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNodeId]);

  // Add dependency action from inspector
  const handleAddDependency = async (e) => {
    e.preventDefault();
    if (!selectedCandidateId || !selectedNodeId) return;

    setAddingDependency(true);
    try {
      const res = await api.post(`/tasks/${selectedNodeId}/dependencies`, {
        dependsOnTaskId: selectedCandidateId,
      });
      if (res.data.success) {
        toast.success("Prerequisite dependency added");
        setSelectedCandidateId("");
        fetchGraph();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to add dependency");
    } finally {
      setAddingDependency(false);
    }
  };

  // Remove dependency action
  const handleRemoveDependency = async (dependencyTaskId) => {
    if (!selectedNodeId) return;
    try {
      const res = await api.delete(`/tasks/${selectedNodeId}/dependencies/${dependencyTaskId}`);
      if (res.data.success) {
        toast.success("Dependency removed");
        fetchGraph();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to remove dependency");
    }
  };

  // Open full Task Drawer for a selected task
  const handleOpenFullTaskDrawer = async (taskId) => {
    try {
      const res = await api.get(`/tasks/${taskId}`);
      if (res.data.task) {
        setActiveTaskForDrawer(res.data.task);
      }
    } catch (err) {
      toast.error("Failed to load task details");
    }
  };

  // Candidates for adding a prerequisite to selectedNode:
  // Exclude: selectedNode itself, current prerequisites
  const validCandidateTasks = useMemo(() => {
    if (!selectedNode || !graphData) return [];
    const existingPrereqIds = new Set(
      graphData.edges
        .filter((e) => e.target === selectedNode.id)
        .map((e) => e.source)
    );

    // Also avoid any tasks that depend on selectedNode (would create direct/transitive cycle)
    return candidateTasks.filter((t) => {
      const tId = t._id?.toString() || t.id?.toString();
      if (tId === selectedNode.id) return false;
      if (existingPrereqIds.has(tId)) return false;
      if (downstreamIds.has(tId)) return false;
      return true;
    });
  }, [selectedNode, candidateTasks, graphData, downstreamIds]);

  // Node dependencies for inspector
  const inspectorPrereqs = useMemo(() => {
    if (!selectedNode || !graphData) return [];
    return graphData.edges
      .filter((e) => e.target === selectedNode.id)
      .map((e) => {
        const node = graphData.nodes.find((n) => n.id === e.source);
        return {
          id: e.source,
          title: node?.title || "Prerequisite Task",
          status: node?.status || "To Do",
          resolved: e.resolved,
        };
      });
  }, [selectedNode, graphData]);

  const inspectorDependents = useMemo(() => {
    if (!selectedNode || !graphData) return [];
    return graphData.edges
      .filter((e) => e.source === selectedNode.id)
      .map((e) => {
        const node = graphData.nodes.find((n) => n.id === e.target);
        return {
          id: e.target,
          title: node?.title || "Dependent Task",
          status: node?.status || "To Do",
          resolved: selectedNode.status === "Done",
        };
      });
  }, [selectedNode, graphData]);

  const metrics = graphData?.metrics || {
    totalNodes: 0,
    totalEdges: 0,
    readyTasks: 0,
    waitingTasks: 0,
    blockedTasks: 0,
    disconnectedTasks: 0,
  };

  return (
    <div className="execution-graph-page">
      {/* HEADER */}
      <header className="graph-header">
        <div className="graph-header-left">
          <div className="graph-title-row">
            <span className="graph-title-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="12" r="3" />
                <line x1="8.5" y1="7.5" x2="15.5" y2="10.5" />
                <line x1="8.5" y1="16.5" x2="15.5" y2="13.5" />
              </svg>
            </span>
            <h1 className="graph-title">Execution Graph</h1>
          </div>
          <p className="graph-subtitle">
            Directed task dependency intelligence — visualize prerequisites, blocker propagation, and execution readiness.
          </p>
        </div>

        <div className="graph-header-right">
          {/* PROJECT SELECTOR */}
          <div className="project-select-wrapper">
            <label htmlFor="graph-project-select" className="project-select-label">
              Project:
            </label>
            <select
              id="graph-project-select"
              className="project-select"
              value={selectedProjectId}
              onChange={(e) => handleProjectChange(e.target.value)}
              disabled={loadingProjects || projects.length === 0}
            >
              {projects.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}{p.status === "archived" ? " (Archived)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* SCOPE / RELEASE SELECTOR */}
          <div className="project-select-wrapper">
            <label htmlFor="graph-release-select" className="project-select-label">
              Scope:
            </label>
            <select
              id="graph-release-select"
              className="project-select"
              value={selectedReleaseId}
              onChange={(e) => setSelectedReleaseId(e.target.value)}
              disabled={loadingProjects || !deliveryIntel}
            >
              <option value="">All Project Tasks</option>
              {deliveryIntel?.releases?.map((r) => (
                <option key={r.id} value={r.id}>
                  Release: {r.name} ({r.version})
                </option>
              ))}
            </select>
          </div>

          {/* ENGINE MODE SWITCHER */}
          <div className="view-mode-toggle" role="group" aria-label="Engine Mode">
            <button
              type="button"
              className={`view-mode-btn ${engineView === "delivery_impact" ? "active" : ""}`}
              onClick={() => setEngineView("delivery_impact")}
              title="Delivery slip forecasting, critical path, and blocker propagation"
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <CriticalPathIcon size={14} />
              Delivery Impact & Slip
            </button>
            <button
              type="button"
              className={`view-mode-btn ${engineView === "dependencies" ? "active" : ""}`}
              onClick={() => setEngineView("dependencies")}
              title="Topological Directed Acyclic Graph structure"
            >
              ◈ Dependencies (DAG)
            </button>
          </div>

          {/* VIEW MODE TOGGLE */}
          <div className="view-mode-toggle" role="group" aria-label="View Mode">
            <button
              type="button"
              className={`view-mode-btn ${viewMode === "canvas" ? "active" : ""}`}
              onClick={() => setViewMode("canvas")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="5" cy="5" r="3" />
                <circle cx="19" cy="19" r="3" />
                <line x1="7" y1="7" x2="17" y2="17" />
              </svg>
              Canvas
            </button>
            <button
              type="button"
              className={`view-mode-btn ${viewMode === "list" ? "active" : ""}`}
              onClick={() => setViewMode("list")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
              Tree / List
            </button>
          </div>
        </div>
      </header>

      {/* MEMBER PRIVACY NOTICE */}
      {graphData?.isPartial && (
        <div
          className="member-scope-banner card"
          role="note"
          style={{
            padding: "10px 16px",
            background: "rgba(99, 102, 241, 0.08)",
            borderLeft: "3px solid #6366f1",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "13px",
            marginBottom: "12px",
          }}
        >
          <span>ℹ️</span>
          <span>
            <strong>Personal Visibility Scope:</strong> You are viewing only the tasks assigned to or created by you in this project graph.
          </span>
        </div>
      )}

      {/* ARCHIVED PROJECT READ-ONLY NOTICE */}
      {graphData?.project?.status === "archived" && (
        <div
          className="archived-scope-banner card"
          role="note"
          style={{
            padding: "10px 16px",
            background: "rgba(245, 158, 11, 0.08)",
            borderLeft: "3px solid #f59e0b",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "13px",
            marginBottom: "12px",
          }}
        >
          <span>📦</span>
          <span>
            <strong>Archived Project (Read-Only):</strong> This project is archived. Dependency graphs are retained for historical audit, but relationships cannot be added or removed.
          </span>
        </div>
      )}

      {/* RESTRICTED UPSTREAM MASKED BANNER FOR MEMBERS */}
      {deliveryIntel?.restrictedUpstreamSignal && (
        <div
          className="member-scope-banner card"
          role="alert"
          style={{
            padding: "10px 16px",
            background: "rgba(245, 158, 11, 0.1)",
            borderLeft: "3px solid #f59e0b",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "13px",
            marginBottom: "12px",
            color: "#fbbf24",
          }}
        >
          <span>⚠️</span>
          <span>
            <strong>Upstream Dependency Alert:</strong> Restricted upstream work may affect this task.
          </span>
        </div>
      )}

      {/* METRICS BAR */}
      <section className="graph-metrics-bar" aria-label="Project dependency summary">
        {engineView === "delivery_impact" && deliveryIntel && !deliveryIntel.isPartial ? (
          deliveryIntel.availability === "archived" ? (
            <div className="graph-metric-chip" style={{ borderColor: "#64748b" }}>
              <span className="metric-chip-label">Project Status</span>
              <span className="metric-chip-value" style={{ color: "#94a3b8" }}>
                ARCHIVED
              </span>
              <span className="metric-chip-desc">Delivery Intelligence scoring closed</span>
            </div>
          ) : (
          <>
            <div className="graph-metric-chip">
              <span className="metric-chip-label">Forecast Status</span>
              <span
                className="metric-chip-value"
                style={{
                  color:
                    deliveryIntel.forecast?.status === "on_track"
                      ? "#34d399"
                      : deliveryIntel.forecast?.status === "slipping"
                      ? "#f87171"
                      : deliveryIntel.forecast?.status === "at_risk"
                      ? "#fbbf24"
                      : "#818cf8",
                  fontSize: "15px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                }}
              >
                {deliveryIntel.forecast?.status === "indeterminate"
                  ? (deliveryIntel.forecast?.drivers?.some((d) => d.type === "critical_blocker")
                      ? "Blocked · ETA Required"
                      : "Indeterminate")
                  : deliveryIntel.forecast?.status
                  ? deliveryIntel.forecast.status.replace(/_/g, " ")
                  : "Needs Estimates"}
              </span>
              <span className="metric-chip-desc">
                {deliveryIntel.forecast?.slipDays > 0
                  ? `+${deliveryIntel.forecast.slipDays} days slip`
                  : deliveryIntel.forecast?.slipDays === 0
                  ? "On target schedule"
                  : "Target date TBD"}
              </span>
            </div>

            <div className="graph-metric-chip">
              <span className="metric-chip-label">
                <span className="metric-chip-indicator" style={{ background: "#38bdf8" }} />
                Predicted Ship Date
              </span>
              <span className="metric-chip-value" style={{ fontSize: "16px", color: "#38bdf8" }}>
                {deliveryIntel.forecast?.forecastDate
                  ? new Date(deliveryIntel.forecast.forecastDate).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "Indeterminate"}
              </span>
              <span className="metric-chip-desc">
                Target:{" "}
                {deliveryIntel.forecast?.targetDate
                  ? new Date(deliveryIntel.forecast.targetDate).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                  : "None set"}
              </span>
            </div>

            <div className="graph-metric-chip">
              <span className="metric-chip-label">
                <span className="metric-chip-indicator" style={{ background: "#f59e0b" }} />
                Critical Path
              </span>
              <span className="metric-chip-value" style={{ color: "#fbbf24" }}>
                {deliveryIntel.criticalPath?.length || 0} tasks
              </span>
              <span className="metric-chip-desc">
                {deliveryIntel.forecast?.totalRemainingDays || 0} calendar days remaining
              </span>
            </div>

            <div className="graph-metric-chip">
              <span className="metric-chip-label">
                <span className="metric-chip-indicator" style={{ background: "#ef4444" }} />
                Direct Blockers
              </span>
              <span className="metric-chip-value" style={{ color: "#f87171" }}>
                {deliveryIntel.summary?.blockedDirectCount || 0}
              </span>
              <span className="metric-chip-desc">Explicit root blockers</span>
            </div>

            <div className="graph-metric-chip">
              <span className="metric-chip-label">
                <span className="metric-chip-indicator" style={{ background: "#f97316" }} />
                Propagated Impact
              </span>
              <span className="metric-chip-value" style={{ color: "#f97316" }}>
                {deliveryIntel.summary?.blockedPropagatedCount || 0}
              </span>
              <span className="metric-chip-desc">Downstream affected tasks</span>
            </div>

            <div className="graph-metric-chip">
              <span className="metric-chip-label">
                <span className="metric-chip-indicator" style={{ background: "#10b981" }} />
                Progress
              </span>
              <span className="metric-chip-value" style={{ color: "#34d399" }}>
                {deliveryIntel.forecast?.completedTasks || 0}/{deliveryIntel.forecast?.totalTasks || metrics.totalNodes}
              </span>
              <span className="metric-chip-desc">Tasks completed</span>
            </div>
          </>
          )
        ) : (
          <>
            <div className="graph-metric-chip">
              <span className="metric-chip-label">Total Tasks</span>
              <span className="metric-chip-value">{metrics.totalNodes}</span>
              <span className="metric-chip-desc">In project scope</span>
            </div>

            <div className="graph-metric-chip">
              <span className="metric-chip-label">
                <span className="metric-chip-indicator" style={{ background: "#818cf8" }} />
                Dependency Edges
              </span>
              <span className="metric-chip-value">{metrics.totalEdges}</span>
              <span className="metric-chip-desc">Directed constraints</span>
            </div>

            <div className="graph-metric-chip">
              <span className="metric-chip-label">
                <span className="metric-chip-indicator" style={{ background: "#10b981" }} />
                Ready to Start
              </span>
              <span className="metric-chip-value" style={{ color: "#34d399" }}>
                {metrics.readyTasks}
              </span>
              <span className="metric-chip-desc">0 open prerequisites</span>
            </div>

            <div className="graph-metric-chip">
              <span className="metric-chip-label">
                <span className="metric-chip-indicator" style={{ background: "#f59e0b" }} />
                Waiting
              </span>
              <span className="metric-chip-value" style={{ color: "#fbbf24" }}>
                {metrics.waitingTasks}
              </span>
              <span className="metric-chip-desc">Incomplete prereqs</span>
            </div>

            <div className="graph-metric-chip">
              <span className="metric-chip-label">
                <span className="metric-chip-indicator" style={{ background: "#ef4444" }} />
                Blocked Work
              </span>
              <span className="metric-chip-value" style={{ color: "#f87171" }}>
                {metrics.blockedTasks}
              </span>
              <span className="metric-chip-desc">Explicit blockers</span>
            </div>

            <div className="graph-metric-chip">
              <span className="metric-chip-label">
                <span className="metric-chip-indicator" style={{ background: "#64748b" }} />
                Disconnected
              </span>
              <span className="metric-chip-value" style={{ color: "#94a3b8" }}>
                {metrics.disconnectedTasks}
              </span>
              <span className="metric-chip-desc">Standalone tasks</span>
            </div>
          </>
        )}
      </section>

      {/* TOOLBAR & FILTERS */}
      <section className="graph-toolbar" aria-label="Graph Controls">
        <div className="graph-filters-group">
          <input
            type="text"
            className="graph-search-input"
            placeholder="Search tasks in graph..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <select
            className="graph-filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="To Do">To Do</option>
            <option value="In Progress">In Progress</option>
            <option value="Done">Done</option>
          </select>

          <select
            className="graph-filter-select"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
          >
            <option value="all">All Priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          {(searchQuery || statusFilter !== "all" || priorityFilter !== "all") && (
            <button
              type="button"
              className="btn-reset-filters"
              onClick={() => {
                setSearchQuery("");
                setStatusFilter("all");
                setPriorityFilter("all");
              }}
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="graph-legend-group">
          <div className="legend-item">
            <span className="legend-swatch resolved" />
            <span>Resolved Edge</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch unresolved" />
            <span>Active Constraint</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot ready" />
            <span>Ready</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot waiting" />
            <span>Waiting</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot blocked" />
            <span>Blocked</span>
          </div>
        </div>
      </section>

      {/* GRAPH CONTENT AREA */}
      {loadingGraph ? (
        <div className="graph-empty-state">
          <div className="spinner" />
          <p>Analyzing project dependency graph...</p>
        </div>
      ) : graphError ? (
        <div className="graph-empty-state">
          <span className="empty-state-icon">⚠️</span>
          <h2 className="empty-state-title">Graph Error</h2>
          <p className="empty-state-desc">{graphError}</p>
        </div>
      ) : !graphData || graphData.nodes.length === 0 ? (
        <div className="graph-empty-state">
          <span className="empty-state-icon">◈</span>
          <h2 className="empty-state-title">No Tasks in Project</h2>
          <p className="empty-state-desc">
            This project currently has no tasks to map. Create tasks in the project to begin building your directed execution graph.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate(`/projects/${selectedProjectId}`)}
            style={{ marginTop: "8px" }}
          >
            Open Project Control Room
          </button>
        </div>
      ) : viewMode === "canvas" ? (
        /* CANVAS VIEW */
        <div className="graph-viewport-wrapper">
          <div
            className="graph-canvas-container"
            ref={canvasRef}
            onScroll={updateEdgePaths}
          >
            {/* SVG CONNECTOR OVERLAY */}
            <svg
              className="graph-svg-overlay"
              style={{
                width: "2500px",
                height: "1400px",
                transform: `scale(${zoom})`,
                transformOrigin: "0 0",
              }}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="arrow-unresolved"
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 8 5 L 0 9 z" fill="#818cf8" />
                </marker>
                <marker
                  id="arrow-resolved"
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 8 5 L 0 9 z" fill="#10b981" />
                </marker>
                <marker
                  id="arrow-upstream"
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 8 5 L 0 9 z" fill="#34d399" />
                </marker>
                <marker
                  id="arrow-critical"
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 8 5 L 0 9 z" fill="#f59e0b" />
                </marker>
              </defs>

              {edgePaths.map((edge) => {
                if (!edge.visible) return null;
                const isDimmed = selectedNodeId && !edge.highlighted;
                const isCritical = Boolean(edge.isCriticalEdge && engineView === "delivery_impact");
                let strokeMarker = edge.resolved ? "url(#arrow-resolved)" : "url(#arrow-unresolved)";
                if (edge.isUpstream) strokeMarker = "url(#arrow-upstream)";
                if (isCritical) strokeMarker = "url(#arrow-critical)";

                return (
                  <path
                    key={edge.id}
                    d={edge.d}
                    className={`graph-edge-path ${edge.resolved ? "resolved" : ""} ${
                      isDimmed ? "dimmed" : ""
                    } ${edge.highlighted ? "highlighted" : ""} ${edge.isUpstream ? "highlighted-upstream" : ""} ${
                      isCritical ? "critical-path-edge" : ""
                    }`}
                    markerEnd={strokeMarker}
                  />
                );
              })}
            </svg>

            {/* TOPOLOGICAL LEVEL COLUMNS */}
            <div
              className="graph-columns-layout"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "0 0",
              }}
            >
              {graphData.levels.map((levelTaskIds, lvlIdx) => {
                const visibleIds = levelTaskIds.filter((id) => filteredNodeIds.has(id));
                if (visibleIds.length === 0 && (searchQuery || statusFilter !== "all" || priorityFilter !== "all")) {
                  return null;
                }

                return (
                  <div key={lvlIdx} className="graph-level-column">
                    <div className="level-column-header">
                      <span className="level-header-title">
                        {lvlIdx === 0 ? "Level 0 • Ready / Roots" : `Level ${lvlIdx} • Execution Stage`}
                      </span>
                      <span className="level-header-badge">{visibleIds.length}</span>
                    </div>

                    <div className="level-column-nodes">
                      {levelTaskIds.map((taskId) => {
                        const node = graphData.nodes.find((n) => n.id === taskId);
                        if (!node) return null;
                        const isVisible = filteredNodeIds.has(taskId);
                        if (!isVisible) return null;

                        const isSelected = selectedNodeId === taskId;
                        const isUpstream = upstreamIds.has(taskId);
                        const isDownstream = downstreamIds.has(taskId);
                        const isDimmed = selectedNodeId && !isSelected && !isUpstream && !isDownstream;

                        // Delivery Intelligence node metadata
                        const intelNode = deliveryIntel?.nodes?.[taskId];
                        const isOnCriticalPath = Boolean(
                          intelNode?.criticalPath || (deliveryIntel?.criticalPath && deliveryIntel.criticalPath.includes(taskId))
                        );
                        const isDirectBlocker = Boolean(intelNode?.isDirectBlocker || node.isBlocked);
                        const isPropagatedBlocker = Boolean(intelNode?.isPropagatedBlocker || intelNode?.propagatedBlocked);
                        const downstreamCount = intelNode?.downstreamImpactCount || 0;

                        // Count incoming & outgoing edges for this node
                        const prereqCount = graphData.edges.filter((e) => e.target === taskId).length;
                        const depCount = graphData.edges.filter((e) => e.source === taskId).length;

                        return (
                          <div
                            key={taskId}
                            ref={(el) => {
                              if (el) nodeRefs.current.set(taskId, el);
                              else nodeRefs.current.delete(taskId);
                            }}
                            className={`graph-node-card state-${node.dependencyState} ${
                              isSelected ? "selected" : ""
                            } ${isUpstream ? "highlighted-upstream" : ""} ${
                              isDownstream ? "highlighted-downstream" : ""
                            } ${isDimmed ? "dimmed" : ""} ${
                              isOnCriticalPath && engineView === "delivery_impact" ? "on-critical-path" : ""
                            } ${
                              isDirectBlocker && engineView === "delivery_impact"
                                ? "direct-blocker"
                                : isPropagatedBlocker && engineView === "delivery_impact"
                                ? "propagated-blocker"
                                : ""
                            }`}
                            onClick={() => setSelectedNodeId(isSelected ? null : taskId)}
                            role="button"
                            tabIndex={0}
                            aria-label={`Task ${node.title}, status: ${node.status}, state: ${node.dependencyState}`}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelectedNodeId(isSelected ? null : taskId);
                              }
                            }}
                          >
                            <div className="node-card-top-row">
                              {engineView === "delivery_impact" && isDirectBlocker ? (
                                <span className="node-state-badge state-blocked" style={{ background: "rgba(239, 68, 68, 0.2)", color: "#f87171", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                  <BlockerIcon size={12} /> Direct Blocker
                                </span>
                              ) : engineView === "delivery_impact" && isPropagatedBlocker ? (
                                <span className="node-state-badge state-blocked_and_waiting" style={{ background: "rgba(249, 115, 22, 0.2)", color: "#fb923c", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                  <WarningIcon size={12} /> Prereq Blocked
                                </span>
                              ) : (
                                <span className={`node-state-badge ${node.dependencyState}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                  {node.dependencyState === "ready" && <><CheckIcon size={11} /> Ready</>}
                                  {node.dependencyState === "waiting" && <><ClockIcon size={11} /> Waiting ({prereqCount})</>}
                                  {node.dependencyState === "blocked_and_waiting" && <><WarningIcon size={11} /> Blocked & Waiting</>}
                                  {node.dependencyState === "blocked" && <><BlockerIcon size={11} /> Blocked</>}
                                  {node.dependencyState === "completed" && <><CheckIcon size={11} /> Done</>}
                                </span>
                              )}

                              {isOnCriticalPath && engineView === "delivery_impact" && (
                                <span className="node-badge-critical" title="On Delivery Critical Path" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                  <CriticalPathIcon size={12} /> Critical Path
                                </span>
                              )}

                              <span className={`node-priority-badge ${node.priority?.toLowerCase()}`}>
                                {node.priority || "med"}
                              </span>
                            </div>

                            <div className="node-title" title={node.title}>
                              {node.title}
                            </div>

                            <div className="node-card-footer">
                              <div className="node-deps-count">
                                <span className="deps-pill" title="Prerequisites (Depends on)">
                                  ← {prereqCount}
                                </span>
                                <span className="deps-pill" title="Dependents (Blocks)">
                                  → {depCount}
                                </span>
                                {engineView === "delivery_impact" && downstreamCount > 0 && (
                                  <span className="deps-pill impact-pill" style={{ color: "#f59e0b", borderColor: "rgba(245, 158, 11, 0.3)", display: "inline-flex", alignItems: "center", gap: "3px" }} title={`Impacts ${downstreamCount} downstream tasks`}>
                                    <ImpactIcon size={11} /> {downstreamCount}
                                  </span>
                                )}
                                {engineView === "delivery_impact" && intelNode?.estimateDays != null && (
                                  <span className="deps-pill estimate-pill" style={{ display: "inline-flex", alignItems: "center", gap: "3px" }} title={`Estimated: ${intelNode.estimateDays} days`}>
                                    <ClockIcon size={11} /> {intelNode.estimateDays}d
                                  </span>
                                )}
                              </div>

                              {node.assignedTo ? (
                                <div className="node-assignee" title={node.assignedTo.name}>
                                  <span className="node-avatar-chip">
                                    {node.assignedTo.name.charAt(0).toUpperCase()}
                                  </span>
                                  <span style={{ fontSize: "11px" }}>{node.assignedTo.name.split(" ")[0]}</span>
                                </div>
                              ) : (
                                <span style={{ fontSize: "10px", color: "var(--text-3, #606068)" }}>Unassigned</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ZOOM CONTROLS */}
          <div className="graph-zoom-controls">
            <button
              type="button"
              className="zoom-btn"
              onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
              title="Zoom In"
              aria-label="Zoom In"
            >
              +
            </button>
            <button
              type="button"
              className="zoom-btn"
              onClick={() => setZoom(1)}
              title="Reset Zoom"
              aria-label="Reset Zoom"
            >
              1:1
            </button>
            <button
              type="button"
              className="zoom-btn"
              onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}
              title="Zoom Out"
              aria-label="Zoom Out"
            >
              −
            </button>
          </div>

          {/* SIDE INSPECTION DRAWER */}
          {selectedNode && (
            <aside className="graph-inspector-panel" aria-label="Task Dependency Inspector">
              <div className="inspector-header">
                <div className="inspector-title">
                  <span>◈</span> Task Details & Dependencies
                </div>
                <button
                  type="button"
                  className="inspector-close-btn"
                  onClick={() => setSelectedNodeId(null)}
                  aria-label="Close details panel"
                >
                  ✕
                </button>
              </div>

              <div className="inspector-body">
                <div className="inspector-task-summary">
                  <div className="inspector-task-title">{selectedNode.title}</div>
                  <div className="inspector-task-meta">
                    <span className={`node-state-badge ${selectedNode.dependencyState}`}>
                      {selectedNode.dependencyState === "ready" && "Ready to Start"}
                      {selectedNode.dependencyState === "waiting" && "Waiting on Prerequisites"}
                      {selectedNode.dependencyState === "blocked_and_waiting" && "Blocked & Waiting"}
                      {selectedNode.dependencyState === "blocked" && "Blocked"}
                      {selectedNode.dependencyState === "completed" && "Completed"}
                    </span>
                    <span className={`node-priority-badge ${selectedNode.priority?.toLowerCase()}`}>
                      {selectedNode.priority}
                    </span>
                    <span style={{ fontSize: "12px", color: "var(--text-2, #a0a0aa)" }}>
                      Status: <strong>{selectedNode.status}</strong>
                    </span>
                  </div>

                  {selectedNode.isBlocked && (
                    <div
                      style={{
                        marginTop: "8px",
                        padding: "8px 10px",
                        background: "rgba(239, 68, 68, 0.1)",
                        borderLeft: "3px solid #ef4444",
                        borderRadius: "6px",
                        fontSize: "12px",
                        color: "#fca5a5",
                      }}
                    >
                      <strong>Blocker:</strong> {selectedNode.blockedReason || "Explicit blocker marked"}
                    </div>
                  )}
                </div>

                {/* DELIVERY INTELLIGENCE DETAILS */}
                {deliveryIntel && (
                  <div
                    className="inspector-section"
                    style={{
                      background: "rgba(124, 106, 255, 0.05)",
                      border: "1px solid rgba(124, 106, 255, 0.15)",
                      borderRadius: "8px",
                      padding: "12px",
                      marginTop: "12px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: "6px" }}>
                        <CriticalPathIcon size={14} />
                        Delivery Slip & Critical Path
                      </span>
                      {deliveryIntel?.nodes?.[selectedNode.id]?.criticalPath && (
                        <span className="node-badge-critical">Critical Path</span>
                      )}
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "12px" }}>
                      <div>
                        <span style={{ color: "var(--text-3, #606068)", display: "block" }}>Estimate</span>
                        <strong style={{ color: "#fff" }}>
                          {deliveryIntel?.nodes?.[selectedNode.id]?.estimateDays != null
                            ? `${deliveryIntel.nodes[selectedNode.id].estimateDays} days`
                            : "Missing"}
                        </strong>
                      </div>
                      <div>
                        <span style={{ color: "var(--text-3, #606068)", display: "block" }}>Downstream Impact</span>
                        <strong style={{ color: (deliveryIntel?.nodes?.[selectedNode.id]?.downstreamImpactCount || 0) > 0 ? "#f59e0b" : "#fff" }}>
                          {deliveryIntel?.nodes?.[selectedNode.id]?.downstreamImpactCount || 0} tasks
                        </strong>
                      </div>
                    </div>

                    {deliveryIntel?.nodes?.[selectedNode.id]?.blockerEta && (
                      <div style={{ marginTop: "8px", fontSize: "12px" }}>
                        <span style={{ color: "var(--text-3, #606068)" }}>Resolution ETA: </span>
                        <strong style={{ color: "#38bdf8" }}>
                          {new Date(deliveryIntel.nodes[selectedNode.id].blockerEta).toLocaleDateString()}
                        </strong>
                      </div>
                    )}

                    {deliveryIntel?.nodes?.[selectedNode.id]?.affectedDownstreamTasks?.length > 0 && (
                      <div style={{ marginTop: "8px", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "6px" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-3, #606068)", fontWeight: 600 }}>
                          Downstream Tasks Affected ({deliveryIntel.nodes[selectedNode.id].affectedDownstreamTasks.length}):
                        </span>
                        <ul style={{ margin: "4px 0 0", paddingLeft: "16px", fontSize: "12px", color: "var(--text-2, #a0a0aa)" }}>
                          {deliveryIntel.nodes[selectedNode.id].affectedDownstreamTasks.slice(0, 5).map((t, idx) => (
                            <li key={idx}>
                              {t.title} <span style={{ fontSize: "10px", opacity: 0.7 }}>({t.status})</span>
                            </li>
                          ))}
                          {deliveryIntel.nodes[selectedNode.id].affectedDownstreamTasks.length > 5 && (
                            <li style={{ fontSize: "11px", fontStyle: "italic" }}>
                              +{deliveryIntel.nodes[selectedNode.id].affectedDownstreamTasks.length - 5} more
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* OWNER CAPACITY & WIP STATE (PHASE 6) */}
                {ownerCapacity && (
                  <div
                    className="inspector-section"
                    style={{
                      background: "rgba(99, 102, 241, 0.05)",
                      border: "1px solid rgba(99, 102, 241, 0.18)",
                      borderRadius: "8px",
                      padding: "12px",
                      marginTop: "12px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: "6px" }}>
                        👥 Owner Capacity & WIP Pressure
                      </span>
                      <span className={`status-badge badge-${ownerCapacity.loadStatus}`} style={{ fontSize: "10px" }}>
                        {ownerCapacity.loadStatus?.replace("_", " ")}
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "11px", color: "var(--text-2, #a0a0aa)" }}>
                      <div>
                        <span>WIP Limit: </span>
                        <strong style={{ color: "#fff" }}>
                          {ownerCapacity.wip?.count} / {ownerCapacity.wip?.limit ?? "—"}
                        </strong>{" "}
                        <span className={`wip-tag badge-wip-${ownerCapacity.wip?.state}`} style={{ fontSize: "9px" }}>
                          {ownerCapacity.wip?.state?.replace("_", " ")}
                        </span>
                      </div>
                      <div>
                        <span>Availability: </span>
                        <strong style={{ color: "#fff" }}>
                          {ownerCapacity.allocation?.availableDaysPerWeek ? `${ownerCapacity.allocation.availableDaysPerWeek} d/wk` : "Unconfigured"}
                        </strong>
                      </div>
                    </div>

                    {ownerCapacity.loadStatus === "overloaded" && (
                      <div style={{ marginTop: "6px", fontSize: "11px", color: "#f87171", display: "flex", alignItems: "center", gap: "4px" }}>
                        ⚠️ Assignee is currently overloaded across project commitments.
                      </div>
                    )}
                  </div>
                )}

                {/* PREREQUISITES SECTION */}
                <div className="inspector-section">
                  <div className="inspector-section-label">
                    <span>Prerequisites (Depends On)</span>
                    <span>{inspectorPrereqs.length}</span>
                  </div>

                  {inspectorPrereqs.length === 0 ? (
                    <p style={{ fontSize: "12px", color: "var(--text-3, #606068)", margin: "8px 0" }}>
                      This task has no prerequisites and is unconstrained.
                    </p>
                  ) : (
                    <div className="dependency-list" style={{ marginTop: "8px" }}>
                      {inspectorPrereqs.map((prereq) => (
                        <div key={prereq.id} className="dependency-row">
                          <div className="dependency-row-info">
                            <span className="dependency-row-title" title={prereq.title}>
                              {prereq.title}
                            </span>
                            <span className="dependency-row-status">
                              <span
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: "50%",
                                  background: prereq.resolved ? "#10b981" : "#f59e0b",
                                  display: "inline-block",
                                }}
                              />
                              {prereq.resolved ? "Resolved (Done)" : `${prereq.status}`}
                            </span>
                          </div>

                          {graphData?.project?.status !== "archived" && (
                            <button
                              type="button"
                              className="btn-remove-dep"
                              onClick={() => handleRemoveDependency(prereq.id)}
                              title="Remove prerequisite dependency"
                              aria-label={`Remove prerequisite ${prereq.title}`}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ADD PREREQUISITE FORM */}
                  {graphData?.project?.status === "archived" ? (
                    <div
                      style={{
                        marginTop: "12px",
                        padding: "8px 12px",
                        background: "rgba(245, 158, 11, 0.1)",
                        borderRadius: "6px",
                        fontSize: "12px",
                        color: "#fbbf24",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <LockIcon size={13} />
                      Modifications are disabled for archived projects.
                    </div>
                  ) : (
                    <form onSubmit={handleAddDependency} className="add-dep-form" style={{ marginTop: "12px" }}>
                      <label htmlFor="select-candidate-prereq" style={{ fontSize: "11px", color: "var(--text-2, #a0a0aa)" }}>
                        Add prerequisite task:
                      </label>
                      <select
                        id="select-candidate-prereq"
                        className="add-dep-select"
                        value={selectedCandidateId}
                        onChange={(e) => setSelectedCandidateId(e.target.value)}
                      >
                        <option value="">Select a task to depend on...</option>
                        {validCandidateTasks.map((t) => (
                          <option key={t._id} value={t._id}>
                            {t.title} ({t.status})
                          </option>
                        ))}
                      </select>

                      <button
                        type="submit"
                        className="btn-add-dep"
                        disabled={!selectedCandidateId || addingDependency}
                      >
                        {addingDependency ? "Adding..." : "+ Add Prerequisite"}
                      </button>
                    </form>
                  )}
                </div>

                {/* DEPENDENTS SECTION */}
                <div className="inspector-section">
                  <div className="inspector-section-label">
                    <span>Dependents (Blocks)</span>
                    <span>{inspectorDependents.length}</span>
                  </div>

                  {inspectorDependents.length === 0 ? (
                    <p style={{ fontSize: "12px", color: "var(--text-3, #606068)", margin: "8px 0" }}>
                      No other tasks depend on this task.
                    </p>
                  ) : (
                    <div className="dependency-list" style={{ marginTop: "8px" }}>
                      {inspectorDependents.map((dep) => (
                        <div key={dep.id} className="dependency-row">
                          <div className="dependency-row-info">
                            <span className="dependency-row-title" title={dep.title}>
                              {dep.title}
                            </span>
                            <span className="dependency-row-status">
                              Status: {dep.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* LINKED ARCHITECTURAL DECISIONS (ADRs) */}
                <div className="inspector-section">
                  <div className="inspector-section-label">
                    <span>Linked Decisions (ADRs)</span>
                    <span>{nodeDecisions.length}</span>
                  </div>

                  {nodeDecisions.length === 0 ? (
                    <p style={{ fontSize: "12px", color: "var(--text-3, #606068)", margin: "8px 0" }}>
                      No architectural decisions linked to this task.
                    </p>
                  ) : (
                    <div className="dependency-list" style={{ marginTop: "8px" }}>
                      {nodeDecisions.map((dec) => (
                        <div
                          key={dec._id}
                          className="dependency-row"
                          onClick={() => setInspectingDecisionId(dec._id)}
                          style={{ cursor: "pointer" }}
                        >
                          <div className="dependency-row-info">
                            <span className="dependency-row-title" title={dec.title}>
                              ⚖ {dec.title}
                            </span>
                            <span className="dependency-row-status">
                              ADR-{dec._id.slice(-4).toUpperCase()} • {dec.status}
                            </span>
                          </div>
                          <span style={{ fontSize: "11px", color: "#a5b4fc" }}>Inspect &rarr;</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ACTIONS */}
                <div className="inspector-actions">
                  <button
                    type="button"
                    className="btn-open-drawer"
                    onClick={() => handleOpenFullTaskDrawer(selectedNode.id)}
                  >
                    Open Full Task Details Drawer →
                  </button>
                </div>
              </div>
            </aside>
          )}
        </div>
      ) : (
        /* ACCESSIBLE TREE / LIST VIEW */
        <div className="graph-list-view">
          {graphData.levels.map((levelTaskIds, lvlIdx) => {
            const visibleIds = levelTaskIds.filter((id) => filteredNodeIds.has(id));
            if (visibleIds.length === 0) return null;

            return (
              <section key={lvlIdx} className="list-level-section">
                <div className="list-level-header">
                  <div className="list-level-title">
                    <span>Stage {lvlIdx}</span>
                    <span className="list-level-subtitle">
                      {lvlIdx === 0
                        ? "Unconstrained Roots • Immediate Execution"
                        : `Level ${lvlIdx} • Sequenced after Stage ${lvlIdx - 1} tasks`}
                    </span>
                  </div>
                  <span className="level-header-badge">{visibleIds.length} tasks</span>
                </div>

                <div className="list-level-cards">
                  {levelTaskIds.map((taskId) => {
                    const node = graphData.nodes.find((n) => n.id === taskId);
                    if (!node || !filteredNodeIds.has(taskId)) return null;

                    const prereqs = graphData.edges
                      .filter((e) => e.target === taskId)
                      .map((e) => graphData.nodes.find((n) => n.id === e.source)?.title)
                      .filter(Boolean);

                    const dependents = graphData.edges
                      .filter((e) => e.source === taskId)
                      .map((e) => graphData.nodes.find((n) => n.id === e.target)?.title)
                      .filter(Boolean);

                    const intelNode = deliveryIntel?.nodes?.[taskId];
                    const isOnCriticalPath = Boolean(
                      intelNode?.criticalPath || (deliveryIntel?.criticalPath && deliveryIntel.criticalPath.includes(taskId))
                    );
                    const isDirectBlocker = Boolean(intelNode?.isDirectBlocker || node.isBlocked);
                    const isPropagatedBlocker = Boolean(intelNode?.isPropagatedBlocker || intelNode?.propagatedBlocked);
                    const downstreamCount = intelNode?.downstreamImpactCount || 0;

                    return (
                      <div
                        key={taskId}
                        className={`graph-node-card state-${node.dependencyState} ${
                          isOnCriticalPath && engineView === "delivery_impact" ? "on-critical-path" : ""
                        } ${
                          isDirectBlocker && engineView === "delivery_impact"
                            ? "direct-blocker"
                            : isPropagatedBlocker && engineView === "delivery_impact"
                            ? "propagated-blocker"
                            : ""
                        }`}
                        onClick={() => setSelectedNodeId(taskId)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedNodeId(taskId);
                          }
                        }}
                      >
                        <div className="node-card-top-row">
                          {engineView === "delivery_impact" && isDirectBlocker ? (
                            <span className="node-state-badge state-blocked" style={{ background: "rgba(239, 68, 68, 0.2)", color: "#f87171", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                              <BlockerIcon size={12} /> Direct Blocker
                            </span>
                          ) : engineView === "delivery_impact" && isPropagatedBlocker ? (
                            <span className="node-state-badge state-blocked_and_waiting" style={{ background: "rgba(249, 115, 22, 0.2)", color: "#fb923c", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                              <WarningIcon size={12} /> Prereq Blocked
                            </span>
                          ) : (
                            <span className={`node-state-badge ${node.dependencyState}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                              {node.dependencyState === "ready" && <><CheckIcon size={11} /> Ready</>}
                              {node.dependencyState === "waiting" && <><ClockIcon size={11} /> Waiting</>}
                              {node.dependencyState === "blocked_and_waiting" && <><WarningIcon size={11} /> Blocked & Waiting</>}
                              {node.dependencyState === "blocked" && <><BlockerIcon size={11} /> Blocked</>}
                              {node.dependencyState === "completed" && <><CheckIcon size={11} /> Done</>}
                            </span>
                          )}

                          {isOnCriticalPath && engineView === "delivery_impact" && (
                            <span className="node-badge-critical" title="On Delivery Critical Path" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                              <CriticalPathIcon size={12} /> Critical Path
                            </span>
                          )}

                          <span className={`node-priority-badge ${node.priority?.toLowerCase()}`}>
                            {node.priority}
                          </span>
                        </div>

                        <div className="node-title">{node.title}</div>

                        {prereqs.length > 0 && (
                          <div style={{ fontSize: "11px", color: "var(--text-2, #a0a0aa)" }}>
                            <strong>Depends On ({prereqs.length}):</strong> {prereqs.join(", ")}
                          </div>
                        )}

                        {dependents.length > 0 && (
                          <div style={{ fontSize: "11px", color: "var(--text-2, #a0a0aa)" }}>
                            <strong>Blocks ({dependents.length}):</strong> {dependents.join(", ")}
                          </div>
                        )}

                        <div className="node-card-footer">
                          <span>Status: <strong>{node.status}</strong></span>
                          {engineView === "delivery_impact" && downstreamCount > 0 && (
                            <span className="deps-pill impact-pill" style={{ color: "#f59e0b", borderColor: "rgba(245, 158, 11, 0.3)", display: "inline-flex", alignItems: "center", gap: "3px" }}>
                              <ImpactIcon size={11} /> Impacts {downstreamCount}
                            </span>
                          )}
                          {engineView === "delivery_impact" && intelNode?.estimateDays != null && (
                            <span className="deps-pill estimate-pill" style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                              <ClockIcon size={11} /> {intelNode.estimateDays}d
                            </span>
                          )}
                          {node.assignedTo && (
                            <span className="node-assignee">
                              <span className="node-avatar-chip">
                                {node.assignedTo.name.charAt(0).toUpperCase()}
                              </span>
                              {node.assignedTo.name}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* FULL TASK DRAWER INTEGRATION */}
      {activeTaskForDrawer && (
        <TaskDrawer
          task={activeTaskForDrawer}
          onClose={() => {
            setActiveTaskForDrawer(null);
            fetchGraph();
            fetchDeliveryIntel();
          }}
          onUpdateTask={async (taskId, updates) => {
            const res = await api.put(`/tasks/${taskId}`, updates);
            fetchGraph();
            fetchDeliveryIntel();
            return res.data.task;
          }}
          onAddComment={async (taskId, text) => {
            const res = await api.post(`/tasks/${taskId}/comments`, { text });
            return res.data.comments;
          }}
          onDeleteTask={async (taskId) => {
            await api.delete(`/tasks/${taskId}`);
            setActiveTaskForDrawer(null);
            fetchGraph();
            fetchDeliveryIntel();
          }}
          canDelete={user?.role === "admin" || user?.role === "manager"}
        />
      )}

      {/* DECISION DRAWER INTEGRATION */}
      {inspectingDecisionId && (
        <DecisionDrawer
          decisionId={inspectingDecisionId}
          onClose={() => setInspectingDecisionId(null)}
        />
      )}
    </div>
  );
}
