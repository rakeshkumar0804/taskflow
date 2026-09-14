import React, { useState, useEffect, useCallback, useMemo } from "react";
import "./CommandCenterPreview.css";
import {
  PREVIEW_META,
  PREVIEW_PROJECTS,
  PREVIEW_RELEASES,
  PREVIEW_MILESTONES,
  PREVIEW_TASKS,
  PREVIEW_ATTENTION_QUEUE,
  PREVIEW_DEPENDENCY_SIGNAL,
  PREVIEW_FLOW_HEALTH,
  PREVIEW_TODAY_EXECUTION,
  PREVIEW_ACTIVITY,
  PREVIEW_DECISION_RECORD,
  PREVIEW_SUPPORTING_METRICS,
  PREVIEW_COMMAND_ITEMS,
} from "./previewData";

// Clean, consistent local SVG icons (Zero external dependencies)
const Icons = {
  Hex: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    </svg>
  ),
  Execution: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  Project: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  ),
  Release: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-3.05 11a22.35 22.35 0 0 1-3.95 2z" />
    </svg>
  ),
  Graph: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  ),
  Decision: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="M7 21h10" />
      <path d="M12 3v18" />
      <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
    </svg>
  ),
  Activity: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  Team: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  Blocker: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  ),
  AlertTriangle: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  Clock: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  Check: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Search: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  Bell: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  ),
  Plus: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  ArrowRight: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  ),
  ArrowDown: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  ),
  Menu: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
};

