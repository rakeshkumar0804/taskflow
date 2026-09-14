/**
 * dependencyGraph.js — Pure Directed Acyclic Task Dependency Graph Engine
 *
 * Canonical Model:
 * If Task B depends on Task A, Task A is the prerequisite and Task B is the dependent.
 * Edge Direction: A → B (source = A, target = B).
 *
 * Zero external dependencies.
 */

/**
 * Safely normalizes Mongo ObjectIds, objects with _id, or string IDs to a string.
 */
function normalizeId(id) {
  if (!id) return '';
  if (typeof id === 'string') return id.trim();
  if (typeof id.toHexString === 'function') return id.toHexString();
  if (id._id && id._id !== id) return normalizeId(id._id);
  if (typeof id.toString === 'function') return id.toString();
  return String(id);
}

/**
 * Constructs forward and reverse adjacency maps from an array of tasks.
 * Forward map: prerequisiteId -> [dependentId] (A -> B)
 * Reverse map: dependentId -> [prerequisiteId] (B -> A)
 */
function buildAdjacencyMaps(tasks) {
  const forward = new Map();
  const reverse = new Map();
  const taskMap = new Map();

  for (const t of tasks) {
    const id = normalizeId(t._id || t.id);
    if (!id) continue;
    taskMap.set(id, t);
    if (!forward.has(id)) forward.set(id, []);
    if (!reverse.has(id)) reverse.set(id, []);
  }

  for (const t of tasks) {
    const dependentId = normalizeId(t._id || t.id);
    const prereqs = Array.isArray(t.dependsOn) ? t.dependsOn : [];

    for (const p of prereqs) {
      const prereqId = normalizeId(p);
      if (!prereqId || prereqId === dependentId) continue;

      if (!forward.has(prereqId)) forward.set(prereqId, []);
      forward.get(prereqId).push(dependentId);

      if (!reverse.has(dependentId)) reverse.set(dependentId, []);
      reverse.get(dependentId).push(prereqId);
    }
  }

  return { forward, reverse, taskMap };
}

/**
 * Detects if adding a proposed dependency (dependentId dependsOn prereqId, meaning edge prereqId -> dependentId)
 * would create a direct or transitive cycle in the graph.
 *
 * A cycle occurs if dependentId can already reach prereqId in the forward graph.
 *
 * Uses iterative BFS with a visited set to prevent call stack overflow.
 */
function hasCycle(tasks, proposedDependentId, proposedPrereqId) {
  const depId = normalizeId(proposedDependentId);
  const preId = normalizeId(proposedPrereqId);

  // Self-dependency is an immediate cycle
  if (!depId || !preId || depId === preId) {
    return true;
  }

  const { forward } = buildAdjacencyMaps(tasks);

  // Check if there is already an existing path from depId to preId
  const queue = [depId];
  const visited = new Set([depId]);

  while (queue.length > 0) {
    const current = queue.shift();

    if (current === preId) {
      return true;
    }

    const neighbors = forward.get(current) || [];
    for (const n of neighbors) {
      if (n === preId) {
        return true;
      }
      if (!visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    }
  }

  return false;
}

/**
 * Deterministic tie-breaking sort for tasks.
 */
function compareTasks(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  const dateA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
  const dateB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
  if (dateA !== dateB) return dateA - dateB;

  const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  if (createdA !== createdB) return createdA - createdB;

  const idA = normalizeId(a._id || a.id);
  const idB = normalizeId(b._id || b.id);
  return idA.localeCompare(idB);
}

/**
 * Produces a stable, deterministic topological ordering using Kahn's algorithm.
 */
function topologicalSort(tasks) {
  const { forward, taskMap } = buildAdjacencyMaps(tasks);
  const inDegree = new Map();
  const validIds = new Set(taskMap.keys());

  for (const id of validIds) {
    inDegree.set(id, 0);
  }

  for (const t of tasks) {
    const dependentId = normalizeId(t._id || t.id);
    const prereqs = Array.isArray(t.dependsOn) ? t.dependsOn : [];
    for (const p of prereqs) {
      const pId = normalizeId(p);
      if (validIds.has(pId) && validIds.has(dependentId)) {
        inDegree.set(dependentId, (inDegree.get(dependentId) || 0) + 1);
      }
    }
  }

  // Initial zero in-degree queue, sorted deterministically
  const queue = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(taskMap.get(id));
    }
  }
  queue.sort(compareTasks);

  const sorted = [];

  while (queue.length > 0) {
    const currentTask = queue.shift();
    const currId = normalizeId(currentTask._id || currentTask.id);
    sorted.push(currId);

    const dependents = forward.get(currId) || [];
    const nextBatch = [];

    for (const depId of dependents) {
      if (!validIds.has(depId)) continue;
      const newDeg = (inDegree.get(depId) || 0) - 1;
      inDegree.set(depId, newDeg);
      if (newDeg === 0) {
        nextBatch.push(taskMap.get(depId));
      }
    }

    if (nextBatch.length > 0) {
      nextBatch.sort(compareTasks);
      queue.push(...nextBatch);
      queue.sort(compareTasks);
    }
  }

  // Handle any remaining disconnected or cycle nodes
  for (const id of validIds) {
    if (!sorted.includes(id)) {
      sorted.push(id);
    }
  }

  return sorted;
}

