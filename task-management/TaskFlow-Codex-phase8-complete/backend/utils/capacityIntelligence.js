/**
 * capacityIntelligence.js — Pure Server-Side Team Capacity & Ownership Intelligence Engine
 *
 * Deterministic calculation engine answering:
 * Who is overloaded, where is work concentrated, which delivery paths lack ownership,
 * and what should be rebalanced?
 *
 * Metric: "Commitment Pressure"
 * Explanation: Commitment Pressure compares known remaining task estimates against configured
 * project capacity for the selected horizon. It is not a measurement of time worked or individual performance.
 *
 * Strictly avoids employee surveillance, productivity scores, activity tracking, or time tracking.
 * Zero external dependencies.
 */

const { normalizeId } = require('./dependencyGraph');
const {
  toUtcDay,
  addCalendarDays,
  computeDeliveryForecast,
  computeBlockerPropagation,
} = require('./deliveryIntelligence');

const VALID_HORIZONS = [7, 14, 30];
const DEFAULT_HORIZON = 14;
const ENGINE_VERSION = 'capacity_intelligence_v1';
const DATA_ASSUMPTION =
  'One estimate day represents one full person-day. Calendar holidays, leave, and working-hour schedules are not modeled in V1.';
const COMMITMENT_PRESSURE_EXPLANATION =
  'Commitment Pressure compares known remaining task estimates against configured project capacity for the selected horizon. It is not a measurement of time worked or individual performance.';

/**
 * Validates and returns requested horizon in calendar days.
 */
