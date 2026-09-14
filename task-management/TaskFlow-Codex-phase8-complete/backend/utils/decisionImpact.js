const { normalizeId, buildAdjacencyMaps } = require('./dependencyGraph');
const { computeDeliveryForecast, toUtcDay } = require('./deliveryIntelligence');
const { canAccessTask: canUserAccessTask } = require('./projectAuthorization');

/**
 * Computes deterministic delivery impact for an Architectural Decision Record.
 *
 * Separates structural relationship impact from schedule/path availability:
 * - Structural impact is derived strictly from topology (direct links, downstream dependents, milestones, releases).
 * - Schedule/path analysis captures duration & forecast critical-path intersections if estimates are available.
 * - Missing estimates mark pathAnalysis.availability as 'insufficient_data' without downgrading structural delivery_relevant status.
 *
 * @param {Object} decision - The DecisionRecord document
 * @param {Object} project - The associated Project document
 * @param {Array} tasks - All tasks for the project
 * @param {Array} milestones - All milestones for the project
 * @param {Array} releases - All releases for the project
 * @param {Object} user - The requesting user (for RBAC & privacy scoping)
 * @returns {Object} Deterministic decision impact analysis
 */
function computeDecisionImpact(decision, project, tasks = [], milestones = [], releases = [], user = null) {
  const isMember = user && user.role === 'member';
  const projIdStr = normalizeId(project._id || project.id || decision.project);

  // 1. Isolate project tasks (excluding foreign project tasks and cancelled tasks)
  const scopedTasks = (Array.isArray(tasks) ? tasks : []).filter((t) => {
    if (!t) return false;
    const tProj = normalizeId(t.project?._id || t.project);
    return (!tProj || tProj === projIdStr) && t.status !== 'cancelled';
  });

  const taskMap = new Map();
  scopedTasks.forEach((t) => taskMap.set(normalizeId(t._id || t.id), t));

  const milestoneMap = new Map();
  (Array.isArray(milestones) ? milestones : []).forEach((m) => {
    if (m) milestoneMap.set(normalizeId(m._id || m.id), m);
  });

  const releaseMap = new Map();
  (Array.isArray(releases) ? releases : []).forEach((r) => {
    if (r) releaseMap.set(normalizeId(r._id || r.id), r);
  });

  // 2. Map directly linked tasks
  const rawLinkedTaskIds = (Array.isArray(decision.linkedTasks) ? decision.linkedTasks : [])
    .map(normalizeId)
    .filter(Boolean);
  const directTaskIds = Array.from(new Set(rawLinkedTaskIds)).filter((id) => taskMap.has(id));

  // 3. Forward Downstream Reachability (A -> B means A is prerequisite of B)
  const { forward } = buildAdjacencyMaps(scopedTasks);
  const downstreamTaskIdsSet = new Set();
  const queue = [...directTaskIds];
  const visited = new Set(directTaskIds);

  while (queue.length > 0) {
    const currId = queue.shift();
    const dependents = forward.get(currId) || [];
    for (const depId of dependents) {
      if (!visited.has(depId)) {
        visited.add(depId);
        downstreamTaskIdsSet.add(depId);
        queue.push(depId);
      }
    }
  }

  const downstreamTaskIds = Array.from(downstreamTaskIdsSet);
  const allAffectedTaskIds = Array.from(new Set([...directTaskIds, ...downstreamTaskIds]));

  // 4. Affected Milestones & Releases
  const rawLinkedMilestoneIds = (Array.isArray(decision.linkedMilestones) ? decision.linkedMilestones : [])
    .map(normalizeId)
    .filter(Boolean);
  const rawLinkedReleaseIds = (Array.isArray(decision.linkedReleases) ? decision.linkedReleases : [])
    .map(normalizeId)
    .filter(Boolean);

  const affectedMilestoneIdsSet = new Set(rawLinkedMilestoneIds.filter((id) => milestoneMap.has(id)));
  for (const tId of allAffectedTaskIds) {
    const t = taskMap.get(tId);
    if (t?.milestone) {
      const mId = normalizeId(t.milestone._id || t.milestone);
      if (milestoneMap.has(mId)) {
        affectedMilestoneIdsSet.add(mId);
      }
    }
  }

  const affectedReleaseIdsSet = new Set(rawLinkedReleaseIds.filter((id) => releaseMap.has(id)));
  for (const mId of affectedMilestoneIdsSet) {
    const m = milestoneMap.get(mId);
    if (m?.release) {
      const rId = normalizeId(m.release._id || m.release);
      if (releaseMap.has(rId)) {
        affectedReleaseIdsSet.add(rId);
      }
    }
  }

  // 5. Critical Path & Blocker Intersections (Schedule / Path Availability)
  let forecastDrivingPath = [];
  let durationCriticalPath = [];
  let pathAvailability = 'available';
  let intersectsForecastPath = false;
  let intersectsDurationPath = false;

  try {
    const projectForecast = computeDeliveryForecast(project, null, scopedTasks);
    if (projectForecast.availability === 'insufficient_data') {
      pathAvailability = 'insufficient_data';
    } else {
      forecastDrivingPath = projectForecast.forecastDrivingPath || projectForecast.criticalPath || [];
      durationCriticalPath = projectForecast.durationCriticalPath || [];
      const forecastPathSet = new Set(forecastDrivingPath);
      const durationPathSet = new Set(durationCriticalPath);
      intersectsForecastPath = allAffectedTaskIds.some((id) => forecastPathSet.has(id));
      intersectsDurationPath = allAffectedTaskIds.some((id) => durationPathSet.has(id));
    }
  } catch (err) {
    pathAvailability = 'insufficient_data';
  }

  const pathAnalysis = {
    availability: pathAvailability,
    durationPathIntersection: pathAvailability === 'available' ? intersectsDurationPath : null,
    forecastPathIntersection: pathAvailability === 'available' ? intersectsForecastPath : null,
    forecastDrivingPath: pathAvailability === 'available' ? forecastDrivingPath : [],
    durationCriticalPath: pathAvailability === 'available' ? durationCriticalPath : [],
  };

  // Active blockers in affected delivery surface
  const activeBlockerIds = allAffectedTaskIds.filter((id) => {
    const t = taskMap.get(id);
    return t && Boolean(t.isBlocked) && t.status !== 'Done';
  });

  // 6. Deterministic Structural Impact Classification Precedence:
  // 1. historical for rejected, withdrawn, or superseded decisions
  // 2. critical_path when a path intersection is positively established
  // 3. delivery_relevant when downstream tasks, milestones, or releases are structurally affected
  // 4. contained when only direct work is linked without downstream/release exposure
  // 5. insufficient_data only when no reliable structural classification can be derived
  let classification = 'contained';
  const status = decision.status || 'proposed';

  if (['rejected', 'withdrawn', 'superseded'].includes(status)) {
    classification = 'historical';
  } else if (pathAvailability === 'available' && (intersectsForecastPath || intersectsDurationPath)) {
    classification = 'critical_path';
  } else if (
    downstreamTaskIds.length > 0 ||
    affectedMilestoneIdsSet.size > 0 ||
    affectedReleaseIdsSet.size > 0
  ) {
    classification = 'delivery_relevant';
  } else if (directTaskIds.length > 0) {
    classification = 'contained';
  } else {
    classification = 'insufficient_data';
  }

  // 7. Structured Drivers (Finite Enum)
  const drivers = [];

  if (classification === 'historical') {
    if (status === 'superseded') {
      drivers.push({
        type: 'superseded_decision',
        message: 'This decision has been superseded by a subsequent architectural record.',
      });
    }
  } else if (classification === 'insufficient_data') {
    drivers.push({
      type: 'insufficient_data',
      message: 'Decision has no active delivery links or insufficient structural data to calculate impact.',
    });
  } else {
    if (directTaskIds.length > 0) {
      drivers.push({
        type: 'direct_task_link',
        count: directTaskIds.length,
        message: `Directly linked to ${directTaskIds.length} delivery task(s).`,
      });
    }

    if (downstreamTaskIds.length > 0) {
      drivers.push({
        type: 'downstream_impact',
        count: downstreamTaskIds.length,
        message: `Affects ${downstreamTaskIds.length} downstream dependent task(s).`,
      });
    }

    if (affectedMilestoneIdsSet.size > 0) {
      drivers.push({
        type: 'milestone_impact',
        count: affectedMilestoneIdsSet.size,
        message: `Delivery surface spans ${affectedMilestoneIdsSet.size} milestone(s).`,
      });
    }

    if (affectedReleaseIdsSet.size > 0) {
      drivers.push({
        type: 'release_impact',
        count: affectedReleaseIdsSet.size,
        message: `Delivery surface reaches ${affectedReleaseIdsSet.size} release target(s).`,
      });
    }

    if (pathAvailability === 'available') {
      if (intersectsForecastPath) {
        drivers.push({
          type: 'forecast_path_intersection',
          message: 'Linked or downstream work directly intersects the forecast-driving critical path.',
        });
      } else if (intersectsDurationPath) {
        drivers.push({
          type: 'duration_path_intersection',
          message: 'Linked or downstream work intersects the duration critical path.',
        });
      }
    }

    if (activeBlockerIds.length > 0) {
      drivers.push({
        type: 'active_blocker_exposure',
        count: activeBlockerIds.length,
        message: `${activeBlockerIds.length} active blocker(s) present in the affected delivery surface.`,
      });
    }
  }

  // 8. Member Privacy Transformation
  if (isMember) {
    const visibleDirectIds = directTaskIds.filter((id) => canUserAccessTask(user, taskMap.get(id)));
    const visibleDownstreamIds = downstreamTaskIds.filter((id) => canUserAccessTask(user, taskMap.get(id)));
    const hasHiddenAffectedWork =
      visibleDirectIds.length !== directTaskIds.length ||
      visibleDownstreamIds.length !== downstreamTaskIds.length;

    const memberDrivers = [];
    if (hasHiddenAffectedWork) {
      memberDrivers.push({
        type: 'restricted_delivery_impact',
        message: 'Restricted project work may be affected by this decision.',
      });
    }

    // Include member-safe drivers
    for (const d of drivers) {
      if (['superseded_decision', 'insufficient_data'].includes(d.type)) {
        memberDrivers.push(d);
      }
    }

    if (visibleDirectIds.length > 0) {
      memberDrivers.push({
        type: 'direct_task_link',
        count: visibleDirectIds.length,
        message: `Directly linked to ${visibleDirectIds.length} visible task(s).`,
      });
    }

    if (visibleDownstreamIds.length > 0) {
      memberDrivers.push({
        type: 'downstream_impact',
        count: visibleDownstreamIds.length,
        message: `Affects ${visibleDownstreamIds.length} visible downstream dependent task(s).`,
      });
    }

    const visibleTasksSummary = [...visibleDirectIds, ...visibleDownstreamIds].map((id) => {
      const t = taskMap.get(id);
      return {
        id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        isBlocked: Boolean(t.isBlocked) && t.status !== 'Done',
      };
    });

    return {
      version: 'decision_impact_v1',
      scope: 'personal',
      isPartial: hasHiddenAffectedWork,
      classification,
      impactClassification: classification,
      pathAnalysis: {
        availability: 'restricted_member_scope',
        durationPathIntersection: null,
        forecastPathIntersection: null,
      },
      drivers: memberDrivers,
      restrictedSignal: hasHiddenAffectedWork
        ? {
            type: 'restricted_delivery_impact',
            message: 'Restricted project work may be affected by this decision.',
          }
        : null,
      directlyLinkedTasks: visibleTasksSummary.filter((t) => visibleDirectIds.includes(t.id)),
      downstreamTasks: visibleTasksSummary.filter((t) => visibleDownstreamIds.includes(t.id)),
      affectedMilestones: Array.from(affectedMilestoneIdsSet).map((id) => {
        const m = milestoneMap.get(id);
        return { id, title: m?.title || '', status: m?.status || 'open' };
      }),
      affectedReleases: Array.from(affectedReleaseIdsSet).map((id) => {
        const r = releaseMap.get(id);
        return { id, name: r?.name || '', version: r?.version || '', status: r?.status || 'planning' };
      }),
      summary: {
        visibleDirectTasksCount: visibleDirectIds.length,
        visibleDownstreamTasksCount: visibleDownstreamIds.length,
        affectedMilestonesCount: affectedMilestoneIdsSet.size,
        affectedReleasesCount: affectedReleaseIdsSet.size,
      },
    };
  }

  // 9. Full Authority (Admin / Manager) Output
  const mapTaskSummary = (id) => {
    const t = taskMap.get(id);
    return {
      id,
      title: t?.title || '',
      status: t?.status || 'To Do',
      priority: t?.priority || 'medium',
      estimateDays: t?.estimateDays != null ? t.estimateDays : null,
      isBlocked: Boolean(t?.isBlocked) && t?.status !== 'Done',
      blockerEta: t?.blockerEta ? toUtcDay(t.blockerEta).toISOString() : null,
      milestone: t?.milestone ? normalizeId(t.milestone._id || t.milestone) : null,
      onCriticalPath: pathAnalysis.availability === 'available' && (pathAnalysis.forecastDrivingPath.includes(id) || pathAnalysis.durationCriticalPath.includes(id)),
    };
  };

  const affectedReleasesList = Array.from(affectedReleaseIdsSet).map((id) => {
    const r = releaseMap.get(id);
    let releaseForecast = null;
    try {
      releaseForecast = computeDeliveryForecast(project, r, scopedTasks);
    } catch (e) {
      releaseForecast = null;
    }
    return {
      id,
      name: r?.name || '',
      version: r?.version || '',
      status: r?.status || 'planning',
      targetDate: r?.targetDate ? toUtcDay(r.targetDate).toISOString() : null,
      forecastDate: releaseForecast?.forecastDate || null,
      forecastStatus: releaseForecast?.status || 'indeterminate',
      slipDays: releaseForecast?.slipDays != null ? releaseForecast.slipDays : null,
    };
  });

  return {
    version: 'decision_impact_v1',
    scope: 'project',
    isPartial: false,
    classification,
    impactClassification: classification,
    pathAnalysis,
    drivers,
    directlyLinkedTasks: directTaskIds.map(mapTaskSummary),
    downstreamTasks: downstreamTaskIds.map(mapTaskSummary),
    affectedMilestones: Array.from(affectedMilestoneIdsSet).map((id) => {
      const m = milestoneMap.get(id);
      return {
        id,
        title: m?.title || '',
        sequence: m?.sequence || 1,
        status: m?.status || 'open',
        dueDate: m?.dueDate ? toUtcDay(m.dueDate).toISOString() : null,
        release: m?.release ? normalizeId(m.release._id || m.release) : null,
      };
    }),
    affectedReleases: affectedReleasesList,
    criticalPath: {
      intersectsForecastPath,
      intersectsDurationPath,
      forecastDrivingPath: pathAnalysis.forecastDrivingPath,
      durationCriticalPath: pathAnalysis.durationCriticalPath,
    },
    activeBlockers: activeBlockerIds.map(mapTaskSummary),
    summary: {
      totalDirectTasks: directTaskIds.length,
      totalDownstreamTasks: downstreamTaskIds.length,
      totalAffectedTasks: allAffectedTaskIds.length,
      affectedMilestonesCount: affectedMilestoneIdsSet.size,
      affectedReleasesCount: affectedReleaseIdsSet.size,
      activeBlockersCount: activeBlockerIds.length,
      intersectsCriticalPath: intersectsForecastPath || intersectsDurationPath,
    },
  };
}

module.exports = {
  canUserAccessTask,
  computeDecisionImpact,
};
