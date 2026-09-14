/**
 * deliveryIntelligence.js — Pure Server-Side Delivery Intelligence Engine
 *
 * Transform the Directed Task Dependency Graph into an explainable delivery intelligence engine:
 * 1. Blocker Propagation: Direct blockers, propagated blockers, downstream impact sets, and depth.
 * 2. Critical Path V1: Weighted longest path with deterministic tie-breaking.
 * 3. Delivery Slip Forecast: UTC calendar day arithmetic, blocker ETA integration, and structured drivers.
 * 4. Member Privacy: Scoped personal redaction and generic masked upstream impact signals.
 *
 * Zero external dependencies.
 */

const {
  normalizeId,
  buildAdjacencyMaps,
  topologicalSort,
  compareTasks,
} = require('./dependencyGraph');

/**
 * Normalizes a Date or string to a UTC Date object set to 00:00:00.000Z.
 */
function toUtcDay(date) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Adds integer calendar days to a UTC Date object.
 */
function addCalendarDays(utcDate, days) {
  if (!utcDate) return null;
  const result = new Date(utcDate.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Computes difference in calendar days between two UTC dates: (utcDateA - utcDateB).
 */
function diffCalendarDays(utcDateA, utcDateB) {
  if (!utcDateA || !utcDateB) return 0;
  const msPerDay = 86400000;
  return Math.round((utcDateA.getTime() - utcDateB.getTime()) / msPerDay);
}

/**
 * Computes direct blocker propagation and downstream impact sets.
 * Runtime complexity: O(V + E) bounded iterative traversal with visited sets.
 */
function computeBlockerPropagation(tasks, options = {}) {
  const { forward, taskMap } = buildAdjacencyMaps(tasks);
  const criticalPathSet = new Set(options.criticalPath || []);

  const directlyBlockedTaskIds = [];
  const downstreamImpactMap = new Map(); // blockedTaskId -> Set of descendant task IDs
  const propagationDepthMap = new Map(); // blockedTaskId -> max depth
  const affectedMilestonesMap = new Map(); // blockedTaskId -> Set of milestone IDs
  const affectedReleasesMap = new Map(); // blockedTaskId -> Set of release IDs
  const allPropagatedTaskIds = new Set();
  const upstreamBlockersCountMap = new Map(); // taskId -> count of directly blocked ancestors

  for (const t of tasks) {
    const id = normalizeId(t._id || t.id);
    if (Boolean(t.isBlocked) && t.status !== 'Done') {
      directlyBlockedTaskIds.push(id);
    }
  }

  for (const blockedId of directlyBlockedTaskIds) {
    const reachableDescendants = new Set();
    const affectedMilestones = new Set();
    const affectedReleases = new Set();

    // BFS queue: [taskId, depth]
    const queue = [[blockedId, 0]];
    const visited = new Set([blockedId]);
    let maxDepth = 0;

    while (queue.length > 0) {
      const [currId, depth] = queue.shift();

      const children = forward.get(currId) || [];
      for (const childId of children) {
        if (!visited.has(childId)) {
          visited.add(childId);
          reachableDescendants.add(childId);
          allPropagatedTaskIds.add(childId);

          const childTask = taskMap.get(childId);
          if (childTask) {
            if (childTask.milestone) {
              const mId = normalizeId(childTask.milestone._id || childTask.milestone);
              if (mId) affectedMilestones.add(mId);
            }
            if (childTask.release) {
              const rId = normalizeId(childTask.release._id || childTask.release);
              if (rId) affectedReleases.add(rId);
            }
          }

          const childDepth = depth + 1;
          if (childDepth > maxDepth) maxDepth = childDepth;
          queue.push([childId, childDepth]);

          upstreamBlockersCountMap.set(
            childId,
            (upstreamBlockersCountMap.get(childId) || 0) + 1
          );
        }
      }
    }

    downstreamImpactMap.set(blockedId, reachableDescendants);
    propagationDepthMap.set(blockedId, maxDepth);
    affectedMilestonesMap.set(blockedId, affectedMilestones);
    affectedReleasesMap.set(blockedId, affectedReleases);
  }

  // Build helper objects for property access
  const propagationDepth = {};
  const downstreamImpactCounts = {};
  const blockingPrerequisiteIds = {};

  for (const t of tasks) {
    const tid = normalizeId(t._id || t.id);
    propagationDepth[tid] = 0;
    blockingPrerequisiteIds[tid] = [];
  }

  for (const blockedId of directlyBlockedTaskIds) {
    const descendants = downstreamImpactMap.get(blockedId) || new Set();
    downstreamImpactCounts[blockedId] = descendants.size;

    // BFS to record exact propagation depth and blocking prerequisites
    const q = [[blockedId, 0]];
    const seen = new Set([blockedId]);
    while (q.length > 0) {
      const [curr, d] = q.shift();
      const children = forward.get(curr) || [];
      for (const ch of children) {
        if (!seen.has(ch)) {
          seen.add(ch);
          const nextD = d + 1;
          if (!propagationDepth[ch] || nextD > propagationDepth[ch]) {
            propagationDepth[ch] = nextD;
          }
          if (!blockingPrerequisiteIds[ch]) {
            blockingPrerequisiteIds[ch] = [];
          }
          if (!blockingPrerequisiteIds[ch].includes(blockedId)) {
            blockingPrerequisiteIds[ch].push(blockedId);
          }
          q.push([ch, nextD]);
        }
      }
    }
  }

  // Summary of blocked tasks with derived intelligence
  const blockedTasksAnalysis = directlyBlockedTaskIds.map((bId) => {
    const task = taskMap.get(bId);
    const descendants = Array.from(downstreamImpactMap.get(bId) || []);
    const impactsCriticalPath = descendants.some((dId) => criticalPathSet.has(dId)) || criticalPathSet.has(bId);

    return {
      taskId: bId,
      title: task?.title || '',
      blockedReason: task?.blockedReason || '',
      blockerEta: task?.blockerEta ? toUtcDay(task.blockerEta) : null,
      impactedTaskIds: descendants,
      impactCount: descendants.length,
      affectedMilestoneIds: Array.from(affectedMilestonesMap.get(bId) || []),
      affectedReleaseIds: Array.from(affectedReleasesMap.get(bId) || []),
      maxDepth: propagationDepthMap.get(bId) || 0,
      impactsCriticalPath,
    };
  });

  return {
    directBlockerCount: directlyBlockedTaskIds.length,
    directBlockerTaskIds: new Set(directlyBlockedTaskIds),
    propagatedBlockerCount: allPropagatedTaskIds.size,
    propagatedBlockerTaskIds: allPropagatedTaskIds,
    propagationDepth,
    downstreamImpactCounts,
    blockingPrerequisiteIds,
    directlyBlockedTaskIds,
    allPropagatedTaskIds,
    downstreamImpactMap,
    propagationDepthMap,
    upstreamBlockersCountMap,
    blockedTasksAnalysis,
  };
}

/**
 * Computes Critical Path V1 using topological order dynamic programming.
 * A schedule-based critical path is available only when every active task required
 * by the scope has a valid estimate (finite integer between 1 and 60).
 */
function computeCriticalPath(tasks, options = {}) {
  const { reverse, taskMap } = buildAdjacencyMaps(tasks);
  const validIds = new Set(taskMap.keys());

  if (tasks.length === 0) {
    return {
      status: 'insufficient_data',
      availability: 'insufficient_data',
      path: [],
      criticalPath: [],
      criticalPathDuration: 0,
      totalRemainingDays: 0,
      edges: [],
      missingEstimateCount: 0,
      missingEstimateTaskIds: [],
      explanation: 'No tasks present in evaluated scope.',
    };
  }

  const missingEstimateTaskIds = [];

  for (const t of tasks) {
    const id = normalizeId(t._id || t.id);
    if (t.status === 'Done') {
      continue; // Done task contributes 0 remaining days
    }
    const est = t.estimateDays;
    const isValidEstimate =
      typeof est === 'number' && Number.isInteger(est) && est >= 1 && est <= 60;

    if (!isValidEstimate) {
      missingEstimateTaskIds.push(id);
    }
  }

  if (missingEstimateTaskIds.length > 0) {
    return {
      status: 'insufficient_data',
      availability: 'insufficient_data',
      path: [],
      criticalPath: [],
      criticalPathDuration: 0,
      totalRemainingDays: 0,
      edges: [],
      missingEstimateCount: missingEstimateTaskIds.length,
      missingEstimateTaskIds,
      explanation: `${missingEstimateTaskIds.length} active task(s) lack valid duration estimates. Critical path calculation requires complete estimates.`,
    };
  }

  // Get stable topological ordering
  const sortedOrder = topologicalSort(tasks);

  // Dynamic programming: dist[u] = duration[u] + max(dist[prereqs])
  const dist = new Map();
  const prev = new Map();

  for (const id of sortedOrder) {
    const task = taskMap.get(id);
    const duration = task.status === 'Done' ? 0 : task.estimateDays;

    const prereqIds = (reverse.get(id) || []).filter((pId) => validIds.has(pId));

    if (prereqIds.length === 0) {
      dist.set(id, duration);
      prev.set(id, null);
    } else {
      let maxPrereqDist = -1;
      let bestPrereqId = null;

      for (const pId of prereqIds) {
        const pDist = dist.get(pId) !== undefined ? dist.get(pId) : 0;
        if (pDist > maxPrereqDist) {
          maxPrereqDist = pDist;
          bestPrereqId = pId;
        } else if (pDist === maxPrereqDist && bestPrereqId !== null) {
          // Stable tie-breaking
          const taskA = taskMap.get(pId);
          const taskB = taskMap.get(bestPrereqId);
          if (compareTasks(taskA, taskB) < 0) {
            bestPrereqId = pId;
          }
        }
      }

      dist.set(id, maxPrereqDist + duration);
      prev.set(id, bestPrereqId);
    }
  }

  // Find sink task with maximum distance (longest path)
  let maxTotalDist = -1;
  let criticalEndId = null;

  for (const id of sortedOrder) {
    const d = dist.get(id) || 0;
    if (d > maxTotalDist) {
      maxTotalDist = d;
      criticalEndId = id;
    } else if (d === maxTotalDist && criticalEndId !== null) {
      const taskA = taskMap.get(id);
      const taskB = taskMap.get(criticalEndId);
      if (compareTasks(taskA, taskB) < 0) {
        criticalEndId = id;
      }
    }
  }

  // Reconstruct critical path
  const criticalPath = [];
  let curr = criticalEndId;
  const visitedCp = new Set();
  while (curr !== null && !visitedCp.has(curr)) {
    visitedCp.add(curr);
    criticalPath.unshift(curr);
    curr = prev.get(curr);
  }

  const edges = [];
  for (let i = 0; i < criticalPath.length - 1; i++) {
    edges.push({ from: criticalPath[i], to: criticalPath[i + 1] });
  }

  const duration = maxTotalDist >= 0 ? maxTotalDist : 0;

  return {
    status: 'complete',
    availability: 'available',
    path: criticalPath,
    criticalPath,
    criticalPathDuration: duration,
    totalRemainingDays: duration,
    edges,
    missingEstimateCount: 0,
    missingEstimateTaskIds: [],
    explanation: 'Critical path calculated successfully.',
  };
}

/**
 * Derives the delivery forecast and slip calculation using UTC calendar day arithmetic.
 */
function computeDeliveryForecast(project, release, scopedTasks, options = {}) {
  const todayUtc = toUtcDay(options.today || new Date());
  const targetDateUtc = release && release.targetDate ? toUtcDay(release.targetDate) : null;

  // Terminal release handling
  if (release && release.status === 'shipped') {
    return {
      version: 'delivery_forecast_v1',
      availability: 'shipped',
      status: 'shipped',
      targetDate: targetDateUtc ? targetDateUtc.toISOString() : null,
      forecastDate: null,
      slipDays: 0,
      criticalPath: [],
      criticalPathDuration: 0,
      assumptions: ['Release has already shipped. Scoring and forecasting are closed.'],
      drivers: [],
      message: 'This release has shipped.',
    };
  }

  if (release && release.status === 'cancelled') {
    return {
      version: 'delivery_forecast_v1',
      availability: 'cancelled',
      status: 'cancelled',
      targetDate: targetDateUtc ? targetDateUtc.toISOString() : null,
      forecastDate: null,
      slipDays: null,
      criticalPath: [],
      criticalPathDuration: 0,
      assumptions: ['Release has been cancelled.'],
      drivers: [],
      message: 'This release is cancelled.',
    };
  }

  // Check if release scope has zero active milestone tasks
  if (release && scopedTasks.length === 0) {
    return {
      version: 'delivery_forecast_v1',
      availability: 'insufficient_data',
      status: 'indeterminate',
      targetDate: targetDateUtc ? targetDateUtc.toISOString() : null,
      forecastDate: null,
      slipDays: null,
      criticalPath: [],
      criticalPathDuration: 0,
      assumptions: ['No active milestone tasks found for this release target.'],
      drivers: [
        {
          type: 'milestone_gate_risk',
          impact: 'forecast_indeterminate',
          reason: 'No active tasks attached to release milestones',
        },
      ],
      message: 'Insufficient data: release contains no active tasks.',
    };
  }

  // Calculate Critical Path first
  const cpResult = computeCriticalPath(scopedTasks, options);

  if (cpResult.availability !== 'available') {
    return {
      version: 'delivery_forecast_v1',
      availability: 'insufficient_data',
      status: 'indeterminate',
      targetDate: targetDateUtc ? targetDateUtc.toISOString() : null,
      forecastDate: null,
      slipDays: null,
      criticalPath: [],
      criticalPathDuration: 0,
      missingEstimateCount: cpResult.missingEstimateCount,
      assumptions: [cpResult.explanation],
      drivers: [
        {
          type: 'missing_estimate',
          impact: 'forecast_indeterminate',
          count: cpResult.missingEstimateCount,
          reason: cpResult.explanation,
        },
      ],
      message: cpResult.explanation,
    };
  }

  // Blocker propagation with respect to critical path
  const blockerProp = computeBlockerPropagation(scopedTasks, { criticalPath: cpResult.criticalPath });
  const { reverse, taskMap } = buildAdjacencyMaps(scopedTasks);

  // Requirement: Any directly blocked, incomplete task required in scope that lacks blockerEta makes the forecast indeterminate
  const inScopeBlockedWithoutEta = scopedTasks.find((t) => {
    return Boolean(t.isBlocked) && t.status !== 'Done' && !t.blockerEta;
  });

  if (inScopeBlockedWithoutEta) {
    const taskObj = inScopeBlockedWithoutEta;
    const bId = normalizeId(taskObj._id || taskObj.id);
    return {
      version: 'delivery_forecast_v1',
      availability: 'available',
      status: 'indeterminate',
      targetDate: targetDateUtc ? targetDateUtc.toISOString() : null,
      forecastDate: null,
      slipDays: null,
      durationCriticalPath: cpResult.criticalPath,
      forecastDrivingPath: cpResult.criticalPath,
      criticalPath: cpResult.criticalPath,
      criticalPathDuration: cpResult.criticalPathDuration,
      totalRemainingDays: cpResult.totalRemainingDays || cpResult.criticalPathDuration,
      assumptions: ['Required in-scope work is blocked without a resolution ETA.'],
      drivers: [
        {
          type: 'critical_blocker',
          taskId: bId,
          taskTitle: taskObj?.title || '',
          impact: 'forecast_indeterminate',
          reason: 'Required task is blocked without a resolution ETA; delivery date cannot be determined',
        },
      ],
      message: 'Delivery forecast is indeterminate because required work is blocked without an ETA.',
    };
  }

  // Calendar day simulation for earliestStart and earliestFinish
  const sortedOrder = topologicalSort(scopedTasks);
  const earliestFinishMap = new Map();
  const earliestStartMap = new Map();

  for (const id of sortedOrder) {
    const task = taskMap.get(id);
    const prereqIds = reverse.get(id) || [];

    let start = new Date(todayUtc.getTime());

    for (const pId of prereqIds) {
      const pFinish = earliestFinishMap.get(pId);
      if (pFinish && pFinish > start) {
        start = new Date(pFinish.getTime());
      }
    }

    // Incorporate blockerEta if directly blocked
    if (Boolean(task.isBlocked) && task.status !== 'Done' && task.blockerEta) {
      const etaUtc = toUtcDay(task.blockerEta);
      if (etaUtc && etaUtc > start) {
        start = new Date(etaUtc.getTime());
      }
    }

    const duration = task.status === 'Done' ? 0 : task.estimateDays;
    const finish = addCalendarDays(start, duration);

    earliestStartMap.set(id, start);
    earliestFinishMap.set(id, finish);
  }

  // Scope forecast date: maximum earliestFinish among release-specific tasks
  let targetForecastDate = todayUtc;
  const evaluationTasks = release
    ? scopedTasks.filter((t) => !t.externalPrerequisite)
    : scopedTasks;

  let forecastSinkId = null;

  for (const t of evaluationTasks) {
    const id = normalizeId(t._id || t.id);
    const f = earliestFinishMap.get(id);
    if (!f) continue;
    if (f > targetForecastDate) {
      targetForecastDate = f;
      forecastSinkId = id;
    } else if (f.getTime() === targetForecastDate.getTime() && forecastSinkId !== null) {
      const taskA = taskMap.get(id);
      const taskB = taskMap.get(forecastSinkId);
      if (compareTasks(taskA, taskB) < 0) {
        forecastSinkId = id;
      }
    } else if (!forecastSinkId) {
      forecastSinkId = id;
    }
  }

  // Backtrack from forecastSinkId to reconstruct forecast-driving path
  const forecastDrivingPath = [];
  let currForecastNode = forecastSinkId;
  const visitedForecastPath = new Set();

  while (currForecastNode && !visitedForecastPath.has(currForecastNode)) {
    visitedForecastPath.add(currForecastNode);
    forecastDrivingPath.unshift(currForecastNode);

    const prereqIds = (reverse.get(currForecastNode) || []).filter((pId) => taskMap.has(pId));
    if (prereqIds.length === 0) {
      break;
    }

    // Pick the prerequisite that produced the latest finish (driving the chain)
    let bestPrereq = null;
    let maxPrereqFinish = new Date(0);

    for (const pId of prereqIds) {
      const pFinish = earliestFinishMap.get(pId);
      if (!pFinish) continue;
      if (pFinish > maxPrereqFinish) {
        maxPrereqFinish = pFinish;
        bestPrereq = pId;
      } else if (pFinish.getTime() === maxPrereqFinish.getTime() && bestPrereq !== null) {
        const taskA = taskMap.get(pId);
        const taskB = taskMap.get(bestPrereq);
        if (compareTasks(taskA, taskB) < 0) {
          bestPrereq = pId;
        }
      }
    }

    currForecastNode = bestPrereq;
  }

  const forecastDateIso = targetForecastDate.toISOString();
  let slipDays = 0;
  let status = 'on_track';
  const drivers = [];

  if (targetDateUtc) {
    slipDays = Math.max(0, diffCalendarDays(targetForecastDate, targetDateUtc));
    if (targetForecastDate > targetDateUtc) {
      status = 'slipping';
      drivers.push({
        type: 'predicted_target_slip',
        slipDays,
        impact: 'delay',
        reason: `Predicted delivery on ${forecastDateIso.split('T')[0]} slips target by ${slipDays} calendar day(s)`,
      });
    }
  }

  // Check if critical path intersects any blocker
  const criticalPathToCheck = forecastDrivingPath.length > 0 ? forecastDrivingPath : cpResult.criticalPath;
  const criticalPathSet = new Set(criticalPathToCheck);
  const cpBlockers = criticalPathToCheck.filter((id) => {
    const t = taskMap.get(id);
    return (t && Boolean(t.isBlocked) && t.status !== 'Done') || blockerProp.allPropagatedTaskIds.has(id);
  });

  if (cpBlockers.length > 0) {
    if (status !== 'slipping') {
      status = 'at_risk';
    }
    drivers.push({
      type: 'critical_blocker',
      taskIds: cpBlockers,
      impact: status === 'slipping' ? 'slip_driver' : 'risk_warning',
      reason: `${cpBlockers.length} task(s) on the critical path are directly or transitively blocked`,
    });
  }

  // Non-critical blocker drivers
  const nonCpBlockers = blockerProp.directlyBlockedTaskIds.filter((id) => !criticalPathSet.has(id));
  if (nonCpBlockers.length > 0) {
    drivers.push({
      type: 'propagated_blocker',
      taskIds: nonCpBlockers,
      impact: 'isolated_risk',
      reason: `${nonCpBlockers.length} active blocker(s) outside the critical path may affect secondary milestones`,
    });
  }

  // External prerequisites driver
  const externalPrereqCount = scopedTasks.filter((t) => Boolean(t.externalPrerequisite)).length;
  if (externalPrereqCount > 0) {
    drivers.push({
      type: 'external_prerequisite',
      count: externalPrereqCount,
      reason: `${externalPrereqCount} prerequisite task(s) originate from outside direct release milestones`,
    });
  }

  return {
    version: 'delivery_forecast_v1',
    availability: 'available',
    status,
    targetDate: targetDateUtc ? targetDateUtc.toISOString() : null,
    forecastDate: forecastDateIso,
    slipDays,
    durationCriticalPath: cpResult.criticalPath,
    forecastDrivingPath,
    criticalPath: forecastDrivingPath,
    criticalPathDuration: cpResult.criticalPathDuration,
    totalRemainingDays: cpResult.criticalPathDuration,
    assumptions: [
      'Duration is based on integer calendar-day estimates.',
      'Completed tasks contribute 0 remaining days.',
      'Direct blockers with an ETA delay task start until resolution.',
    ],
    drivers,
    earliestStartMap,
    earliestFinishMap,
    blockerPropagation: blockerProp,
  };
}

/**
 * Builds the complete delivery intelligence payload for project or release scopes.
 */
function buildDeliveryIntelligencePayload(project, release, tasks, milestones, user, options = {}) {
  // Invariant: Archived project returns read-only availability: 'archived', forecast null
  if (project && project.status === 'archived') {
    return {
      version: 'delivery_forecast_v1',
      availability: 'archived',
      label: 'ARCHIVED',
      status: 'archived',
      scope: release ? 'release' : 'project',
      isPartial: false,
      forecast: null,
      forecastDate: null,
      slipDays: null,
      criticalPath: [],
      criticalEdges: [],
      criticalPathDuration: 0,
      nodes: [],
      edges: [],
      drivers: [],
      message: 'This project is archived and read-only. Delivery intelligence scoring is closed.',
    };
  }

  const isMember = user && user.role === 'member';
  const userId = user && (user._id ? user._id.toString() : user.toString());

  // 1. Cross-project task isolation and non-cancelled task filtering
  const projIdStr = normalizeId(project._id || project.id);
  const eligibleTasks = tasks.filter((t) => {
    if (!t) return false;
    const tProj = normalizeId(t.project?._id || t.project);
    return !tProj || tProj === projIdStr;
  });

  const nonCancelledTasks = eligibleTasks.filter((t) => t.status !== 'cancelled');

  let scopedTasks = [];
  let isPartial = false;
  let scopeType = release ? 'release' : 'project';

  if (release) {
    // Release scope: tasks in non-cancelled milestones of the release + transitive prerequisite ancestors
    const activeMilestones = (Array.isArray(milestones) ? milestones : []).filter(
      (m) => m && m.release && m.release.toString() === release._id.toString() && m.status !== 'cancelled'
    );
    const activeMilestoneIdSet = new Set(activeMilestones.map((m) => m._id.toString()));

    const directReleaseTasks = nonCancelledTasks.filter((t) => {
      if (!t.milestone) return false;
      const mId = t.milestone._id ? t.milestone._id.toString() : t.milestone.toString();
      return activeMilestoneIdSet.has(mId);
    });

    // Walk backwards through dependsOn to collect all transitive ancestors
    const taskMapAll = new Map();
    nonCancelledTasks.forEach((t) => taskMapAll.set(normalizeId(t._id || t.id), t));

    const scopeTaskIds = new Set(directReleaseTasks.map((t) => normalizeId(t._id || t.id)));
    const queue = [...scopeTaskIds];

    while (queue.length > 0) {
      const currId = queue.shift();
      const currTask = taskMapAll.get(currId);
      const prereqs = Array.isArray(currTask?.dependsOn) ? currTask.dependsOn : [];

      for (const p of prereqs) {
        const pId = normalizeId(p);
        if (taskMapAll.has(pId) && !scopeTaskIds.has(pId)) {
          scopeTaskIds.add(pId);
          queue.push(pId);
        }
      }
    }

    scopedTasks = Array.from(scopeTaskIds).map((id) => {
      const original = taskMapAll.get(id);
      const isDirect = directReleaseTasks.some((t) => normalizeId(t._id || t.id) === id);
      return {
        ...original,
        externalPrerequisite: !isDirect,
      };
    });
  } else {
    // Project scope: all non-cancelled tasks
    scopedTasks = [...nonCancelledTasks];
  }

  // Handle empty scope
  if (scopedTasks.length === 0) {
    return {
      version: 'delivery_forecast_v1',
      scope: scopeType,
      isPartial: false,
      availability: 'insufficient_data',
      status: 'indeterminate',
      forecast: {
        version: 'delivery_forecast_v1',
        availability: 'insufficient_data',
        status: 'indeterminate',
        targetDate: release?.targetDate ? toUtcDay(release.targetDate).toISOString() : null,
        forecastDate: null,
        slipDays: null,
        criticalPath: [],
        forecastDrivingPath: [],
        durationCriticalPath: [],
        criticalPathDuration: 0,
        totalRemainingDays: 0,
        assumptions: ['No tasks present in evaluated scope.'],
        drivers: [
          {
            type: 'missing_scope',
            impact: 'forecast_indeterminate',
            reason: 'Scope contains no active tasks',
          },
        ],
        message: 'Insufficient data: scope contains no active tasks.',
      },
      project: {
        id: normalizeId(project._id),
        name: project.name,
        status: project.status,
      },
      release: release
        ? {
            id: normalizeId(release._id),
            name: release.name,
            version: release.version,
            targetDate: release.targetDate ? toUtcDay(release.targetDate).toISOString() : null,
          }
        : null,
      targetDate: release?.targetDate ? toUtcDay(release.targetDate).toISOString() : null,
      forecastDate: null,
      slipDays: null,
      criticalPath: [],
      forecastDrivingPath: [],
      durationCriticalPath: [],
      criticalEdges: [],
      criticalPathDuration: 0,
      totalRemainingDays: 0,
      nodes: [],
      drivers: [
        {
          type: 'missing_scope',
          impact: 'forecast_indeterminate',
          reason: 'Scope contains no active tasks',
        },
      ],
      summary: {
        totalNodes: 0,
        criticalPathLength: 0,
        directlyBlockedCount: 0,
        propagatedImpactCount: 0,
        mostExposedMilestones: [],
      },
    };
  }

  // 2. Member privacy redaction
  if (isMember) {
    isPartial = true;
    scopeType = 'personal';

    // Filter to only tasks accessible to the member
    const visibleTasks = scopedTasks.filter((t) => {
      const assignedId = t.assignedTo?._id ? t.assignedTo._id.toString() : t.assignedTo?.toString();
      const createdById = t.createdBy?._id ? t.createdBy._id.toString() : t.createdBy?.toString();
      return assignedId === userId || createdById === userId;
    });

    // Check for restricted upstream impact
    const visibleTaskIds = new Set(visibleTasks.map((t) => normalizeId(t._id || t.id)));
    let hasHiddenUpstreamImpact = false;

    for (const vt of visibleTasks) {
      const prereqs = Array.isArray(vt.dependsOn) ? vt.dependsOn : [];
      for (const p of prereqs) {
        const pId = normalizeId(p);
        if (!visibleTaskIds.has(pId)) {
          // Inaccessible prerequisite exists
          hasHiddenUpstreamImpact = true;
          break;
        }
      }
      if (hasHiddenUpstreamImpact) break;
    }

    const blockerProp = computeBlockerPropagation(visibleTasks, { criticalPath: [] });

    // Personal node representations
    const nodes = visibleTasks.map((t) => {
      const tId = normalizeId(t._id || t.id);
      const isDirectlyBlocked = Boolean(t.isBlocked) && t.status !== 'Done';
      const isPropagatedBlocked = blockerProp.allPropagatedTaskIds.has(tId);

      return {
        id: tId,
        title: t.title,
        status: t.status,
        priority: t.priority,
        estimateDays: t.estimateDays !== undefined ? t.estimateDays : null,
        isBlocked: isDirectlyBlocked,
        blockedReason: isDirectlyBlocked ? t.blockedReason : '',
        blockerEta: t.blockerEta ? toUtcDay(t.blockerEta).toISOString() : null,
        isPropagatedBlocked,
        onCriticalPath: false,
        downstreamImpactCount: blockerProp.downstreamImpactCounts[tId] || 0,
        assignedTo: t.assignedTo ? { id: userId, name: t.assignedTo.name } : null,
      };
    });

    const drivers = [];
    let restrictedUpstreamSignal = null;
    if (hasHiddenUpstreamImpact) {
      restrictedUpstreamSignal = {
        type: 'restricted_upstream_impact',
        message: 'Restricted upstream work may affect this task.',
      };
      drivers.push(restrictedUpstreamSignal);
    }

    return {
      version: 'delivery_forecast_v1',
      scope: 'personal',
      isPartial: true,
      availability: 'partial_personal',
      status: 'personal_view',
      forecast: null,
      project: { id: normalizeId(project._id), name: project.name },
      release: release ? { id: normalizeId(release._id), name: release.name, version: release.version } : null,
      targetDate: release?.targetDate ? toUtcDay(release.targetDate).toISOString() : null,
      forecastDate: null,
      slipDays: null,
      criticalPath: [],
      criticalEdges: [],
      forecastDrivingPath: [],
      durationCriticalPath: [],
      criticalPathDuration: 0,
      totalRemainingDays: 0,
      nodes,
      drivers,
      restrictedUpstreamSignal,
      summary: {
        totalVisibleNodes: visibleTasks.length,
        directlyBlockedCount: blockerProp.directlyBlockedTaskIds.length,
        propagatedImpactCount: blockerProp.allPropagatedTaskIds.size,
      },
    };
  }

  // 3. Full Authority (Admin / Manager) Execution
  const forecastResult = computeDeliveryForecast(project, release, scopedTasks, options);
  const drivingPath = forecastResult.forecastDrivingPath || forecastResult.criticalPath || [];
  const cpSet = new Set(drivingPath);
  const blockerProp = forecastResult.blockerPropagation || computeBlockerPropagation(scopedTasks, { criticalPath: drivingPath });

  // Map nodes with intelligence attributes
  const nodes = scopedTasks.map((t) => {
    const tId = normalizeId(t._id || t.id);
    const isDirectlyBlocked = Boolean(t.isBlocked) && t.status !== 'Done';
    const isPropagatedBlocked = blockerProp.allPropagatedTaskIds.has(tId);
    const onCriticalPath = cpSet.has(tId);
    const downstreamCount = blockerProp.downstreamImpactCounts[tId] || 0;

    return {
      id: tId,
      title: t.title,
      status: t.status,
      priority: t.priority,
      estimateDays: t.estimateDays !== undefined ? t.estimateDays : null,
      isBlocked: isDirectlyBlocked,
      blockedReason: isDirectlyBlocked ? (t.blockedReason || '') : '',
      blockerEta: t.blockerEta ? toUtcDay(t.blockerEta).toISOString() : null,
      isPropagatedBlocked,
      onCriticalPath,
      downstreamImpactCount: downstreamCount,
      externalPrerequisite: Boolean(t.externalPrerequisite),
      assignedTo: t.assignedTo
        ? {
            id: normalizeId(t.assignedTo._id || t.assignedTo),
            name: t.assignedTo.name || 'Assigned',
            avatar: t.assignedTo.avatar || '',
          }
        : null,
      milestone: t.milestone
        ? {
            id: normalizeId(t.milestone._id || t.milestone),
            title: t.milestone.title || '',
          }
        : null,
    };
  });

  const criticalEdges = [];
  for (let i = 0; i < drivingPath.length - 1; i++) {
    criticalEdges.push({ from: drivingPath[i], to: drivingPath[i + 1] });
  }

  return {
    version: forecastResult.version,
    scope: scopeType,
    isPartial: false,
    availability: forecastResult.availability,
    status: forecastResult.status,
    forecast: forecastResult,
    project: {
      id: normalizeId(project._id),
      name: project.name,
      status: project.status,
    },
    release: release
      ? {
          id: normalizeId(release._id),
          name: release.name,
          version: release.version,
          targetDate: release.targetDate ? toUtcDay(release.targetDate).toISOString() : null,
        }
      : null,
    targetDate: forecastResult.targetDate,
    forecastDate: forecastResult.forecastDate,
    slipDays: forecastResult.slipDays,
    criticalPath: drivingPath,
    forecastDrivingPath: drivingPath,
    durationCriticalPath: forecastResult.durationCriticalPath || [],
    criticalEdges,
    criticalPathDuration: forecastResult.criticalPathDuration,
    totalRemainingDays: forecastResult.totalRemainingDays || forecastResult.criticalPathDuration,
    assumptions: forecastResult.assumptions,
    drivers: forecastResult.drivers,
    nodes,
    blockedTasksAnalysis: blockerProp.blockedTasksAnalysis,
    summary: {
      totalNodes: scopedTasks.length,
      criticalPathLength: drivingPath.length,
      directlyBlockedCount: blockerProp.directlyBlockedTaskIds.length,
      propagatedImpactCount: blockerProp.allPropagatedTaskIds.size,
      mostExposedMilestones: Array.from(
        new Set(
          blockerProp.blockedTasksAnalysis.flatMap((b) => b.affectedMilestoneIds)
        )
      ),
    },
  };
}

module.exports = {
  toUtcDay,
  addCalendarDays,
  diffCalendarDays,
  computeBlockerPropagation,
  computeCriticalPath,
  computeDeliveryForecast,
  buildDeliveryIntelligencePayload,
};
