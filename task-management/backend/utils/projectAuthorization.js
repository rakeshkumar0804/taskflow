/**
 * projectAuthorization.js — Canonical Shared Authorization Module
 *
 * Centralizes read, management, membership, and task-level authorization predicates
 * across Projects, Decisions, Capacity, Tasks, Releases, and Milestones.
 */

const { normalizeId } = require('./dependencyGraph');

/**
 * Normalizes user identifier to string.
 */
function toIdString(entity) {
  if (!entity) return null;
  if (typeof entity === 'string') return entity;
  if (entity._id) return entity._id.toString();
  if (entity.id) return entity.id.toString();
  return entity.toString();
}

/**
 * Checks whether user has read access to a project.
 * - Admin: full read access to any project.
 * - Manager: full project read access across all projects.
 * - Member: read access only if project owner or explicit project member.
 */
function canReadProject(user, project) {
  if (!user || !project) return false;
  if (user.role === 'admin' || user.role === 'manager') return true;

  const userId = toIdString(user);
  if (!userId) return false;

  const ownerId = toIdString(project.owner);
  const isOwner = Boolean(ownerId && ownerId === userId);

  const isMember = Array.isArray(project.members) && project.members.some(
    (m) => toIdString(m.user || m) === userId
  );

  if (user.role === 'member') {
    return isMember || isOwner;
  }

  return false;
}

/**
 * Checks whether user has management authority over a project.
 * - Admin: management authority over any project.
 * - Manager: management authority only over projects they own.
 * - Member: never has management authority.
 */
function canManageProject(user, project) {
  if (!user || !project) return false;
  if (user.role === 'admin') return true;

  if (user.role === 'manager') {
    const ownerId = toIdString(project.owner);
    const userId = toIdString(user);
    return Boolean(ownerId && userId && ownerId === userId);
  }

  return false;
}

/**
 * Checks whether user is the project owner or an explicit project member.
 */
function isActiveProjectMember(userIdOrUser, project) {
  if (!userIdOrUser || !project) return false;
  const targetId = toIdString(userIdOrUser);
  if (!targetId) return false;

  const ownerId = toIdString(project.owner);
  if (ownerId && ownerId === targetId) return true;

  if (Array.isArray(project.members)) {
    return project.members.some((m) => toIdString(m.user || m) === targetId);
  }

  return false;
}

/**
 * Reusable object-level authorization predicate for tasks.
 * - Admin / Manager: can access all tasks in accessible projects.
 * - Member: can access task only if assigned to it or created it.
 */
function canAccessTask(user, task) {
  if (!user || !task) return false;
  if (user.role === 'admin' || user.role === 'manager') return true;

  if (user.role === 'member') {
    const userId = toIdString(user);
    const assignedId = toIdString(task.assignedTo);
    const createdById = toIdString(task.createdBy);
    return assignedId === userId || createdById === userId;
  }

  return false;
}

module.exports = {
  toIdString,
  canReadProject,
  canManageProject,
  isActiveProjectMember,
  canAccessTask,
};