function parseHorizonDays(horizonParam) {
  if (horizonParam === undefined || horizonParam === null || horizonParam === '') {
    return DEFAULT_HORIZON;
  }
  const parsed = Number(horizonParam);
  if (!Number.isInteger(parsed) || !VALID_HORIZONS.includes(parsed)) {
    const error = new Error(`Invalid horizonDays. Supported values are: ${VALID_HORIZONS.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

/**
 * Normalizes user identifier to string.
 */
function getUserIdStr(userRef) {
  if (!userRef) return null;
  if (typeof userRef === 'string') return userRef;
  if (userRef._id) return userRef._id.toString();
  if (userRef.id) return userRef.id.toString();
  return userRef.toString();
}

/**
 * Extracts set of active forecast-driving and critical path task IDs across project releases.
 */
function extractActiveReleasePaths(project, tasks, releases, milestones) {
  const forecastDrivingTaskIds = new Set();
  const criticalPathTaskIds = new Set();
  const activeReleases = (Array.isArray(releases) ? releases : []).filter(
    (r) => r && r.status !== 'cancelled' && r.status !== 'shipped'
  );

  for (const rel of activeReleases) {
    try {
      const relId = normalizeId(rel._id || rel.id);
      const relMilestoneIds = new Set(
        (Array.isArray(milestones) ? milestones : [])
          .filter((m) => m && normalizeId(m.release?._id || m.release) === relId && m.status !== 'cancelled')
          .map((m) => normalizeId(m._id || m.id))
      );

      const relTasks = tasks.filter((t) => {
        if (!t || t.status === 'Done') return false;
        const taskRelId = normalizeId(t.release?._id || t.release);
        const taskMilestoneId = normalizeId(t.milestone?._id || t.milestone);
        return (taskRelId && taskRelId === relId) || (taskMilestoneId && relMilestoneIds.has(taskMilestoneId));
      });

      if (relTasks.length > 0) {
        // Notice correct argument signature: (project, release, scopedTasks, options)
        const forecast = computeDeliveryForecast(project, rel, relTasks);

        if (Array.isArray(forecast.forecastDrivingPath)) {
          forecast.forecastDrivingPath.forEach((id) => forecastDrivingTaskIds.add(normalizeId(id)));
        }
        if (Array.isArray(forecast.criticalPath)) {
          forecast.criticalPath.forEach((id) => criticalPathTaskIds.add(normalizeId(id)));
        }
      }
    } catch {
      // In case of isolated calculation errors, continue with other releases
    }
  }

  return { forecastDrivingTaskIds, criticalPathTaskIds };
}

/**
 * Filters and categorizes tasks into canonical workload commitments.
 */
function computeWorkloadScope(tasks, project, horizonDays, referenceDate, options = {}) {
  const projIdStr = normalizeId(project._id || project.id);
  const nowUtc = toUtcDay(referenceDate || new Date());
  const horizonEndUtc = addCalendarDays(nowUtc, horizonDays);

  const { forecastDrivingTaskIds, criticalPathTaskIds } = options.paths || {
    forecastDrivingTaskIds: new Set(),
    criticalPathTaskIds: new Set(),
  };

  const cancelledMilestoneIds = new Set(
    (options.milestones || [])
      .filter((m) => m && m.status === 'cancelled')
      .map((m) => normalizeId(m._id || m.id))
  );

  const cancelledReleaseIds = new Set(
    (options.releases || [])
      .filter((r) => r && r.status === 'cancelled')
      .map((r) => normalizeId(r._id || r.id))
  );

  // Active project tasks excluding Done, cancelled milestones, and cancelled releases
  const candidateTasks = (Array.isArray(tasks) ? tasks : []).filter((t) => {
    if (!t) return false;
    const tProj = normalizeId(t.project?._id || t.project);
    if (tProj && tProj !== projIdStr) return false;
    if (t.status === 'Done') return false;

    // Exclude cancelled milestone tasks
    const mId = normalizeId(t.milestone?._id || t.milestone);
    if (mId && cancelledMilestoneIds.has(mId)) return false;

    // Exclude cancelled release tasks
    const rId = normalizeId(t.release?._id || t.release);
    if (rId && cancelledReleaseIds.has(rId)) return false;

    return true;
  });

  const committedTasksMap = new Map(); // taskId -> { task, inclusionReasons: [] }
  const unassignedTasks = [];
  const activeInProgressTasks = [];
  const queuedDueWithinHorizonTasks = [];
  const forecastDrivingCommitments = [];

  for (const t of candidateTasks) {
    const taskId = normalizeId(t._id || t.id);
    const assignedUserId = getUserIdStr(t.assignedTo);
    const isAssigned = Boolean(assignedUserId);

    const isInProgress = t.status === 'In Progress';
    const isToDo = t.status === 'To Do';
    const isDueWithinHorizon = Boolean(
      t.dueDate && toUtcDay(t.dueDate) <= horizonEndUtc
    );
    const isForecastDriving = forecastDrivingTaskIds.has(taskId);

    if (!isAssigned) {
      if (isInProgress || isDueWithinHorizon || isForecastDriving) {
        unassignedTasks.push(t);
      }
      continue;
    }

    const inclusionReasons = [];

    if (isInProgress) {
      inclusionReasons.push('in_progress');
      activeInProgressTasks.push(t);
    }

    if (isToDo && isDueWithinHorizon) {
      inclusionReasons.push('due_within_horizon');
      queuedDueWithinHorizonTasks.push(t);
    }

    if (isForecastDriving) {
      inclusionReasons.push('forecast_driving_path');
      forecastDrivingCommitments.push(t);
    }

    if (inclusionReasons.length > 0) {
      committedTasksMap.set(taskId, {
        task: t,
        inclusionReasons,
        onCriticalPath: criticalPathTaskIds.has(taskId) || isForecastDriving,
      });
    }
  }

  return {
    nowUtc,
    horizonEndUtc,
    candidateTasks,
    committedTasks: Array.from(committedTasksMap.values()),
    unassignedTasks,
    activeInProgressTasks,
    queuedDueWithinHorizonTasks,
    forecastDrivingCommitments,
    forecastDrivingTaskIds,
    criticalPathTaskIds,
  };
}

/**
 * Computes deterministic capacity intelligence for a project.
 */
function computeCapacityIntelligence({
  project,
  users = [],
  capacities = [],
  tasks = [],
  milestones = [],
  releases = [],
  horizonDays = DEFAULT_HORIZON,
  referenceDate = null,
  requestingUser = null,
}) {
  const projIdStr = normalizeId(project._id || project.id);
  const projStatus = project.status || 'active';
  const isArchived = projStatus === 'archived';
  const isCompleted = projStatus === 'completed';
  const isOnHold = projStatus === 'on-hold';
  const isNonActive = isArchived || isCompleted || isOnHold;

  // Derive top-level project availability state
  let projectAvailability = 'available';
  if (isArchived) projectAvailability = 'archived';
  else if (isCompleted) projectAvailability = 'completed';
  else if (isOnHold) projectAvailability = 'on_hold';

  // 1. Build user lookup table
  const userMap = new Map();
  for (const u of users) {
    userMap.set(normalizeId(u._id || u.id), u);
  }

  // Active project members & owner (ensure owner is included without duplication)
  const projectOwnerId = getUserIdStr(project.owner);
  const activeMemberIds = new Set();
  if (projectOwnerId) activeMemberIds.add(projectOwnerId);

  if (Array.isArray(project.members)) {
    for (const m of project.members) {
      const mUserId = getUserIdStr(m.user || m);
      if (mUserId) activeMemberIds.add(mUserId);
    }
  }

  // Capacity allocations map: userId -> allocation
  const allocationMap = new Map();
  for (const cap of capacities) {
    const cProj = normalizeId(cap.project?._id || cap.project);
    if (cProj === projIdStr) {
      const uId = getUserIdStr(cap.user);
      if (uId) allocationMap.set(uId, cap);
    }
  }

  // 2. Extract release paths and compute workload scope
  const paths = extractActiveReleasePaths(project, tasks, releases, milestones);
  const scope = computeWorkloadScope(tasks, project, horizonDays, referenceDate, {
    milestones,
    releases,
    paths,
  });

  // Group committed tasks by assigned user
  const userCommittedMap = new Map();
  for (const item of scope.committedTasks) {
    const uId = getUserIdStr(item.task.assignedTo);
    if (!userCommittedMap.has(uId)) {
      userCommittedMap.set(uId, []);
    }
    userCommittedMap.get(uId).push(item);
  }

  // 3. Member-level capacity evaluations
  const memberEvaluations = [];
  const riskDrivers = [];
  const suggestedActions = [];

  let totalAvailableCapacityDays = 0;
  let totalCommittedEstimateDays = 0;
  let hasMissingEstimatesOverall = false;
  let overloadedMemberCount = 0;
  let wipLimitExceededCount = 0;

  for (const uId of activeMemberIds) {
    const userDoc = userMap.get(uId);
    const allocation = allocationMap.get(uId);
    const userTasks = userCommittedMap.get(uId) || [];

    const isConfigured = Boolean(allocation);
    const isActiveUser = userDoc ? Boolean(userDoc.isActive) : true;

    // WIP pressure: calculated ONLY from active candidate scope In Progress tasks
    // Cancelled milestone, cancelled release, and completed tasks are already excluded from candidateTasks!
    const activeInProgressTasksForUser = scope.candidateTasks.filter(
      (t) => t.status === 'In Progress' && getUserIdStr(t.assignedTo) === uId
    );
    const wipCount = activeInProgressTasksForUser.length;
    const wipLimit = isConfigured ? allocation.wipLimit : null;
    let wipState = 'unconfigured';
    let wipRatio = null;

    if (wipLimit != null) {
      wipRatio = wipCount / wipLimit;
      if (wipCount < wipLimit) {
        wipState = 'within_limit';
      } else if (wipCount === wipLimit) {
        wipState = 'at_limit';
      } else {
        wipState = 'over_limit';
        if (!isArchived && !isCompleted) {
          wipLimitExceededCount++;
          riskDrivers.push({
            type: 'wip_limit_exceeded',
            severity: 'high',
            userId: uId,
            userName: userDoc?.name || 'Unknown',
            wipCount,
            wipLimit,
            message: `${userDoc?.name || 'Member'} has ${wipCount} active WIP tasks (limit: ${wipLimit})`,
          });
          suggestedActions.push({
            type: 'reduce_wip',
            userId: uId,
            targetId: uId,
            message: `Reduce active In Progress tasks for ${userDoc?.name || 'Member'} to comply with WIP limit (${wipLimit}).`,
          });
        }
      }
    }

    // Capacity & Load calculation
    let availableCapacityDays = null;
    let committedEstimateDays = null;
    let loadRatio = null;
    let loadStatus = isConfigured ? 'insufficient_data' : 'unconfigured';
    let memberAvailability = isConfigured ? 'available' : 'unconfigured';
    const missingEstimateTasks = [];

    // Inactive user excluded from available capacity
    if (isConfigured && isActiveUser) {
      availableCapacityDays = (allocation.availableDaysPerWeek * horizonDays) / 7;
      if (!isArchived && !isCompleted) {
        totalAvailableCapacityDays += availableCapacityDays;
      }

      let sumEstimates = 0;
      let hasMissing = false;

      for (const item of userTasks) {
        const est = item.task.estimateDays;
        if (est == null || isNaN(est) || est <= 0) {
          hasMissing = true;
          missingEstimateTasks.push({
            id: normalizeId(item.task._id || item.task.id),
            title: item.task.title,
          });
        } else {
          sumEstimates += est;
        }
      }

      if (hasMissing) {
        memberAvailability = 'insufficient_data';
        loadStatus = 'insufficient_data';
        loadRatio = null;
        committedEstimateDays = null;
        hasMissingEstimatesOverall = true;

        if (!isArchived && !isCompleted) {
          riskDrivers.push({
            type: 'missing_estimate',
            severity: 'medium',
            userId: uId,
            userName: userDoc?.name || 'Unknown',
            count: missingEstimateTasks.length,
            tasks: missingEstimateTasks,
            message: `${missingEstimateTasks.length} committed task(s) for ${userDoc?.name || 'Member'} lack estimates`,
          });

          suggestedActions.push({
            type: 'add_estimate',
            userId: uId,
            targetId: missingEstimateTasks[0]?.id,
            message: `Add estimates to committed tasks for ${userDoc?.name || 'Member'} to restore capacity visibility.`,
          });
        }
      } else {
        committedEstimateDays = sumEstimates;
        if (!isArchived && !isCompleted) {
          totalCommittedEstimateDays += sumEstimates;
        }
        loadRatio = committedEstimateDays / availableCapacityDays;

        if (isArchived || isCompleted) {
          loadStatus = projectAvailability;
        } else if (isOnHold) {
          // On-hold projects suppress active overload conclusions
          loadStatus = loadRatio > 1.0 ? 'approaching_limit' : (loadRatio < 0.85 ? 'balanced' : 'approaching_limit');
        } else {
          if (loadRatio < 0.85) {
            loadStatus = 'balanced';
          } else if (loadRatio <= 1.0) {
            loadStatus = 'approaching_limit';
          } else {
            loadStatus = 'overloaded';
            overloadedMemberCount++;

            // Check if user owns at least one incomplete task on an active release forecastDrivingPath
            const forecastTasksForUser = userTasks.filter((t) =>
              scope.forecastDrivingTaskIds.has(normalizeId(t.task._id || t.task.id))
            );

            if (forecastTasksForUser.length > 0) {
              riskDrivers.push({
                type: 'overloaded_critical_owner',
                severity: 'critical',
                userId: uId,
                userName: userDoc?.name || 'Unknown',
                loadRatio: Math.round(loadRatio * 100) / 100,
                forecastDrivingTasksCount: forecastTasksForUser.length,
                taskCount: userTasks.length,
                message: `${userDoc?.name || 'Member'} is overloaded (${Math.round(loadRatio * 100)}% load) and owns ${forecastTasksForUser.length} forecast-driving task(s)`,
              });
              suggestedActions.push({
                type: 'rebalance_forecast_path',
                userId: uId,
                message: `Rebalance forecast-driving commitments from overloaded owner ${userDoc?.name || 'Member'}.`,
              });
            }
          }
        }
      }
    } else if (!isConfigured) {
      if (!isArchived && !isCompleted) {
        riskDrivers.push({
          type: 'missing_capacity_configuration',
          severity: 'low',
          userId: uId,
          userName: userDoc?.name || 'Unknown',
          message: `${userDoc?.name || 'Member'} has no capacity allocation configured for this project`,
        });
        suggestedActions.push({
          type: 'configure_capacity',
          userId: uId,
          targetId: uId,
          message: `Configure weekly availability and WIP limit for ${userDoc?.name || 'Member'}.`,
        });
      }
    }

    const blockedTasks = userTasks.filter((t) => t.task.isBlocked);
    const forecastTasks = userTasks.filter((t) =>
      scope.forecastDrivingTaskIds.has(normalizeId(t.task._id || t.task.id))
    );

    memberEvaluations.push({
      user: {
        id: uId,
        name: userDoc?.name || 'Unknown',
        email: userDoc?.email || '',
        role: userDoc?.role || 'member',
        avatar: userDoc?.avatar || '',
        isActive: isActiveUser,
      },
      isConfigured,
      allocation: allocation
        ? {
            id: normalizeId(allocation._id),
            availableDaysPerWeek: allocation.availableDaysPerWeek,
            wipLimit: allocation.wipLimit,
            updatedAt: allocation.updatedAt,
          }
        : null,
      availableCapacityDays: availableCapacityDays,
      displayAvailableCapacityDays: availableCapacityDays != null ? Math.round(availableCapacityDays * 10) / 10 : null,
      rawAvailableCapacityDays: availableCapacityDays,
      committedEstimateDays,
      loadRatio: loadRatio,
      displayLoadRatio: loadRatio != null ? Math.round(loadRatio * 100) / 100 : null,
      rawLoadRatio: loadRatio,
      loadStatus,
      availability: isNonActive ? projectAvailability : memberAvailability,
      wip: {
        count: wipCount,
        limit: wipLimit,
        ratio: wipRatio != null ? Math.round(wipRatio * 100) / 100 : null,
        state: isArchived || isCompleted ? 'within_limit' : wipState,
      },
      committedTasksCount: userTasks.length,
      blockedTasksCount: blockedTasks.length,
      forecastDrivingTasksCount: forecastTasks.length,
      missingEstimateTasksCount: missingEstimateTasks.length,
      tasks: userTasks.map((item) => ({
        id: normalizeId(item.task._id || item.task.id),
        title: item.task.title,
        status: item.task.status,
        priority: item.task.priority,
        estimateDays: item.task.estimateDays,
        dueDate: item.task.dueDate,
        isBlocked: item.task.isBlocked,
        inclusionReasons: item.inclusionReasons,
        onCriticalPath: item.onCriticalPath,
      })),
    });
  }

  // 4. Non-member and Inactive Ownership Inspection
  if (!isArchived && !isCompleted) {
    for (const item of scope.committedTasks) {
      const uId = getUserIdStr(item.task.assignedTo);
      if (!uId) continue;
      const userDoc = userMap.get(uId);

      if (userDoc && !userDoc.isActive) {
        riskDrivers.push({
          type: 'inactive_owner',
          severity: 'high',
          taskId: normalizeId(item.task._id || item.task.id),
          taskTitle: item.task.title,
          userId: uId,
          userName: userDoc.name,
          message: `Committed task "${item.task.title}" is assigned to inactive user ${userDoc.name}`,
        });
        suggestedActions.push({
          type: 'reactivate_or_reassign',
          taskId: normalizeId(item.task._id || item.task.id),
          userId: uId,
          message: `Reassign task "${item.task.title}" from inactive user ${userDoc.name}.`,
        });
      } else if (!activeMemberIds.has(uId)) {
        riskDrivers.push({
          type: 'non_member_owner',
          severity: 'high',
          taskId: normalizeId(item.task._id || item.task.id),
          taskTitle: item.task.title,
          userId: uId,
          userName: userDoc?.name || 'Unknown User',
          message: `Committed task "${item.task.title}" is assigned to ${userDoc?.name || 'User'} who is not a member of this project`,
        });
        suggestedActions.push({
          type: 'reactivate_or_reassign',
          taskId: normalizeId(item.task._id || item.task.id),
          userId: uId,
          message: `Reassign task "${item.task.title}" to an active project team member.`,
        });
      }
    }

    // 5. Unassigned Critical Work
    for (const unassignedTask of scope.unassignedTasks) {
      const taskId = normalizeId(unassignedTask._id || unassignedTask.id);
      const isCriticalPriority = unassignedTask.priority === 'high' || unassignedTask.priority === 'critical';
      const isOnForecastPath = scope.forecastDrivingTaskIds.has(taskId);

      if (isOnForecastPath) {
        riskDrivers.push({
          type: 'unassigned_critical_path',
          severity: 'critical',
          taskId,
          taskTitle: unassignedTask.title,
          message: `Forecast-driving path task "${unassignedTask.title}" has no assigned owner`,
        });
        suggestedActions.push({
          type: 'assign_owner',
          taskId,
          message: `Assign an owner to critical-path task "${unassignedTask.title}".`,
        });
      } else if (isCriticalPriority) {
        riskDrivers.push({
          type: 'unassigned_high_priority',
          severity: 'high',
          taskId,
          taskTitle: unassignedTask.title,
          priority: unassignedTask.priority,
          message: `${unassignedTask.priority.toUpperCase()} priority task "${unassignedTask.title}" has no assigned owner`,
        });
        suggestedActions.push({
          type: 'assign_owner',
          taskId,
          message: `Assign an owner to ${unassignedTask.priority} priority task "${unassignedTask.title}".`,
        });
      }
    }
  }

  // 6. Forecast-Path Concentration Analysis
  // Emit forecast_path_concentration only when at least 3 assigned forecast-driving tasks exist and one owner holds >= 60%
  let forecastPathConcentration = null;
  const assignedForecastTasks = scope.forecastDrivingCommitments;
  const totalAssignedForecastTasks = assignedForecastTasks.length;

  if (totalAssignedForecastTasks >= 3 && !isArchived && !isCompleted) {
    const ownerCounts = new Map();
    for (const t of assignedForecastTasks) {
      const uId = getUserIdStr(t.assignedTo);
      if (uId) {
        ownerCounts.set(uId, (ownerCounts.get(uId) || 0) + 1);
      }
    }

    let topOwnerId = null;
    let maxOwnerCount = 0;
    for (const [oId, cnt] of ownerCounts.entries()) {
      if (cnt > maxOwnerCount) {
        maxOwnerCount = cnt;
        topOwnerId = oId;
      }
    }

    const share = maxOwnerCount / totalAssignedForecastTasks;
    forecastPathConcentration = {
      totalAssignedForecastTasks,
      topOwnerId,
      topOwnerCount: maxOwnerCount,
      share: Math.round(share * 100) / 100,
      isConcentrated: share >= 0.60,
    };

    if (share >= 0.60) {
      const topOwnerDoc = userMap.get(topOwnerId);
      riskDrivers.push({
        type: 'forecast_path_concentration',
        severity: 'high',
        userId: topOwnerId,
        userName: topOwnerDoc?.name || 'Owner',
        share: Math.round(share * 100) / 100,
        taskCount: maxOwnerCount,
        totalTasks: totalAssignedForecastTasks,
        message: `${Math.round(share * 100)}% of assigned forecast-driving tasks are concentrated on ${topOwnerDoc?.name || 'single owner'} (${maxOwnerCount}/${totalAssignedForecastTasks} tasks)`,
      });
      suggestedActions.push({
        type: 'rebalance_forecast_path',
        userId: topOwnerId,
        message: `Distribute forecast-driving commitments across other team members to mitigate single-owner delivery risk.`,
      });
    }
  }

  // 7. Blocked-Work Concentration Analysis (Distinct directly / propagated-blocked tasks)
  let blockedWorkConcentration = null;
  if (!isArchived && !isCompleted) {
    const blockerProp = computeBlockerPropagation(scope.candidateTasks);
    // Gather distinct directly and propagated blocked task IDs
    const affectedBlockedTaskIds = new Set(blockerProp.directlyBlockedTaskIds);
    blockerProp.allPropagatedTaskIds.forEach((id) => affectedBlockedTaskIds.add(id));

    // Filter to assigned affected blocked tasks in scope
    const assignedAffectedBlockedTasks = scope.candidateTasks.filter(
      (t) => affectedBlockedTaskIds.has(normalizeId(t._id || t.id)) && getUserIdStr(t.assignedTo)
    );
    const totalAssignedBlockedTasks = assignedAffectedBlockedTasks.length;

    if (totalAssignedBlockedTasks >= 3) {
      const blockedOwnerCounts = new Map();
      for (const bt of assignedAffectedBlockedTasks) {
        const uId = getUserIdStr(bt.assignedTo);
        if (uId) {
          blockedOwnerCounts.set(uId, (blockedOwnerCounts.get(uId) || 0) + 1);
        }
      }
      let topBlockedOwnerId = null;
      let maxBlockedCount = 0;
      for (const [oId, cnt] of blockedOwnerCounts.entries()) {
        if (cnt > maxBlockedCount) {
          maxBlockedCount = cnt;
          topBlockedOwnerId = oId;
        }
      }
      const blockedShare = maxBlockedCount / totalAssignedBlockedTasks;
      blockedWorkConcentration = {
        totalAssignedBlockedTasks,
        topOwnerId: topBlockedOwnerId,
        topOwnerCount: maxBlockedCount,
        share: Math.round(blockedShare * 100) / 100,
        isConcentrated: blockedShare >= 0.60,
      };

      if (blockedShare >= 0.60) {
        const topDoc = userMap.get(topBlockedOwnerId);
        riskDrivers.push({
          type: 'blocked_work_concentration',
          severity: 'medium',
          userId: topBlockedOwnerId,
          userName: topDoc?.name || 'Owner',
          share: Math.round(blockedShare * 100) / 100,
          taskCount: maxBlockedCount,
          totalTasks: totalAssignedBlockedTasks,
          message: `${Math.round(blockedShare * 100)}% of assigned blocked work (${maxBlockedCount}/${totalAssignedBlockedTasks} tasks) is assigned to ${topDoc?.name || 'single owner'}`,
        });
        suggestedActions.push({
          type: 'review_blocked_load',
          userId: topBlockedOwnerId,
          message: `Review blocked dependencies for ${topDoc?.name || 'Owner'} to prevent delivery paralysis.`,
        });
      }
    }
  }

  // Deduplicate suggested actions by type + targetId
  const uniqueActionsMap = new Map();
  for (const act of suggestedActions) {
    const key = `${act.type}_${act.targetId || act.userId || act.taskId}`;
    if (!uniqueActionsMap.has(key)) {
      uniqueActionsMap.set(key, act);
    }
  }

  // 8. Assemble full payload
  const configuredCount = memberEvaluations.filter((m) => m.isConfigured).length;
  const unconfiguredCount = memberEvaluations.filter((m) => !m.isConfigured).length;

  const fullPayload = {
    version: ENGINE_VERSION,
    scope: 'project',
    isPartial: false,
    availability: projectAvailability,
    metricName: 'Commitment Pressure',
    explanation: COMMITMENT_PRESSURE_EXPLANATION,
    project: {
      id: projIdStr,
      name: project.name,
      status: projStatus,
      isArchived,
      isCompleted,
      isOnHold,
    },
    horizon: {
      days: horizonDays,
      startUtc: scope.nowUtc.toISOString(),
      endUtc: scope.horizonEndUtc.toISOString(),
    },
    assumption: DATA_ASSUMPTION,
    summary: {
      totalActiveMembers: activeMemberIds.size,
      configuredActiveMembers: configuredCount,
      unconfiguredActiveMembers: unconfiguredCount,
      overloadedMembers: isArchived || isCompleted ? 0 : overloadedMemberCount,
      membersAtOrOverWipLimit: isArchived || isCompleted ? 0 : wipLimitExceededCount,
      totalCommittedEstimateDays: hasMissingEstimatesOverall || isArchived || isCompleted ? null : Math.round(totalCommittedEstimateDays * 10) / 10,
      totalAvailableCapacityDays: isArchived || isCompleted ? 0 : totalAvailableCapacityDays,
      displayTotalAvailableCapacityDays: isArchived || isCompleted ? 0 : Math.round(totalAvailableCapacityDays * 10) / 10,
      unassignedCommittedTasks: scope.unassignedTasks.length,
      missingEstimateTasks: scope.committedTasks.filter((t) => t.task.estimateDays == null).length,
      hasMissingEstimatesOverall,
      forecastPathConcentration,
      blockedWorkConcentration,
    },
    members: memberEvaluations,
    riskDrivers,
    suggestedActions: Array.from(uniqueActionsMap.values()),
  };

  // 9. Member Privacy Scoping
  if (requestingUser && requestingUser.role === 'member') {
    return scopePersonalCapacity(fullPayload, requestingUser);
  }

  return fullPayload;
}

/**
 * Scopes capacity intelligence down to personal-only view for Members.
 * Always returns invariant signal:
 * { type: "restricted_capacity_context", message: "Additional project capacity data is restricted from this view." }
 * Completely strips populated project membership, owner, colleague IDs, names, emails, roles, counts, allocations,
 * task metadata, and risk drivers.
 */
function scopePersonalCapacity(fullPayload, memberUser) {
  const memberIdStr = normalizeId(memberUser._id || memberUser.id);
  const myEval = fullPayload.members.find((m) => m.user.id === memberIdStr);

  const personalMember = myEval
    ? {
        user: {
          id: memberIdStr,
          name: memberUser.name,
          email: memberUser.email,
          role: 'member',
          avatar: memberUser.avatar || '',
          isActive: true,
        },
        isConfigured: myEval.isConfigured,
        allocation: myEval.allocation,
        availableCapacityDays: myEval.availableCapacityDays,
        displayAvailableCapacityDays: myEval.displayAvailableCapacityDays,
        committedEstimateDays: myEval.committedEstimateDays,
        loadRatio: myEval.loadRatio,
        displayLoadRatio: myEval.displayLoadRatio,
        loadStatus: myEval.loadStatus,
        availability: myEval.availability,
        wip: myEval.wip,
        committedTasksCount: myEval.committedTasksCount,
        blockedTasksCount: myEval.blockedTasksCount,
        forecastDrivingTasksCount: myEval.forecastDrivingTasksCount,
        missingEstimateTasksCount: myEval.missingEstimateTasksCount,
        tasks: myEval.tasks,
      }
    : {
        user: {
          id: memberIdStr,
          name: memberUser.name,
          email: memberUser.email,
          role: 'member',
          avatar: memberUser.avatar || '',
          isActive: true,
        },
        isConfigured: false,
        allocation: null,
        availableCapacityDays: null,
        committedEstimateDays: null,
        loadRatio: null,
        loadStatus: 'unconfigured',
        availability: 'unconfigured',
        wip: { count: 0, limit: null, ratio: null, state: 'unconfigured' },
        committedTasksCount: 0,
        blockedTasksCount: 0,
        forecastDrivingTasksCount: 0,
        missingEstimateTasksCount: 0,
        tasks: [],
      };

  // Invariant restricted signal by construction
  const restrictedSignals = [
    {
      type: 'restricted_capacity_context',
      message: 'Additional project capacity data is restricted from this view.',
    },
  ];

  return {
    version: ENGINE_VERSION,
    scope: 'personal',
    isPartial: true,
    availability: fullPayload.availability,
    metricName: fullPayload.metricName,
    explanation: fullPayload.explanation,
    project: {
      id: fullPayload.project.id,
      name: fullPayload.project.name,
      status: fullPayload.project.status,
      isArchived: fullPayload.project.isArchived,
      isCompleted: fullPayload.project.isCompleted,
      isOnHold: fullPayload.project.isOnHold,
    },
    horizon: fullPayload.horizon,
    assumption: fullPayload.assumption,
    personal: personalMember,
    restrictedSignals,
  };
}

module.exports = {
  VALID_HORIZONS,
  DEFAULT_HORIZON,
  ENGINE_VERSION,
  DATA_ASSUMPTION,
  COMMITMENT_PRESSURE_EXPLANATION,
  parseHorizonDays,
  computeWorkloadScope,
  computeCapacityIntelligence,
  scopePersonalCapacity,
};
