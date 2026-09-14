/**
 * Deterministic Release Readiness V1 Calculation Engine
 * 
 * Computes release readiness from actual verifiable tasks and active milestones.
 * No client-supplied readiness is trusted.
 */

function calculateReleaseReadiness(release, milestones = [], tasks = []) {
  // 1. Cancelled release state
  if (release && release.status === 'cancelled') {
    return {
      availability: 'cancelled',
      score: null,
      label: 'CANCELLED',
      message: 'This release target has been cancelled.',
      drivers: [],
      metrics: {
        totalTasks: 0,
        completedTasks: 0,
        completedMilestones: 0,
        totalMilestones: 0,
        overdueTasks: 0,
        blockedTasks: 0,
        unassignedHighCriticalTasks: 0,
        overdueMilestones: 0,
      },
    };
  }

  // 2. Shipped release state (truthful: closed active scoring, score is null)
  if (release && release.status === 'shipped') {
    const allTasks = Array.isArray(tasks) ? tasks : [];
    const allMilestones = Array.isArray(milestones) ? milestones : [];
    return {
      availability: 'shipped',
      score: null,
      label: 'SHIPPED',
      message: 'This release has shipped. Active readiness scoring is closed.',
      drivers: [],
      metrics: {
        totalTasks: allTasks.length,
        completedTasks: allTasks.filter((t) => t && t.status === 'Done').length,
        completedMilestones: allMilestones.filter((m) => m && m.status === 'completed').length,
        totalMilestones: allMilestones.length,
        overdueTasks: 0,
        blockedTasks: 0,
        unassignedHighCriticalTasks: 0,
        overdueMilestones: 0,
        staleTasks: 0,
      },
    };
  }

  const now = new Date();

  // Filter out cancelled milestones from active readiness
  const activeMilestones = (Array.isArray(milestones) ? milestones : []).filter(
    (m) => m && m.status !== 'cancelled'
  );
  const totalMilestones = activeMilestones.length;
  const completedMilestones = activeMilestones.filter((m) => m.status === 'completed').length;
  const overdueMilestones = activeMilestones.filter((m) => {
    if (m.status === 'completed') return false;
    if (!m.dueDate) return false;
    const d = new Date(m.dueDate);
    return !isNaN(d.getTime()) && d < now;
  }).length;

  // Filter tasks: exclude tasks attached to cancelled milestones
  const activeMilestoneIdSet = new Set(
    activeMilestones.map((m) => (m._id ? m._id.toString() : m.toString()))
  );
  const cancelledMilestoneIdSet = new Set(
    (Array.isArray(milestones) ? milestones : [])
      .filter((m) => m && m.status === 'cancelled')
      .map((m) => (m._id ? m._id.toString() : m.toString()))
  );
  const activeTasks = (Array.isArray(tasks) ? tasks : []).filter((t) => {
    if (!t) return false;
    if (t.milestone) {
      const mId = t.milestone._id ? t.milestone._id.toString() : t.milestone.toString();
      if (cancelledMilestoneIdSet.has(mId)) return false;
      if (activeMilestones.length > 0) return activeMilestoneIdSet.has(mId);
    }
    // If only cancelled milestones exist and milestones were provided, exclude unattached tasks
    if (activeMilestones.length === 0 && (Array.isArray(milestones) && milestones.length > 0)) {
      return false;
    }
    return true;
  });

  const totalTasks = activeTasks.length;
  const completedTasks = activeTasks.filter((t) => t.status === 'Done').length;
  const incompleteTasks = activeTasks.filter((t) => t.status !== 'Done');

  const blockedTasks = incompleteTasks.filter((t) => Boolean(t.isBlocked)).length;
  const overdueTasks = incompleteTasks.filter((t) => {
    if (!t.dueDate) return false;
    const d = new Date(t.dueDate);
    return !isNaN(d.getTime()) && d < now;
  }).length;

  // Penalize unassigned tasks with priority 'critical' OR 'high'
  const unassignedHighCriticalTasks = incompleteTasks.filter(
    (t) => (t.priority === 'critical' || t.priority === 'high') && (!t.assignedTo || t.assignedTo === null)
  ).length;

  // Stale tasks: context-only metric (updated >= 4 days ago while In Progress), contributes 0 deduction
  const fourDaysMs = 4 * 24 * 60 * 60 * 1000;
  const staleTasks = incompleteTasks.filter((t) => {
    if (t.status === 'In Progress' && t.updatedAt) {
      const updated = new Date(t.updatedAt);
      return !isNaN(updated.getTime()) && now.getTime() - updated.getTime() >= fourDaysMs;
    }
    return false;
  }).length;

  // Zero-task rule: for any planning, active, or code-freeze release,
  // if total active tasks === 0, return insufficient_data with score: null
  if (totalTasks === 0) {
    return {
      availability: 'insufficient_data',
      score: null,
      label: 'INSUFFICIENT DATA',
      message: 'Add tasks to active release milestones to calculate readiness.',
      drivers: [],
      metrics: {
        totalTasks: 0,
        completedTasks: 0,
        completedMilestones,
        totalMilestones,
        overdueTasks: 0,
        blockedTasks: 0,
        unassignedHighCriticalTasks: 0,
        overdueMilestones,
        staleTasks: 0,
      },
    };
  }

  // Base progress calculation (active tasks guaranteed > 0)
  let baseScore = 0;
  if (totalMilestones > 0) {
    const taskRatio = completedTasks / totalTasks;
    const milestoneRatio = completedMilestones / totalMilestones;
    baseScore = Math.round((taskRatio * 0.7 + milestoneRatio * 0.3) * 100);
  } else {
    baseScore = Math.round((completedTasks / totalTasks) * 100);
  }

  // Active friction penalty drivers (stale tasks contribute 0 deduction)
  const drivers = [];

  if (blockedTasks > 0) {
    const deduction = Math.min(blockedTasks * 15, 30);
    drivers.push({
      type: 'blocked_task',
      label: 'Active blocked task',
      count: blockedTasks,
      deduction,
    });
  }

  if (overdueTasks > 0) {
    const deduction = Math.min(overdueTasks * 10, 25);
    drivers.push({
      type: 'overdue_task',
      label: 'Overdue task',
      count: overdueTasks,
      deduction,
    });
  }

  if (unassignedHighCriticalTasks > 0) {
    const deduction = Math.min(unassignedHighCriticalTasks * 8, 16);
    drivers.push({
      type: 'unassigned_high_critical',
      label: 'Unassigned high/critical task',
      count: unassignedHighCriticalTasks,
      deduction,
    });
  }

  if (overdueMilestones > 0) {
    const deduction = Math.min(overdueMilestones * 12, 24);
    drivers.push({
      type: 'overdue_milestone',
      label: 'Overdue milestone',
      count: overdueMilestones,
      deduction,
    });
  }

  const totalDeductions = drivers.reduce((sum, d) => sum + d.deduction, 0);
  const score = Math.max(0, Math.min(100, baseScore - totalDeductions));

  let label = 'OPTIMAL';
  if (score < 50) {
    label = 'CRITICAL';
  } else if (score < 70) {
    label = 'AT RISK';
  } else if (score < 85) {
    label = 'STABLE';
  }

  return {
    availability: 'ready',
    score,
    label,
    drivers,
    metrics: {
      totalTasks,
      completedTasks,
      completedMilestones,
      totalMilestones,
      overdueTasks,
      blockedTasks,
      unassignedHighCriticalTasks,
      overdueMilestones,
      staleTasks,
    },
  };
}

module.exports = {
  calculateReleaseReadiness,
};