export default function CommandCenterPreview() {
  // Navigation rail state
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeNavItem, setActiveNavItem] = useState("Command Center");

  // Operational data state
  const [attentionQueue, setAttentionQueue] = useState(PREVIEW_ATTENTION_QUEUE);
  const [todayExecution, setTodayExecution] = useState(PREVIEW_TODAY_EXECUTION);
  const [releases, setReleases] = useState(PREVIEW_RELEASES);
  const [selectedAttentionItem, setSelectedAttentionItem] = useState(null);
  const [selectedRelease, setSelectedRelease] = useState(null);
  const [isDecisionModalOpen, setIsDecisionModalOpen] = useState(false);

  // Modals & Overlays state
  const [isSearchPaletteOpen, setIsSearchPaletteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isHealthModalOpen, setIsHealthModalOpen] = useState(false);
  const [isQuickCreateOpen, setIsQuickCreateOpen] = useState(false);
  const [quickCreateTab, setQuickCreateTab] = useState("task"); // 'task' | 'milestone' | 'decision'
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Quick Create Form States
  // 1. Task form
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskProject, setNewTaskProject] = useState("Core Engine v3.2");
  const [newTaskPriority, setNewTaskPriority] = useState("high");
  const [newTaskDueDate, setNewTaskDueDate] = useState("Due in 3d");
  const [newTaskDesc, setNewTaskDesc] = useState("");

  // 2. Milestone form
  const [newMilestoneTitle, setNewMilestoneTitle] = useState("");
  const [newMilestoneRelease, setNewMilestoneRelease] = useState("v3.2.0-GA Core Gateway");
  const [newMilestoneDueDate, setNewMilestoneDueDate] = useState("Oct 08");

  // 3. Decision form
  const [newDecisionTitle, setNewDecisionTitle] = useState("");
  const [newDecisionRationale, setNewDecisionRationale] = useState("");
  const [newDecisionRelease, setNewDecisionRelease] = useState("v3.2.0-GA Core Gateway");

  // Format contextual date & time label
  const briefingDateLabel = useMemo(() => {
    const today = new Date();
    const days = [
      "SUNDAY",
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
    ];
    const months = [
      "JANUARY",
      "FEBRUARY",
      "MARCH",
      "APRIL",
      "MAY",
      "JUNE",
      "JULY",
      "AUGUST",
      "SEPTEMBER",
      "OCTOBER",
      "NOVEMBER",
      "DECEMBER",
    ];
    const dayName = days[today.getDay()];
    const monthName = months[today.getMonth()];
    const dateNum = today.getDate();
    return `${dayName}, ${monthName} ${dateNum} · 09:42 UTC · EXECUTION BRIEFING`;
  }, []);

  // Quick Toast Helper
  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  // Keyboard shortcut listener: Ctrl+K / Cmd+K and Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+K or Cmd+K opens Command Palette
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setIsSearchPaletteOpen((prev) => !prev);
      }
      // Escape closes any open modal or drawer
      if (e.key === "Escape") {
        setIsSearchPaletteOpen(false);
        setIsHealthModalOpen(false);
        setIsQuickCreateOpen(false);
        setIsNotificationsOpen(false);
        setSelectedAttentionItem(null);
        setSelectedRelease(null);
        setIsDecisionModalOpen(false);
        setMobileNavOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Toggle task completion in Today's Execution
  const toggleTaskCompletion = (taskId) => {
    setTodayExecution((prev) =>
      prev.map((t) => {
        if (t.id === taskId) {
          const nextCompleted = !t.completed;
          showToast(
            nextCompleted
              ? `Task marked complete: "${t.title.slice(0, 30)}..."`
              : `Task reopened: "${t.title.slice(0, 30)}..."`
          );
          return {
            ...t,
            completed: nextCompleted,
            status: nextCompleted ? "Done" : "In Progress",
          };
        }
        return t;
      })
    );
  };

  // Submit Quick Create - Task
  const handleCreateTask = (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    const newTask = {
      id: `tsk-${Date.now()}`,
      title: newTaskTitle.trim(),
      project: newTaskProject,
      projectColor:
        newTaskProject.includes("Core")
          ? "#8b5cf6"
          : newTaskProject.includes("Billing")
          ? "#ec4899"
          : "#3b82f6",
      priority: newTaskPriority,
      status: "In Progress",
      dueState: newTaskDueDate || "Due Today",
      isOverdue: false,
      recommendedAction: newTaskDesc || "Initial triage and scope review required",
      assignee: {
        name: PREVIEW_META.currentUser.name,
        initials: PREVIEW_META.currentUser.initials,
      },
      completed: false,
    };

    setTodayExecution((prev) => [newTask, ...prev]);
    setNewTaskTitle("");
    setNewTaskDesc("");
    setIsQuickCreateOpen(false);
    showToast(`Created task: "${newTask.title}"`);
  };

  // Submit Quick Create - Milestone
  const handleCreateMilestone = (e) => {
    e.preventDefault();
    if (!newMilestoneTitle.trim()) return;

    showToast(`Created milestone: "${newMilestoneTitle}" in ${newMilestoneRelease}`);
    setNewMilestoneTitle("");
    setIsQuickCreateOpen(false);
  };

  // Submit Quick Create - Decision Record
  const handleCreateDecision = (e) => {
    e.preventDefault();
    if (!newDecisionTitle.trim()) return;

    showToast(`Recorded Decision DR-${Math.floor(100 + Math.random() * 900)}: "${newDecisionTitle}"`);
    setNewDecisionTitle("");
    setNewDecisionRationale("");
    setIsQuickCreateOpen(false);
  };

  // Resolve or unblock attention item
  const handleResolveAttentionItem = (item) => {
    setAttentionQueue((prev) => prev.filter((i) => i.id !== item.id));
    setSelectedAttentionItem(null);
    showToast(`Cleared from Attention Queue: "${item.title.slice(0, 30)}..."`);
  };

  // Self-assign unassigned item
  const handleSelfAssign = (item) => {
    setAttentionQueue((prev) =>
      prev.map((i) => {
        if (i.id === item.id) {
          return {
            ...i,
            owner: {
              name: PREVIEW_META.currentUser.name,
              initials: PREVIEW_META.currentUser.initials,
            },
            reason: `Assigned to ${PREVIEW_META.currentUser.name} · Triage active`,
            impactMetric: "Assigned",
          };
        }
        return i;
      })
    );
    setSelectedAttentionItem((prev) =>
      prev && prev.id === item.id
        ? {
            ...prev,
            owner: {
              name: PREVIEW_META.currentUser.name,
              initials: PREVIEW_META.currentUser.initials,
            },
          }
        : prev
    );
    showToast(`Assigned "${item.title.slice(0, 26)}..." to ${PREVIEW_META.currentUser.name}`);
  };

  // Handle Attention Queue primary action click
  const handleAttentionActionClick = (item, e) => {
    e.stopPropagation();
    if (item.actionType === "inspect_release") {
      const targetRel = releases.find((r) => r.name.includes("v3.2.0-GA")) || releases[0];
      setSelectedRelease(targetRel);
    } else if (item.actionType === "assign_owner") {
      handleSelfAssign(item);
    } else {
      setSelectedAttentionItem(item);
    }
  };

  // Filtered command items for Ctrl+K palette
  const filteredCommands = useMemo(() => {
    if (!searchQuery.trim()) return PREVIEW_COMMAND_ITEMS;
    const q = searchQuery.toLowerCase();
    return PREVIEW_COMMAND_ITEMS.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  // Navigation rail items definition with local SVG icons
  const navRailItems = useMemo(
    () => [
      { id: "Command Center", icon: <Icons.Hex />, label: "Command Center" },
      { id: "My Execution", icon: <Icons.Execution />, label: "My Execution" },
      { id: "Projects", icon: <Icons.Project />, label: "Projects" },
      { id: "Releases", icon: <Icons.Release />, label: "Releases" },
      { id: "Execution Graph", icon: <Icons.Graph />, label: "Execution Graph" },
      { id: "Decisions", icon: <Icons.Decision />, label: "Decisions" },
      { id: "Activity", icon: <Icons.Activity />, label: "Activity" },
      { id: "Team Capacity", icon: <Icons.Team />, label: "Team Capacity" },
    ],
    []
  );

  return (
    <div className="cc-app-shell">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="cc-toast" role="status" aria-live="polite">
          <span className="cc-toast-icon"><Icons.Check /></span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 1. COLLAPSIBLE NAVIGATION RAIL (8 Items) */}
      <aside
        className={`cc-nav-rail ${isRailCollapsed ? "collapsed" : ""} ${
          mobileNavOpen ? "mobile-open" : ""
        }`}
        aria-label="Workspace Navigation"
      >
        <div className="cc-rail-header">
          <a href="#overview" className="cc-rail-logo" title="TaskFlow Delivery Intelligence">
            <span className="cc-logo-hex">
              <Icons.Hex />
            </span>
            {!isRailCollapsed && (
              <>
                <span>TaskFlow</span>
                <span className="cc-preview-badge">PREVIEW</span>
              </>
            )}
          </a>
          <button
            type="button"
            className="cc-rail-toggle-btn"
            onClick={() => setIsRailCollapsed((prev) => !prev)}
            title={isRailCollapsed ? "Expand navigation rail" : "Collapse navigation rail"}
            aria-label={isRailCollapsed ? "Expand navigation rail" : "Collapse navigation rail"}
          >
            {isRailCollapsed ? "⇥" : "⇤"}
          </button>
        </div>

        <nav className="cc-rail-nav">
          {navRailItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`cc-nav-item ${activeNavItem === item.id ? "active" : ""}`}
              onClick={() => {
                setActiveNavItem(item.id);
                setMobileNavOpen(false);
                if (item.id === "Releases") {
                  setSelectedRelease(releases[0]);
                } else if (item.id === "Decisions") {
                  setIsDecisionModalOpen(true);
                } else if (item.id === "Execution Graph") {
                  const el = document.getElementById("dependency-signal-panel");
                  if (el) el.scrollIntoView({ behavior: "smooth" });
                }
              }}
              title={item.label}
            >
              <span className="cc-nav-icon">{item.icon}</span>
              {!isRailCollapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="cc-rail-footer">
          <div className="cc-system-status" title="Local simulated preview environment">
            <span className="cc-status-pulse-dot preview" />
            {!isRailCollapsed && <span>PREVIEW SYS · LOCAL DATA</span>}
          </div>
        </div>
      </aside>

      {/* Mobile nav backdrop */}
      {mobileNavOpen && (
        <div
          className="cc-overlay-backdrop"
          onClick={() => setMobileNavOpen(false)}
          style={{ zIndex: 45 }}
        />
      )}

      {/* MAIN CONTAINER */}
      <div className="cc-main-container">
        {/* TOP COMMAND BAR */}
        <header className="cc-top-bar">
          <div className="cc-bar-left">
            <button
              type="button"
              className="cc-mobile-menu-trigger"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open mobile navigation"
            >
              <Icons.Menu />
            </button>
            <div className="cc-breadcrumb">
              <span className="cc-crumb-part">TaskFlow</span>
              <span className="cc-crumb-sep">/</span>
              <span className="cc-crumb-part">Engineering Intelligence</span>
              <span className="cc-crumb-sep">/</span>
              <span className="active">Command Center</span>
            </div>
          </div>

          <div className="cc-bar-center">
            <button
              type="button"
              className="cc-search-trigger-btn"
              onClick={() => setIsSearchPaletteOpen(true)}
              aria-label="Open command palette"
            >
              <span className="cc-search-hint">
                <Icons.Search />
                <span>Search tasks, projects, actions...</span>
              </span>
              <span className="cc-kbd-shortcut">Ctrl K</span>
            </button>
          </div>

          <div className="cc-bar-right">
            {/* Mobile Search Trigger Icon Button */}
            <button
              type="button"
              className="cc-mobile-search-btn"
              onClick={() => setIsSearchPaletteOpen(true)}
              aria-label="Search command palette"
              title="Search command palette"
            >
              <Icons.Search />
            </button>

            <button
              type="button"
              className="cc-btn-quick-create"
              onClick={() => {
                setQuickCreateTab("task");
                setIsQuickCreateOpen(true);
              }}
              aria-label="Quick create task or record"
            >
              <Icons.Plus />
              <span className="cc-create-label-desktop">Quick Create</span>
              <span className="cc-create-label-mobile">Create</span>
            </button>

            <button
              type="button"
              className="cc-btn-icon"
              onClick={() => setIsNotificationsOpen((prev) => !prev)}
              aria-label="View system alerts"
            >
              <Icons.Bell />
              <span className="cc-badge-count">3</span>
            </button>

            <div
              className="cc-user-profile-menu"
              title={`Signed in as ${PREVIEW_META.currentUser.name} (${PREVIEW_META.currentUser.role})`}
            >
              <div className="cc-user-avatar" style={{ backgroundColor: PREVIEW_META.currentUser.avatarColor }}>
                {PREVIEW_META.currentUser.initials}
              </div>
              <span className="cc-user-role-tag">Lead</span>
            </div>
          </div>
        </header>

        {/* MAIN VIEWPORT CONTENT */}
        <main className="cc-main-content">
          {/* 2. EXECUTION BRIEFING HEADER */}
          <section className="cc-briefing-header" aria-labelledby="briefing-title">
            <div className="cc-briefing-text-group">
              <div className="cc-briefing-context-label">{briefingDateLabel}</div>
              <h1 id="briefing-title" className="cc-briefing-heading">
                Good morning, {PREVIEW_META.currentUser.greetingName}
              </h1>
              <div className="cc-briefing-subtext">
                <span className="cc-badge-environment" title="Isolated client-side design preview">
                  {PREVIEW_META.badgeLabel}
                </span>
                <span className="cc-signal-pill risk" title="Active blockers causing downstream delay">
                  <span className="cc-pill-icon"><Icons.Blocker /></span>
                  <span>1 Blocker Propagating (+4d slip)</span>
                </span>
                <span className="cc-signal-pill risk" title="Target release has critical path risk">
                  <span className="cc-pill-icon"><Icons.Release /></span>
                  <span>1 Release At Risk (v3.2.0-GA)</span>
                </span>
                <span className="cc-signal-pill health" title="Overall velocity score">
                  <span className="cc-pill-icon"><Icons.Hex /></span>
                  <span>Flow Health: {PREVIEW_FLOW_HEALTH.score} STABLE</span>
                </span>
              </div>
            </div>

            <div className="cc-briefing-actions">
              <button
                type="button"
                className="cc-btn-secondary"
                onClick={() => {
                  const el = document.getElementById("attention-panel");
                  if (el) el.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <Icons.Search />
                <span>Review Risks ({attentionQueue.length})</span>
              </button>
              <button
                type="button"
                className="cc-btn-secondary"
                onClick={() => {
                  const blockerItem = attentionQueue.find((i) => i.id === "att-1") || attentionQueue[0];
                  setSelectedAttentionItem(blockerItem);
                }}
              >
                <Icons.Blocker />
                <span>Inspect Blocker</span>
              </button>
              {/* Desktop-only Quick Create to avoid redundancy on mobile */}
              <button
                type="button"
                className="cc-btn-primary cc-briefing-create-btn"
                onClick={() => {
                  setQuickCreateTab("task");
                  setIsQuickCreateOpen(true);
                }}
              >
                <Icons.Plus />
                <span>Quick Create</span>
              </button>
            </div>
          </section>

          {/* 7. SUPPORTING METRICS STRIP (Compact Supporting Indicators) */}
          <section className="cc-metrics-strip" aria-label="Operational throughput summary">
            <div className="cc-metric-cell">
              <span className="cc-metric-label">Active Tasks</span>
              <span className="cc-metric-value">{PREVIEW_SUPPORTING_METRICS.activeWork}</span>
            </div>
            <div className="cc-metric-cell">
              <span className="cc-metric-label">In Progress</span>
              <span className="cc-metric-value highlight">7</span>
            </div>
            <div className="cc-metric-cell">
              <span className="cc-metric-label">Critical Path</span>
              <span className="cc-metric-value warning">3</span>
            </div>
            <div className="cc-metric-cell">
              <span className="cc-metric-label">Blocked Downstream</span>
              <span className="cc-metric-value risk">2</span>
            </div>
            <div className="cc-metric-cell">
              <span className="cc-metric-label">WIP Pressure</span>
              <span className="cc-metric-value purple">
                {PREVIEW_SUPPORTING_METRICS.wipPressure}
              </span>
            </div>
            <div className="cc-metric-cell">
              <span className="cc-metric-label">Completed (Recent)</span>
              <span className="cc-metric-value positive">
                {PREVIEW_SUPPORTING_METRICS.completedRecent}
              </span>
            </div>
          </section>

          {/* 3. PRIMARY OPERATIONAL AREA (Two Columns) */}
          <div className="cc-operational-grid">
            {/* Left Column: ATTENTION QUEUE (Primary Visual Focus - 5 Distinct Items) */}
            <section
              id="attention-panel"
              className="cc-panel"
              aria-labelledby="attention-heading"
            >
              <div className="cc-panel-header">
                <div className="cc-panel-title-wrap">
                  <h2 id="attention-heading" className="cc-panel-title">
                    <span>Attention Queue</span>
                    <span className="cc-count-pill">{attentionQueue.length}</span>
                  </h2>
                </div>
                <span className="cc-panel-meta">Ranked by blocker impact & delivery risk</span>
              </div>

              <div className="cc-queue-list">
                {attentionQueue.length === 0 ? (
                  <div className="cc-queue-empty">
                    <Icons.Check /> No active blockers or overdue tasks in queue. All signals optimal.
                  </div>
                ) : (
                  attentionQueue.map((item) => (
                    <div
                      key={item.id}
                      className="cc-queue-item"
                      tabIndex={0}
                      role="button"
                      onClick={() => {
                        if (item.actionType === "inspect_release") {
                          const targetRel = releases.find((r) => r.name.includes("v3.2.0-GA")) || releases[0];
                          setSelectedRelease(targetRel);
                        } else {
                          setSelectedAttentionItem(item);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (item.actionType === "inspect_release") {
                            setSelectedRelease(releases[0]);
                          } else {
                            setSelectedAttentionItem(item);
                          }
                        }
                      }}
                      aria-label={`Inspect ${item.title}: ${item.reason}`}
                    >
                      <span className={`cc-queue-severity-bar ${item.severity}`} />

                      <div className="cc-queue-main-block">
                        {/* Line 1: Title and Project Tag */}
                        <div className="cc-queue-title-row">
                          <span className="cc-queue-title">{item.title}</span>
                          <span
                            className="cc-tag-project"
                            style={{
                              borderColor: `${item.projectColor}55`,
                              color: item.projectColor,
                            }}
                          >
                            {item.project}
                          </span>
                        </div>

                        {/* Line 2: Reason Row */}
                        <div className="cc-queue-reason-row">
                          <span className={`cc-badge-reason ${item.severity}`}>
                            {item.severity === "critical" && <span className="cc-reason-icon"><Icons.Blocker /></span>}
                            {item.type === "overdue_critical" && <span className="cc-reason-icon"><Icons.Clock /></span>}
                            {item.type === "release_risk" && <span className="cc-reason-icon"><Icons.Release /></span>}
                            {item.type === "unassigned_critical" && <span className="cc-reason-icon"><Icons.AlertTriangle /></span>}
                            {item.type === "stale_in_progress" && <span className="cc-reason-icon"><Icons.Clock /></span>}
                            <span>{item.reason}</span>
                          </span>
                        </div>

                        {/* Line 3: Meta items (Pill, Owner, Due) */}
                        <div className="cc-queue-meta-row">
                          <span
                            className={`cc-impact-metric-pill ${item.severity}`}
                            title={item.impactDetail}
                          >
                            {item.impactMetric}
                          </span>

                          <div className="cc-owner-chip" title={`Owner: ${item.owner.name}`}>
                            <span className="cc-owner-avatar">{item.owner.initials}</span>
                            <span>{item.owner.name.split(" ")[0]}</span>
                          </div>

                          <span className={`cc-due-state ${item.type === "overdue_critical" ? "overdue" : ""}`}>
                            {item.dueLabel}
                          </span>
                        </div>
                      </div>

                      {/* Line 4 / Right: Action Button */}
                      <div className="cc-queue-action-block">
                        <button
                          type="button"
                          className="cc-btn-queue-action"
                          onClick={(e) => handleAttentionActionClick(item, e)}
                          title={`Action: ${item.primaryActionLabel}`}
                        >
                          <span>{item.primaryActionLabel}</span>
                          <Icons.ArrowRight />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Right Column: FLOW HEALTH SIGNATURE PANEL */}
            <section className="cc-panel" aria-labelledby="flow-health-heading">
              <div className="cc-panel-header">
                <div className="cc-panel-title-wrap">
                  <h2 id="flow-health-heading" className="cc-panel-title">
                    <span>Flow Health</span>
                  </h2>
                </div>
                <span className="cc-panel-meta">Velocity Score</span>
              </div>

              <div className="cc-health-panel-body">
                <div className="cc-health-score-row">
                  <div className="cc-health-number-group">
                    <span className="cc-health-number">{PREVIEW_FLOW_HEALTH.score}</span>
                    <span className="cc-health-total">/100</span>
                  </div>
                  <div className="cc-health-label-wrap">
                    <span className="cc-health-label-badge">{PREVIEW_FLOW_HEALTH.label}</span>
                    <span className="cc-health-metric-subtext">
                      {PREVIEW_FLOW_HEALTH.activeTasks} tasks · {PREVIEW_FLOW_HEALTH.activeProjects} projects · {PREVIEW_FLOW_HEALTH.activeMembers} engineers
                    </span>
                  </div>
                </div>

                {/* Sleek Progress Meter with Multi-Zone Indicator */}
                <div className="cc-health-meter">
                  <div
                    className="cc-meter-track"
                    role="progressbar"
                    aria-valuenow={PREVIEW_FLOW_HEALTH.score}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="cc-meter-fill"
                      style={{ width: `${PREVIEW_FLOW_HEALTH.score}%` }}
                    />
                  </div>
                  <div className="cc-meter-scale">
                    <span>0 Critical</span>
                    <span>50 At Risk</span>
                    <span className="scale-stable">75 Stable</span>
                    <span>90+ Optimal</span>
                  </div>
                </div>

                {/* Top Friction Drivers */}
                <div className="cc-penalties-section">
                  <div className="cc-penalties-heading">Top Friction Drivers</div>
                  {PREVIEW_FLOW_HEALTH.penalties.map((pen, idx) => (
                    <div key={idx} className="cc-penalty-item">
                      <div className="cc-penalty-left">
                        <span className="cc-penalty-bullet">•</span>
                        <span>{pen.label}</span>
                      </div>
                      <span className="cc-penalty-deduction">-{pen.points} pts</span>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className="cc-btn-view-breakdown"
                  onClick={() => setIsHealthModalOpen(true)}
                >
                  <span>View Health Breakdown & Calculation</span>
                  <Icons.ArrowRight />
                </button>
              </div>
            </section>
          </div>

          {/* 9. DEPENDENCY SIGNAL (Inline Blocker Propagation Flow) */}
          <section
            id="dependency-signal-panel"
            className="cc-panel cc-dep-signal-panel"
            aria-labelledby="dep-heading"
          >
            <div className="cc-panel-header">
              <div className="cc-panel-title-wrap">
                <h2 id="dep-heading" className="cc-panel-title">
                  <span>Dependency Signal</span>
                  <span className="cc-count-pill risk">
                    1 Active Chain
                  </span>
                </h2>
              </div>
              <span className="cc-panel-meta">Inline Blocker Propagation Graph</span>
            </div>

            <div className="cc-dep-chain-flow">
              {/* Node 1: Blocked Upstream Task */}
              <div
                className="cc-dep-node blocked"
                tabIndex={0}
                role="button"
                onClick={() => {
                  const item = attentionQueue.find((i) => i.id === "att-1") || attentionQueue[0];
                  setSelectedAttentionItem(item);
                }}
              >
                <span className="cc-dep-node-type">
                  <Icons.Blocker /> Blocked Upstream
                </span>
                <span className="cc-dep-node-title">{PREVIEW_DEPENDENCY_SIGNAL.upstreamTask.title}</span>
                <span className="cc-dep-node-meta">
                  {PREVIEW_DEPENDENCY_SIGNAL.upstreamTask.project} · {PREVIEW_DEPENDENCY_SIGNAL.upstreamTask.owner}
                </span>
              </div>

              <div className="cc-dep-arrow desktop-arrow"><Icons.ArrowRight /></div>
              <div className="cc-dep-arrow mobile-arrow"><Icons.ArrowDown /></div>

              {/* Node 2: Dependent Tasks */}
              <div className="cc-dep-node affected">
                <span className="cc-dep-node-type">
                  <Icons.Execution /> 2 Downstream Tasks
                </span>
                <span className="cc-dep-node-title">Session Store Benchmarking & VPC Peering</span>
                <span className="cc-dep-node-meta">Sarah Jenkins & Alex Rivera (Waiting)</span>
              </div>

              <div className="cc-dep-arrow desktop-arrow"><Icons.ArrowRight /></div>
              <div className="cc-dep-arrow mobile-arrow"><Icons.ArrowDown /></div>

              {/* Node 3: Affected Milestone */}
              <div className="cc-dep-node affected">
                <span className="cc-dep-node-type">
                  <Icons.Project /> Affected Milestone
                </span>
                <span className="cc-dep-node-title">{PREVIEW_DEPENDENCY_SIGNAL.affectedMilestone.title}</span>
                <span className="cc-dep-node-meta warning-text">
                  {PREVIEW_DEPENDENCY_SIGNAL.affectedMilestone.projectedDelay} (Target: {PREVIEW_DEPENDENCY_SIGNAL.affectedMilestone.dueDate})
                </span>
              </div>

              <div className="cc-dep-arrow desktop-arrow"><Icons.ArrowRight /></div>
              <div className="cc-dep-arrow mobile-arrow"><Icons.ArrowDown /></div>

              {/* Node 4: Impacted Release */}
              <div
                className="cc-dep-node impact"
                tabIndex={0}
                role="button"
                onClick={() => {
                  const targetRel = releases.find((r) => r.name.includes("v3.2.0-GA")) || releases[0];
                  setSelectedRelease(targetRel);
                }}
              >
                <span className="cc-dep-node-type">
                  <Icons.Release /> Impacted Release
                </span>
                <span className="cc-dep-node-title">{PREVIEW_DEPENDENCY_SIGNAL.impactedRelease.title}</span>
                <span className="cc-dep-node-meta risk-text">
                  {PREVIEW_DEPENDENCY_SIGNAL.impactedRelease.readinessImpact}
                </span>
              </div>
            </div>

            <div className="cc-dep-footer">
              <span className="cc-dep-summary-text">{PREVIEW_DEPENDENCY_SIGNAL.summary}</span>
              <button
                type="button"
                className="cc-btn-text-link"
                onClick={() => setIsDecisionModalOpen(true)}
              >
                <span>View Decision Record DR-014 (Decouple Dependency)</span>
                <Icons.ArrowRight />
              </button>
            </div>
          </section>

          {/* 4 & 5. SECONDARY OPERATIONAL AREA: TODAY'S EXECUTION & RELEASE PULSE */}
          <div className="cc-secondary-grid">
            {/* Left: TODAY'S EXECUTION QUEUE */}
            <section className="cc-panel" aria-labelledby="focus-heading">
              <div className="cc-panel-header">
                <div className="cc-panel-title-wrap">
                  <h2 id="focus-heading" className="cc-panel-title">
                    <span>Today’s Execution</span>
                    <span className="cc-count-pill">
                      {todayExecution.filter((t) => !t.completed).length} active
                    </span>
                  </h2>
                </div>
                <span className="cc-panel-meta">Personal actionable focus queue</span>
              </div>

              <div className="cc-focus-list">
                {todayExecution.map((task) => (
                  <div
                    key={task.id}
                    className={`cc-focus-row ${task.completed ? "completed" : ""}`}
                  >
                    <div className="cc-focus-left">
                      <button
                        type="button"
                        className={`cc-checkbox-btn ${task.completed ? "checked" : ""}`}
                        onClick={() => toggleTaskCompletion(task.id)}
                        aria-label={task.completed ? `Reopen task ${task.title}` : `Complete task ${task.title}`}
                      >
                        {task.completed && <Icons.Check />}
                      </button>

                      <span
                        className={`cc-priority-dot ${task.priority}`}
                        title={`Priority: ${task.priority}`}
                      />

                      <div className="cc-focus-title-wrap">
                        <div className="cc-focus-title-line">
                          <span className="cc-focus-title">{task.title}</span>
                          <span
                            className="cc-tag-project"
                            style={{
                              borderColor: `${task.projectColor}55`,
                              color: task.projectColor,
                            }}
                          >
                            {task.project}
                          </span>
                        </div>
                        {task.recommendedAction && (
                          <div className="cc-recommended-action-text">
                            <span>↳</span>
                            <span>{task.recommendedAction}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="cc-focus-right">
                      <span className={`cc-status-badge ${task.status.toLowerCase().replace(" ", "-")}`}>
                        {task.status}
                      </span>
                      <span
                        className={`cc-due-state ${task.isOverdue ? "overdue" : ""}`}
                      >
                        {task.dueState}
                      </span>
                      <div
                        className="cc-owner-avatar"
                        title={`Assigned to ${task.assignee.name}`}
                      >
                        {task.assignee.initials}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Right: RELEASE PULSE (2 Upcoming Releases) */}
            <section className="cc-panel" aria-labelledby="pulse-heading">
              <div className="cc-panel-header">
                <div className="cc-panel-title-wrap">
                  <h2 id="pulse-heading" className="cc-panel-title">
                    <span>Release Pulse</span>
                    <span className="cc-count-pill">{releases.length} upcoming</span>
                  </h2>
                </div>
                <span className="cc-panel-meta">Milestones & Readiness</span>
              </div>

              <div className="cc-release-grid">
                {releases.map((rel) => (
                  <div
                    key={rel.id}
                    className="cc-release-card"
                    tabIndex={0}
                    role="button"
                    onClick={() => setSelectedRelease(rel)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedRelease(rel);
                      }
                    }}
                    aria-label={`Inspect Release ${rel.name}`}
                  >
                    <div className="cc-release-card-top">
                      <div className="cc-release-name">
                        <Icons.Release />
                        <span>{rel.name}</span>
                      </div>
                      <span className={`cc-release-status-badge ${rel.readinessType}`}>
                        {rel.readinessStatus} ({rel.readinessScore}%)
                      </span>
                    </div>

                    <div className="cc-readiness-meter-wrap">
                      <div className="cc-readiness-bar">
                        <div
                          className={`cc-readiness-fill ${
                            rel.readinessScore >= 90 ? "optimal" : "at-risk"
                          }`}
                          style={{ width: `${rel.readinessScore}%` }}
                        />
                      </div>
                      <div className="cc-release-meta-row">
                        <span>
                          {rel.milestonesComplete}/{rel.milestoneCount} milestones complete
                        </span>
                        <span>{rel.targetLabel}</span>
                      </div>
                    </div>

                    {rel.blockedTaskCount > 0 ? (
                      <div className="cc-release-risk-callout">
                        <strong className="warning-text">Risk:</strong>{" "}
                        {rel.criticalPathRisk} (+{rel.projectedDelayDays}d delay)
                      </div>
                    ) : (
                      <div
                        className="cc-release-risk-callout positive"
                      >
                        <strong className="positive-text">Status:</strong>{" "}
                        {rel.criticalPathRisk}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* 6. RECENT EXECUTION ACTIVITY TIMELINE */}
          <section className="cc-panel cc-activity-panel" aria-labelledby="activity-heading">
            <div className="cc-panel-header">
              <div className="cc-panel-title-wrap">
                <h2 id="activity-heading" className="cc-panel-title">
                  <span>Recent Execution Activity</span>
                </h2>
              </div>
              <span className="cc-panel-meta">Last 6 hours of project signals</span>
            </div>

            <div className="cc-activity-timeline">
              {PREVIEW_ACTIVITY.map((act) => (
                <div key={act.id} className="cc-activity-row">
                  <span className={`cc-activity-dot ${act.type}`} />
                  <div className="cc-activity-content">
                    <div className="cc-activity-text">
                      <span className="cc-activity-user">{act.user}</span>{" "}
                      <span>{act.action}</span>{" "}
                      <span className="cc-activity-target">{act.target}</span>
                      {act.detail && (
                        <span className="cc-activity-detail">"{act.detail}"</span>
                      )}
                    </div>
                    <span className="cc-activity-time">{act.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>

      {/* OVERLAY 1: COMMAND PALETTE (Ctrl+K) */}
      {isSearchPaletteOpen && (
        <div
          className="cc-overlay-backdrop"
          onClick={() => setIsSearchPaletteOpen(false)}
        >
          <div
            className="cc-palette-container"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Command Search Palette"
          >
            <div className="cc-palette-search-box">
              <span className="cc-palette-search-icon"><Icons.Search /></span>
              <input
                type="text"
                autoFocus
                className="cc-palette-input"
                placeholder="Type a command, project, or task search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <span className="cc-kbd-shortcut">ESC</span>
            </div>
            <div className="cc-palette-results">
              {filteredCommands.length === 0 ? (
                <div className="cc-palette-empty">
                  No matching commands or resources found.
                </div>
              ) : (
                filteredCommands.map((cmd) => (
                  <button
                    key={cmd.id}
                    type="button"
                    className="cc-palette-item"
                    onClick={() => {
                      showToast(`Triggered: ${cmd.label}`);
                      setIsSearchPaletteOpen(false);
                      if (cmd.id === "cmd-1") {
                        setQuickCreateTab("task");
                        setIsQuickCreateOpen(true);
                      }
                      if (cmd.id === "cmd-2") {
                        setQuickCreateTab("milestone");
                        setIsQuickCreateOpen(true);
                      }
                      if (cmd.id === "cmd-3") {
                        setQuickCreateTab("decision");
                        setIsQuickCreateOpen(true);
                      }
                      if (cmd.id === "cmd-4") {
                        setSelectedAttentionItem(attentionQueue[0]);
                      }
                      if (cmd.id === "cmd-5") {
                        setIsHealthModalOpen(true);
                      }
                      if (cmd.id === "cmd-6") {
                        setSelectedRelease(releases[0]);
                      }
                      if (cmd.id === "cmd-7") {
                        setSelectedRelease(releases[1]);
                      }
                      if (cmd.id === "cmd-8") {
                        setIsRailCollapsed((p) => !p);
                      }
                    }}
                  >
                    <div className="cc-palette-item-left">
                      <span className="cc-palette-item-icon"><Icons.Hex /></span>
                      <span>{cmd.label}</span>
                    </div>
                    <span className="cc-kbd-shortcut">{cmd.shortcut}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* OVERLAY 2: FLOW HEALTH BREAKDOWN MODAL */}
      {isHealthModalOpen && (
        <div
          className="cc-overlay-backdrop"
          onClick={() => setIsHealthModalOpen(false)}
        >
          <div
            className="cc-modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="health-modal-title"
          >
            <div className="cc-modal-header">
              <h3 id="health-modal-title" className="cc-modal-title">
                Flow Health V1 Score Breakdown
              </h3>
              <button
                type="button"
                className="cc-modal-close-btn"
                onClick={() => setIsHealthModalOpen(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>
            <div className="cc-modal-body">
              <div className="cc-health-modal-summary">
                <div>
                  <div className="cc-health-modal-caption">
                    WORKSPACE OPERATIONAL SCORE
                  </div>
                  <div className="cc-health-modal-bigscore">
                    {PREVIEW_FLOW_HEALTH.score} / {PREVIEW_FLOW_HEALTH.maxScore}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span className="cc-health-label-badge">{PREVIEW_FLOW_HEALTH.label}</span>
                  <div className="cc-health-modal-deductions">
                    Total Deductions: -22 pts
                  </div>
                </div>
              </div>

              <div className="cc-health-modal-desc">
                Flow Health evaluates real authorized execution friction across active tasks. Completed and archived tasks do not incur penalties. Score directly reflects blocker propagation, unassigned work, and overdue delivery dates.
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div className="cc-penalties-heading">Deduction Rule Audit</div>
                {PREVIEW_FLOW_HEALTH.penalties.map((pen, idx) => (
                  <div key={idx} className="cc-penalty-item" style={{ padding: "10px 14px" }}>
                    <div>
                      <div style={{ fontWeight: 600, color: "#fff" }}>{pen.label}</div>
                      <div style={{ fontSize: "12px", color: "var(--cc-text-muted)", marginTop: "2px" }}>
                        Target: <em>{pen.target}</em> · {pen.impact}
                      </div>
                    </div>
                    <span className="cc-penalty-deduction">-{pen.points} pts</span>
                  </div>
                ))}
              </div>

              <div className="cc-health-formula-box">
                {PREVIEW_FLOW_HEALTH.formula}
              </div>
            </div>
            <div className="cc-modal-footer">
              <button
                type="button"
                className="cc-btn-primary"
                onClick={() => setIsHealthModalOpen(false)}
              >
                Close Audit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OVERLAY 3: QUICK CREATE MODAL (3 Tabs: Task, Milestone, Decision) */}
      {isQuickCreateOpen && (
        <div
          className="cc-overlay-backdrop"
          onClick={() => setIsQuickCreateOpen(false)}
        >
          <div
            className="cc-modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-create-title"
          >
            <div className="cc-modal-header">
              <h3 id="quick-create-title" className="cc-modal-title">
                Quick Create
              </h3>
              <button
                type="button"
                className="cc-modal-close-btn"
                onClick={() => setIsQuickCreateOpen(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {/* 3 Tabs Bar */}
            <div style={{ padding: "14px 20px 0 20px" }}>
              <div className="cc-tabs-bar">
                <button
                  type="button"
                  className={`cc-tab-btn ${quickCreateTab === "task" ? "active" : ""}`}
                  onClick={() => setQuickCreateTab("task")}
                >
                  <Icons.Plus /> New Task
                </button>
                <button
                  type="button"
                  className={`cc-tab-btn ${quickCreateTab === "milestone" ? "active" : ""}`}
                  onClick={() => setQuickCreateTab("milestone")}
                >
                  <Icons.Project /> New Milestone
                </button>
                <button
                  type="button"
                  className={`cc-tab-btn ${quickCreateTab === "decision" ? "active" : ""}`}
                  onClick={() => setQuickCreateTab("decision")}
                >
                  <Icons.Decision /> Record Decision
                </button>
              </div>
            </div>

            {/* Tab 1: New Task */}
            {quickCreateTab === "task" && (
              <form onSubmit={handleCreateTask}>
                <div className="cc-modal-body">
                  <div className="cc-form-group">
                    <label className="cc-form-label" htmlFor="task-title-input">
                      Task Title *
                    </label>
                    <input
                      id="task-title-input"
                      type="text"
                      required
                      autoFocus
                      className="cc-form-input"
                      placeholder="e.g., Audit VPC network security groups"
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                    />
                  </div>

                  <div className="cc-modal-split-row">
                    <div className="cc-form-group">
                      <label className="cc-form-label" htmlFor="task-project-select">
                        Project
                      </label>
                      <select
                        id="task-project-select"
                        className="cc-form-select"
                        value={newTaskProject}
                        onChange={(e) => setNewTaskProject(e.target.value)}
                      >
                        {PREVIEW_PROJECTS.map((p) => (
                          <option key={p.id} value={p.name}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="cc-form-group">
                      <label className="cc-form-label" htmlFor="task-priority-select">
                        Priority
                      </label>
                      <select
                        id="task-priority-select"
                        className="cc-form-select"
                        value={newTaskPriority}
                        onChange={(e) => setNewTaskPriority(e.target.value)}
                      >
                        <option value="critical">Critical</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                  </div>

                  <div className="cc-form-group">
                    <label className="cc-form-label" htmlFor="task-due-input">
                      Due Target
                    </label>
                    <input
                      id="task-due-input"
                      type="text"
                      className="cc-form-input"
                      value={newTaskDueDate}
                      onChange={(e) => setNewTaskDueDate(e.target.value)}
                    />
                  </div>

                  <div className="cc-form-group">
                    <label className="cc-form-label" htmlFor="task-desc-input">
                      Recommended Next Action / Scope
                    </label>
                    <textarea
                      id="task-desc-input"
                      rows={2}
                      className="cc-form-textarea"
                      placeholder="Describe the initial verification step or blocker mitigation..."
                      value={newTaskDesc}
                      onChange={(e) => setNewTaskDesc(e.target.value)}
                    />
                  </div>
                </div>

                <div className="cc-modal-footer">
                  <button
                    type="button"
                    className="cc-btn-secondary"
                    onClick={() => setIsQuickCreateOpen(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="cc-btn-primary">
                    Create Task
                  </button>
                </div>
              </form>
            )}

            {/* Tab 2: New Milestone */}
            {quickCreateTab === "milestone" && (
              <form onSubmit={handleCreateMilestone}>
                <div className="cc-modal-body">
                  <div className="cc-form-group">
                    <label className="cc-form-label" htmlFor="milestone-title-input">
                      Milestone Title *
                    </label>
                    <input
                      id="milestone-title-input"
                      type="text"
                      required
                      autoFocus
                      className="cc-form-input"
                      placeholder="e.g., M4: Multi-Region Failover Runbook"
                      value={newMilestoneTitle}
                      onChange={(e) => setNewMilestoneTitle(e.target.value)}
                    />
                  </div>

                  <div className="cc-modal-split-row">
                    <div className="cc-form-group">
                      <label className="cc-form-label" htmlFor="milestone-release-select">
                        Target Release
                      </label>
                      <select
                        id="milestone-release-select"
                        className="cc-form-select"
                        value={newMilestoneRelease}
                        onChange={(e) => setNewMilestoneRelease(e.target.value)}
                      >
                        {releases.map((r) => (
                          <option key={r.id} value={r.name}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="cc-form-group">
                      <label className="cc-form-label" htmlFor="milestone-due-input">
                        Target Date
                      </label>
                      <input
                        id="milestone-due-input"
                        type="text"
                        className="cc-form-input"
                        value={newMilestoneDueDate}
                        onChange={(e) => setNewMilestoneDueDate(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="cc-callout-box warning" style={{ fontSize: "12.5px" }}>
                    Milestones anchor critical path dependencies. Any blocked upstream task will project schedule delay into this milestone.
                  </div>
                </div>

                <div className="cc-modal-footer">
                  <button
                    type="button"
                    className="cc-btn-secondary"
                    onClick={() => setIsQuickCreateOpen(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="cc-btn-primary">
                    Create Milestone
                  </button>
                </div>
              </form>
            )}

            {/* Tab 3: Record Decision */}
            {quickCreateTab === "decision" && (
              <form onSubmit={handleCreateDecision}>
                <div className="cc-modal-body">
                  <div className="cc-form-group">
                    <label className="cc-form-label" htmlFor="decision-title-input">
                      Decision Title (DR) *
                    </label>
                    <input
                      id="decision-title-input"
                      type="text"
                      required
                      autoFocus
                      className="cc-form-input"
                      placeholder="e.g., Decouple Redis Sentinel from Staging Load Tests"
                      value={newDecisionTitle}
                      onChange={(e) => setNewDecisionTitle(e.target.value)}
                    />
                  </div>

                  <div className="cc-form-group">
                    <label className="cc-form-label" htmlFor="decision-release-select">
                      Affected Release
                    </label>
                    <select
                      id="decision-release-select"
                      className="cc-form-select"
                      value={newDecisionRelease}
                      onChange={(e) => setNewDecisionRelease(e.target.value)}
                    >
                      {releases.map((r) => (
                        <option key={r.id} value={r.name}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="cc-form-group">
                    <label className="cc-form-label" htmlFor="decision-rationale-input">
                      Architectural Rationale & Mitigation *
                    </label>
                    <textarea
                      id="decision-rationale-input"
                      rows={3}
                      required
                      className="cc-form-textarea"
                      placeholder="Explain why this decision is made, which dependencies are decoupled, and how release slippage is avoided..."
                      value={newDecisionRationale}
                      onChange={(e) => setNewDecisionRationale(e.target.value)}
                    />
                  </div>
                </div>

                <div className="cc-modal-footer">
                  <button
                    type="button"
                    className="cc-btn-secondary"
                    onClick={() => setIsQuickCreateOpen(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="cc-btn-primary">
                    Record Decision
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* OVERLAY 4: TASK / BLOCKER INSPECTION SLIDE-OVER DRAWER */}
      {selectedAttentionItem && (
        <div
          className="cc-overlay-backdrop"
          onClick={() => setSelectedAttentionItem(null)}
        >
          <div
            className="cc-drawer-container"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Inspect ${selectedAttentionItem.title}`}
          >
            <div className="cc-drawer-header">
              <div>
                <span className={`cc-badge-reason ${selectedAttentionItem.severity}`}>
                  {selectedAttentionItem.severityLabel || selectedAttentionItem.severity}
                </span>
                <h3 className="cc-drawer-heading">
                  Operational Signal Detail
                </h3>
              </div>
              <button
                type="button"
                className="cc-modal-close-btn"
                onClick={() => setSelectedAttentionItem(null)}
                aria-label="Close drawer"
              >
                ✕
              </button>
            </div>

            <div className="cc-drawer-body">
              <div>
                <span className="cc-drawer-section-title">TASK TITLE</span>
                <div style={{ fontSize: "15.5px", fontWeight: 700, color: "#fff" }}>
                  {selectedAttentionItem.title}
                </div>
              </div>

              <div className="cc-modal-split-row">
                <div>
                  <span className="cc-drawer-section-title">PROJECT</span>
                  <div style={{ marginTop: "4px" }}>
                    <span
                      className="cc-tag-project"
                      style={{
                        borderColor: `${selectedAttentionItem.projectColor}55`,
                        color: selectedAttentionItem.projectColor,
                      }}
                    >
                      {selectedAttentionItem.project}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="cc-drawer-section-title">ASSIGNED OWNER</span>
                  <div style={{ marginTop: "4px", fontSize: "13px", color: "#fff", fontWeight: 600 }}>
                    {selectedAttentionItem.owner.name}
                  </div>
                </div>
              </div>

              {/* Root Cause Callout */}
              {selectedAttentionItem.rootCause && (
                <div className="cc-callout-box danger">
                  <div className="cc-callout-header risk">
                    ROOT CAUSE
                  </div>
                  <div style={{ fontSize: "13px", color: "#fecdd3", marginTop: "4px" }}>
                    {selectedAttentionItem.rootCause}
                  </div>
                </div>
              )}

              {/* Downstream Impact */}
              <div>
                <span className="cc-drawer-section-title">DOWNSTREAM DELIVERY IMPACT</span>
                <div className="cc-callout-box warning" style={{ marginTop: "6px" }}>
                  <div style={{ fontSize: "13px", color: "#fde68a" }}>
                    {selectedAttentionItem.impactDetail}
                  </div>
                  {selectedAttentionItem.targetMilestone && (
                    <div style={{ fontSize: "12px", color: "var(--cc-text-muted)", marginTop: "6px" }}>
                      Target Milestone: <strong>{selectedAttentionItem.targetMilestone}</strong>
                    </div>
                  )}
                  {selectedAttentionItem.targetRelease && (
                    <div style={{ fontSize: "12px", color: "var(--cc-text-muted)", marginTop: "2px" }}>
                      Target Release: <strong>{selectedAttentionItem.targetRelease}</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Recommended Next Action */}
              <div>
                <span className="cc-drawer-section-title">RECOMMENDED NEXT ACTION</span>
                <div className="cc-callout-box purple" style={{ marginTop: "6px" }}>
                  <div style={{ fontSize: "13px", color: "#e9d5ff" }}>
                    {selectedAttentionItem.recommendedAction}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
                {selectedAttentionItem.owner.name === "Unassigned" && (
                  <button
                    type="button"
                    className="cc-btn-primary"
                    style={{ width: "100%", justifyContent: "center" }}
                    onClick={() => handleSelfAssign(selectedAttentionItem)}
                  >
                    Self-Assign to Rakesh Rajput
                  </button>
                )}

                <button
                  type="button"
                  className="cc-btn-primary"
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={() => handleResolveAttentionItem(selectedAttentionItem)}
                >
                  Clear from Attention Queue
                </button>

                <button
                  type="button"
                  className="cc-btn-secondary"
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={() => setSelectedAttentionItem(null)}
                >
                  Dismiss Drawer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* OVERLAY 5: RELEASE INSPECTION SLIDE-OVER DRAWER */}
      {selectedRelease && (
        <div
          className="cc-overlay-backdrop"
          onClick={() => setSelectedRelease(null)}
        >
          <div
            className="cc-drawer-container"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Inspect Release ${selectedRelease.name}`}
          >
            <div className="cc-drawer-header">
              <div>
                <span className={`cc-release-status-badge ${selectedRelease.readinessType}`}>
                  {selectedRelease.readinessStatus} ({selectedRelease.readinessScore}%)
                </span>
                <h3 className="cc-drawer-heading">
                  Release Readiness Inspection
                </h3>
              </div>
              <button
                type="button"
                className="cc-modal-close-btn"
                onClick={() => setSelectedRelease(null)}
                aria-label="Close drawer"
              >
                ✕
              </button>
            </div>

            <div className="cc-drawer-body">
              <div>
                <span className="cc-drawer-section-title">RELEASE TARGET</span>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "#fff" }}>
                  {selectedRelease.name}
                </div>
                <div style={{ fontSize: "12.5px", color: "var(--cc-text-muted)", marginTop: "4px" }}>
                  Project: {selectedRelease.project} · Target Date: {selectedRelease.targetLabel}
                </div>
              </div>

              {/* Readiness Meter */}
              <div className="cc-readiness-meter-wrap">
                <div className="cc-readiness-bar" style={{ height: "8px" }}>
                  <div
                    className={`cc-readiness-fill ${
                      selectedRelease.readinessScore >= 90 ? "optimal" : "at-risk"
                    }`}
                    style={{ width: `${selectedRelease.readinessScore}%` }}
                  />
                </div>
                <div className="cc-release-meta-row" style={{ marginTop: "4px" }}>
                  <span>Readiness: {selectedRelease.readinessScore}%</span>
                  <span>
                    {selectedRelease.milestonesComplete} of {selectedRelease.milestoneCount} Milestones Verified
                  </span>
                </div>
              </div>

              {/* Description */}
              <div>
                <span className="cc-drawer-section-title">RELEASE SCOPE</span>
                <p style={{ fontSize: "13px", color: "var(--cc-text-secondary)", lineHeight: 1.5, margin: "4px 0 0 0" }}>
                  {selectedRelease.description}
                </p>
              </div>

              {/* Blocker & Critical Path Status */}
              <div>
                <span className="cc-drawer-section-title">CRITICAL PATH DIAGNOSTIC</span>
                {selectedRelease.blockedTaskCount > 0 ? (
                  <div className="cc-callout-box danger" style={{ marginTop: "6px" }}>
                    <div style={{ fontWeight: 700, color: "var(--cc-red)", fontSize: "12px" }}>
                      ⛔ 1 Blocker Propagating Schedule Slip (+{selectedRelease.projectedDelayDays}d)
                    </div>
                    <div style={{ fontSize: "13px", color: "#fecdd3", marginTop: "4px" }}>
                      {selectedRelease.criticalPathRisk}
                    </div>
                  </div>
                ) : (
                  <div className="cc-callout-box warning" style={{ borderLeftColor: "var(--cc-green)", marginTop: "6px" }}>
                    <div style={{ fontWeight: 700, color: "var(--cc-green)", fontSize: "12px" }}>
                      ✓ All Verification Gates Passing
                    </div>
                    <div style={{ fontSize: "13px", color: "var(--cc-text-secondary)", marginTop: "4px" }}>
                      {selectedRelease.criticalPathRisk}
                    </div>
                  </div>
                )}
              </div>

              {/* Associated Milestones */}
              <div>
                <span className="cc-drawer-section-title">MILESTONES IN SCOPE</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "6px" }}>
                  {PREVIEW_MILESTONES.filter((m) => selectedRelease.name.includes(m.release)).map((m) => (
                    <div
                      key={m.id}
                      style={{
                        background: "var(--cc-surface-2)",
                        border: "1px solid var(--cc-border)",
                        padding: "10px 12px",
                        borderRadius: "6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "#fff" }}>{m.title}</div>
                        <div style={{ fontSize: "11px", color: "var(--cc-text-muted)", marginTop: "2px" }}>
                          Due: {m.dueDate} · {m.completedTasks}/{m.taskCount} tasks completed
                        </div>
                      </div>
                      <span
                        className={`cc-badge-reason ${
                          m.status === "completed" ? "low" : m.status === "blocked" ? "critical" : "high"
                        }`}
                      >
                        {m.statusLabel}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
                {selectedRelease.blockedTaskCount > 0 && (
                  <button
                    type="button"
                    className="cc-btn-primary"
                    style={{ width: "100%", justifyContent: "center" }}
                    onClick={() => {
                      setSelectedRelease(null);
                      setIsDecisionModalOpen(true);
                    }}
                  >
                    Review Decoupling Decision (DR-014)
                  </button>
                )}
                <button
                  type="button"
                  className="cc-btn-secondary"
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={() => setSelectedRelease(null)}
                >
                  Dismiss Inspection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* OVERLAY 6: DECISION RECORD MODAL (DR-014) */}
      {isDecisionModalOpen && (
        <div
          className="cc-overlay-backdrop"
          onClick={() => setIsDecisionModalOpen(false)}
        >
          <div
            className="cc-modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="decision-modal-title"
          >
            <div className="cc-modal-header">
              <div>
                <span className="cc-preview-badge" style={{ marginRight: "8px" }}>
                  DECISION RECORD
                </span>
                <span style={{ fontFamily: "var(--cc-mono)", fontSize: "12px", color: "var(--cc-purple)" }}>
                  {PREVIEW_DECISION_RECORD.id}
                </span>
                <h3 id="decision-modal-title" className="cc-modal-title" style={{ marginTop: "4px" }}>
                  {PREVIEW_DECISION_RECORD.title}
                </h3>
              </div>
              <button
                type="button"
                className="cc-modal-close-btn"
                onClick={() => setIsDecisionModalOpen(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>
            <div className="cc-modal-body">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                  background: "var(--cc-surface-2)",
                  padding: "12px 14px",
                  borderRadius: "6px",
                  border: "1px solid var(--cc-border)",
                  fontSize: "12.5px",
                }}
              >
                <div>
                  <span style={{ color: "var(--cc-text-muted)" }}>AUTHOR</span>
                  <div style={{ color: "#fff", fontWeight: 600, marginTop: "2px" }}>
                    {PREVIEW_DECISION_RECORD.author}
                  </div>
                </div>
                <div>
                  <span style={{ color: "var(--cc-text-muted)" }}>DATE / STATUS</span>
                  <div style={{ color: "var(--cc-green)", fontWeight: 600, marginTop: "2px" }}>
                    {PREVIEW_DECISION_RECORD.status} ({PREVIEW_DECISION_RECORD.date})
                  </div>
                </div>
              </div>

              <div>
                <span className="cc-drawer-section-title">AFFECTED RELEASE & MILESTONE</span>
                <div style={{ fontSize: "13px", color: "#fff", marginTop: "4px" }}>
                  <strong>Release:</strong> {PREVIEW_DECISION_RECORD.affectedRelease}
                </div>
                <div style={{ fontSize: "13px", color: "var(--cc-text-secondary)", marginTop: "2px" }}>
                  <strong>Milestone:</strong> {PREVIEW_DECISION_RECORD.affectedMilestone}
                </div>
              </div>

              <div>
                <span className="cc-drawer-section-title">ARCHITECTURAL RATIONALE & MITIGATION</span>
                <div className="cc-callout-box purple" style={{ marginTop: "6px" }}>
                  <p style={{ fontSize: "13px", color: "#f3e8ff", lineHeight: 1.55, margin: 0 }}>
                    {PREVIEW_DECISION_RECORD.rationale}
                  </p>
                </div>
              </div>

              <div>
                <span className="cc-drawer-section-title">DECOUPLED TASKS</span>
                <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                  {PREVIEW_DECISION_RECORD.affectedTasks.map((t, idx) => (
                    <span key={idx} className="cc-tag-project" style={{ color: "#c4b5fd", borderColor: "rgba(139,92,246,0.4)" }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="cc-modal-footer">
              <button
                type="button"
                className="cc-btn-primary"
                onClick={() => {
                  setIsDecisionModalOpen(false);
                  showToast("Decision DR-014 verified against staging release plan.");
                }}
              >
                Acknowledge Decision
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OVERLAY 7: NOTIFICATIONS DRAWER */}
      {isNotificationsOpen && (
        <div
          className="cc-overlay-backdrop"
          onClick={() => setIsNotificationsOpen(false)}
        >
          <div
            className="cc-drawer-container"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="System Notifications"
          >
            <div className="cc-drawer-header">
              <h3 style={{ margin: 0, fontSize: "16px", color: "#fff", fontFamily: "Syne" }}>
                System Alerts (3)
              </h3>
              <button
                type="button"
                className="cc-modal-close-btn"
                onClick={() => setIsNotificationsOpen(false)}
                aria-label="Close alerts"
              >
                ✕
              </button>
            </div>
            <div className="cc-drawer-body">
              {[
                {
                  title: "Upstream Blocker Flagged",
                  text: "Marcus Vance flagged Redis Failover Configuration as blocked on port 26379",
                  time: "18m ago",
                  type: "alert",
                },
                {
                  title: "Decision Record DR-014 Logged",
                  text: "Sarah Jenkins decoupled staging Redis Sentinel dependency to protect Oct 15 release",
                  time: "42m ago",
                  type: "info",
                },
                {
                  title: "Overdue Critical Task Notice",
                  text: "Auth Token Rotation is overdue by 2 days on Core Engine v3.2",
                  time: "2h ago",
                  type: "warn",
                },
              ].map((notif, idx) => (
                <div
                  key={idx}
                  style={{
                    background: "var(--cc-surface-2)",
                    padding: "12px",
                    borderRadius: "8px",
                    border: "1px solid var(--cc-border)",
                  }}
                >
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#fff" }}>{notif.title}</div>
                  <div style={{ fontSize: "12px", color: "var(--cc-text-secondary)", marginTop: "4px" }}>
                    {notif.text}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--cc-text-muted)",
                      marginTop: "6px",
                      fontFamily: "var(--cc-mono)",
                    }}
                  >
                    {notif.time}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