/**
 * Computes topological depth levels for frontend layout (0-indexed columns).
 * Level 0: tasks with 0 prerequisites in the active task set.
 * Level(v) = max(Level(prereq)) + 1.
 */
function computeTopologicalLevels(tasks) {
  const { taskMap } = buildAdjacencyMaps(tasks);
  const validIds = new Set(taskMap.keys());
  const levelsMap = new Map();

  const sortedOrder = topologicalSort(tasks);

  for (const id of sortedOrder) {
    const task = taskMap.get(id);
    const prereqs = (Array.isArray(task?.dependsOn) ? task.dependsOn : [])
      .map(normalizeId)
      .filter((pId) => validIds.has(pId));

    if (prereqs.length === 0) {
      levelsMap.set(id, 0);
    } else {
      let maxPrereqLevel = -1;
      for (const pId of prereqs) {
        const pLevel = levelsMap.get(pId) !== undefined ? levelsMap.get(pId) : 0;
        if (pLevel > maxPrereqLevel) {
          maxPrereqLevel = pLevel;
        }
      }
      levelsMap.set(id, maxPrereqLevel + 1);
    }
  }

  // Group task IDs by level
  const levelsByNumber = new Map();
  let maxLevel = 0;

  for (const [id, level] of levelsMap.entries()) {
    if (!levelsByNumber.has(level)) {
      levelsByNumber.set(level, []);
    }
    levelsByNumber.get(level).push(id);
    if (level > maxLevel) maxLevel = level;
  }

  const result = [];
  for (let i = 0; i <= maxLevel; i++) {
    const levelIds = levelsByNumber.get(i) || [];
    if (levelIds.length > 0) {
      levelIds.sort((a, b) => compareTasks(taskMap.get(a), taskMap.get(b)));
      result.push(levelIds);
    }
  }

  return result;
}

/**
 * Derives operational dependency state for a task.
 * Never persisted in MongoDB.
 *
 * States:
 * - 'completed': task status is Done
 * - 'blocked_and_waiting': isBlocked is true AND has incomplete prerequisites
 * - 'blocked': isBlocked is true
 * - 'waiting': has one or more incomplete prerequisites
 * - 'ready': all prerequisites resolved (status === 'Done') and not blocked
 */
function deriveDependencyState(task, prereqTasks = []) {
  if (task.status === 'Done') {
    return 'completed';
  }

  const hasIncompletePrereq = prereqTasks.some((p) => p && p.status !== 'Done');
  const isBlocked = Boolean(task.isBlocked);

  if (isBlocked && hasIncompletePrereq) {
    return 'blocked_and_waiting';
  }
  if (isBlocked) {
    return 'blocked';
  }
  if (hasIncompletePrereq) {
    return 'waiting';
  }
  return 'ready';
}

/**
 * Computes high-level graph metrics from nodes and edges.
 */
function computeGraphMetrics(nodes, edges) {
  const inDegree = new Map();
  const outDegree = new Map();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    outDegree.set(n.id, 0);
  }

  for (const e of edges) {
    outDegree.set(e.source, (outDegree.get(e.source) || 0) + 1);
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
  }

  let readyTasks = 0;
  let waitingTasks = 0;
  let blockedTasks = 0;
  let disconnectedTasks = 0;

  for (const n of nodes) {
    if (n.dependencyState === 'ready') readyTasks++;
    if (n.dependencyState === 'waiting' || n.dependencyState === 'blocked_and_waiting') waitingTasks++;
    if (n.isBlocked) blockedTasks++;

    const inDeg = inDegree.get(n.id) || 0;
    const outDeg = outDegree.get(n.id) || 0;
    if (inDeg === 0 && outDeg === 0) {
      disconnectedTasks++;
    }
  }

  return {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    readyTasks,
    waitingTasks,
    blockedTasks,
    disconnectedTasks,
  };
}

