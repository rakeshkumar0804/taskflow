/**
 * Flow Health V1 Calculator
 * Pure deterministic calculation of operational health from authorized tasks.
 *
 * Base score: 100
 * Final score: max(0, 100 - total deductions)
 *
 * Scoring labels:
 *  90-100: OPTIMAL
 *  75-89:  STABLE
 *  50-74:  AT RISK
 *  0-49:   CRITICAL
 *
 * Deductions:
 * 1. Overdue Critical/High: 10 pts/task, cap 30
 * 2. Overdue Medium/Low:    5 pts/task, cap 20
 * 3. Active Blocked Task:   6 pts/task, cap 24
 * 4. Stale In-Progress Task: 4 pts/task, cap 20 (>= 4 days without update)
 * 5. Unassigned Critical:   5 pts/task, cap 15
 * 6. WIP Congestion:        8 pts once
 *    - Workspace/Project: In Progress > 1.5 * active members
 *    - Personal: In Progress > 5
 */

const getLabelForScore = (score) => {
  if (score === null || score === undefined) return 'NOT ENOUGH DATA';
  if (score >= 90) return 'OPTIMAL';
  if (score >= 75) return 'STABLE';
  if (score >= 50) return 'AT RISK';
  return 'CRITICAL';
};

const calculateFlowHealth = ({
  tasks = [],
  now = new Date(),
  activeMemberCount = 1,
  scope = 'workspace',
} = {}) => {
  const calcDate = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
  const safeScope = ['workspace', 'personal', 'project'].includes(scope) ? scope : 'workspace';
  const memberCount = Math.max(
    1,
    typeof activeMemberCount === 'number' && !isNaN(activeMemberCount) ? activeMemberCount : 1
  );

  // Safe task list
  const safeTasks = Array.isArray(tasks) ? tasks.filter(Boolean) : [];
  // Active tasks = incomplete tasks (completed tasks do NOT count toward threshold or penalties)
  const activeTasks = safeTasks.filter((t) => t.status !== 'Done');

  const inProgressTasks = activeTasks.filter((t) => t.status === 'In Progress');
  const inProgressCount = inProgressTasks.length;

  // Threshold: at least 3 active tasks required
  if (activeTasks.length < 3) {
    return {
      success: true,
      availability: 'insufficient_data',
      scope: safeScope,
      score: null,
      label: 'NOT ENOUGH DATA',
      message: 'Add at least 3 active tasks to calculate Flow Health.',
      metrics: {
        activeTasks: activeTasks.length,
        overdueHighCritical: 0,
        overdueMediumLow: 0,
        blocked: 0,
        staleInProgress: 0,
        unassignedCritical: 0,
        inProgress: inProgressCount,
        activeMembers: safeScope === 'personal' ? 1 : memberCount,
      },
      penalties: [],
      totalDeduction: 0,
      calculatedAt: calcDate.toISOString(),
    };
  }

  // Calculate risk drivers across active tasks
  let overdueHighCriticalCount = 0;
  let overdueMediumLowCount = 0;
  let blockedCount = 0;
  let staleInProgressCount = 0;
  let unassignedCriticalCount = 0;

  const fourDaysMs = 4 * 24 * 60 * 60 * 1000;

  for (const task of activeTasks) {
    // 1 & 2: Overdue checks
    if (task.dueDate) {
      const due = new Date(task.dueDate);
      if (!isNaN(due.getTime()) && due.getTime() < calcDate.getTime()) {
        const p = task.priority || 'medium';
        if (p === 'critical' || p === 'high') {
          overdueHighCriticalCount++;
        } else if (p === 'medium' || p === 'low') {
          overdueMediumLowCount++;
        }
      }
    }

    // 3: Active Blocked Task
    if (task.isBlocked === true) {
      blockedCount++;
    }

    // 4: Stale In-Progress Task (status is In Progress and updatedAt >= 4 days old)
    if (task.status === 'In Progress' && task.updatedAt) {
      const updated = new Date(task.updatedAt);
      if (!isNaN(updated.getTime()) && calcDate.getTime() - updated.getTime() >= fourDaysMs) {
        staleInProgressCount++;
      }
    }

    // 5: Unassigned Critical Task
    if (task.priority === 'critical' && (!task.assignedTo || task.assignedTo === null)) {
      unassignedCriticalCount++;
    }
  }

  const penalties = [];

  // Category 1: Overdue Critical/High (10 pts/task, cap 30)
  if (overdueHighCriticalCount > 0) {
    const raw = overdueHighCriticalCount * 10;
    const capped = Math.min(30, raw);
    penalties.push({
      type: 'OVERDUE_HIGH_CRITICAL',
      count: overdueHighCriticalCount,
      points: capped,
      description:
        overdueHighCriticalCount === 1
          ? '1 overdue high/critical-priority task'
          : `${overdueHighCriticalCount} overdue high/critical-priority tasks`,
    });
  }

  // Category 2: Overdue Medium/Low (5 pts/task, cap 20)
  if (overdueMediumLowCount > 0) {
    const raw = overdueMediumLowCount * 5;
    const capped = Math.min(20, raw);
    penalties.push({
      type: 'OVERDUE_MEDIUM_LOW',
      count: overdueMediumLowCount,
      points: capped,
      description:
        overdueMediumLowCount === 1
          ? '1 overdue medium/low-priority task'
          : `${overdueMediumLowCount} overdue medium/low-priority tasks`,
    });
  }

  // Category 3: Active Blocked Task (6 pts/task, cap 24)
  if (blockedCount > 0) {
    const raw = blockedCount * 6;
    const capped = Math.min(24, raw);
    penalties.push({
      type: 'BLOCKED_TASK',
      count: blockedCount,
      points: capped,
      description:
        blockedCount === 1
          ? '1 active blocked task'
          : `${blockedCount} active blocked tasks`,
    });
  }

  // Category 4: Stale In-Progress Task (4 pts/task, cap 20)
  if (staleInProgressCount > 0) {
    const raw = staleInProgressCount * 4;
    const capped = Math.min(20, raw);
    penalties.push({
      type: 'STALE_IN_PROGRESS',
      count: staleInProgressCount,
      points: capped,
      description:
        staleInProgressCount === 1
          ? '1 stale in-progress task (>4d)'
          : `${staleInProgressCount} stale in-progress tasks (>4d)`,
    });
  }

  // Category 5: Unassigned Critical Task (5 pts/task, cap 15)
  if (unassignedCriticalCount > 0) {
    const raw = unassignedCriticalCount * 5;
    const capped = Math.min(15, raw);
    penalties.push({
      type: 'UNASSIGNED_CRITICAL',
      count: unassignedCriticalCount,
      points: capped,
      description:
        unassignedCriticalCount === 1
          ? '1 unassigned critical task'
          : `${unassignedCriticalCount} unassigned critical tasks`,
    });
  }

  // Category 6: WIP Congestion (8 pts once)
  let hasWipCongestion = false;
  let wipDescription = '';
  if (safeScope === 'personal') {
    if (inProgressCount > 5) {
      hasWipCongestion = true;
      wipDescription = `More than 5 tasks in progress concurrently (${inProgressCount} active)`;
    }
  } else {
    // workspace or project scope
    if (inProgressCount > 1.5 * memberCount) {
      hasWipCongestion = true;
      wipDescription = `In-progress work exceeds 1.5x active member capacity (${inProgressCount} in progress for ${memberCount} active member${
        memberCount === 1 ? '' : 's'
      })`;
    }
  }

  if (hasWipCongestion) {
    penalties.push({
      type: 'WIP_CONGESTION',
      count: 1,
      points: 8,
      description: wipDescription,
    });
  }

  const totalDeduction = penalties.reduce((sum, p) => sum + p.points, 0);
  const score = Math.max(0, 100 - totalDeduction);
  const label = getLabelForScore(score);

  return {
    success: true,
    availability: 'available',
    scope: safeScope,
    score,
    label,
    metrics: {
      activeTasks: activeTasks.length,
      overdueHighCritical: overdueHighCriticalCount,
      overdueMediumLow: overdueMediumLowCount,
      blocked: blockedCount,
      staleInProgress: staleInProgressCount,
      unassignedCritical: unassignedCriticalCount,
      inProgress: inProgressCount,
      activeMembers: safeScope === 'personal' ? 1 : memberCount,
    },
    penalties,
    totalDeduction,
    calculatedAt: calcDate.toISOString(),
  };
};

module.exports = {
  calculateFlowHealth,
  getLabelForScore,
};