/**
 * Assembles the canonical stable project dependency graph payload.
 */
function buildGraphPayload(project, tasks, options = {}) {
  const { taskMap } = buildAdjacencyMaps(tasks);
  const validIds = new Set(taskMap.keys());

  // Deterministic levels layout
  const levels = computeTopologicalLevels(tasks);
  const nodeLayerMap = new Map();
  levels.forEach((lvlIds, lvlIdx) => {
    for (const lid of lvlIds) {
      nodeLayerMap.set(lid, lvlIdx);
    }
  });

  // Build nodes
  const nodes = tasks.map((t) => {
    const id = normalizeId(t._id || t.id);
    const prereqIds = (Array.isArray(t.dependsOn) ? t.dependsOn : []).map(normalizeId);
    const prereqTasks = prereqIds.map((pId) => taskMap.get(pId)).filter(Boolean);
    const depState = deriveDependencyState(t, prereqTasks);
    const isDepBlocked = depState === 'waiting' || depState === 'blocked_and_waiting';

    return {
      id,
      title: t.title || '',
      status: t.status || 'To Do',
      priority: t.priority || 'medium',
      isBlocked: Boolean(t.isBlocked),
      blockedReason: t.isBlocked ? (t.blockedReason || '') : '',
      dependencyBlocked: isDepBlocked,
      dueDate: t.dueDate ? (t.dueDate.toISOString ? t.dueDate.toISOString() : t.dueDate) : null,
      layer: nodeLayerMap.get(id) !== undefined ? nodeLayerMap.get(id) : 0,
      assignedTo: t.assignedTo
        ? {
            _id: normalizeId(t.assignedTo._id || t.assignedTo),
            id: normalizeId(t.assignedTo._id || t.assignedTo),
            name: t.assignedTo.name || 'Assigned',
            avatar: t.assignedTo.avatar || '',
          }
        : null,
      milestone: t.milestone
        ? {
            _id: normalizeId(t.milestone._id || t.milestone),
            id: normalizeId(t.milestone._id || t.milestone),
            title: t.milestone.title || '',
            status: t.milestone.status || '',
            sequence: t.milestone.sequence || 1,
          }
        : null,
      dependencyState: depState,
    };
  });

  // Build edges: source = prerequisite, target = dependent
  const edges = [];
  for (const t of tasks) {
    const targetId = normalizeId(t._id || t.id);
    const prereqs = Array.isArray(t.dependsOn) ? t.dependsOn : [];

    for (const p of prereqs) {
      const sourceId = normalizeId(p._id || p);
      if (validIds.has(sourceId) && validIds.has(targetId)) {
        const prereqTask = taskMap.get(sourceId);
        const resolved = prereqTask?.status === 'Done';
        edges.push({
          id: `${sourceId}->${targetId}`,
          source: sourceId,
          target: targetId,
          resolved,
        });
      }
    }
  }

  // Graph metrics & summary
  const metrics = computeGraphMetrics(nodes, edges);

  const inDegree = new Map();
  const outDegree = new Map();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    outDegree.set(n.id, 0);
  }
  for (const e of edges) {
    outDegree.set(e.source, (outDegree.get(e.source) || 0) + 1);
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
  }

  let rootTasks = 0;
  let leafTasks = 0;
  let dependencyBlockedTasks = 0;

  for (const n of nodes) {
    const inDeg = inDegree.get(n.id) || 0;
    const outDeg = outDegree.get(n.id) || 0;
    if (inDeg === 0) rootTasks++;
    if (outDeg === 0) leafTasks++;
    if (n.dependencyBlocked) dependencyBlockedTasks++;
  }

  const summary = {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    rootTasks,
    leafTasks,
    dependencyBlockedTasks,
  };

  return {
    project: {
      _id: normalizeId(project._id || project.id),
      id: normalizeId(project._id || project.id),
      name: project.name || '',
      status: project.status || 'active',
      color: project.color || '#6366f1',
    },
    scope: options.scope || 'project',
    isPartial: Boolean(options.isPartial),
    nodes,
    edges,
    levels,
    metrics,
    summary,
  };
}

module.exports = {
  normalizeId,
  buildAdjacencyMaps,
  hasCycle,
  compareTasks,
  topologicalSort,
  computeTopologicalLevels,
  deriveDependencyState,
  computeGraphMetrics,
  buildGraphPayload,
};
