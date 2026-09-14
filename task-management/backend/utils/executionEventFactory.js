const crypto = require('crypto');
const {
  CANONICAL_EVENT_TYPES,
  CANONICAL_CATEGORIES,
  CANONICAL_SUBJECT_TYPES,
} = require('../models/ExecutionEvent');

const ALLOWED_CHANGE_FIELDS = new Set([
  'title',
  'name',
  'status',
  'priority',
  'color',
  'dueDate',
  'targetDate',
  'version',
  'sequence',
  'estimateDays',
  'isBlocked',
  'blockerEta',
  'assignedTo',
  'project',
  'milestone',
  'release',
  'supersededBy',
  'availableDaysPerWeek',
  'wipLimit',
  'prerequisiteTaskId',
  'dependentTaskId',
]);

const FORBIDDEN_FIELDS = new Set([
  'password',
  'token',
  'jwt',
  'secret',
  'email',
  'rawBody',
  'headers',
  'cookies',
  'stack',
  'description',
  'context',
  'rationale',
  'blockedReason',
]);

const EVENT_TYPE_TO_CATEGORY = {
  'project.created': 'project',
  'project.updated': 'project',
  'project.status_changed': 'project',
  'project.member_added': 'project',
  'project.member_removed': 'project',
  'project.deleted': 'project',

  'task.created': 'task',
  'task.updated': 'task',
  'task.status_changed': 'task',
  'task.assigned': 'task',
  'task.unassigned': 'task',
  'task.priority_changed': 'task',
  'task.estimate_changed': 'task',
  'task.milestone_linked': 'task',
  'task.milestone_unlinked': 'task',
  'task.deleted': 'task',

  'dependency.added': 'dependency',
  'dependency.removed': 'dependency',

  'blocker.added': 'blocker',
  'blocker.activated': 'blocker',
  'blocker.updated': 'blocker',
  'blocker.resolved': 'blocker',
  'blocker.eta_changed': 'blocker',

  'release.created': 'release',
  'release.updated': 'release',
  'release.status_changed': 'release',
  'release.cancelled': 'release',
  'release.deleted': 'release',

  'milestone.created': 'milestone',
  'milestone.updated': 'milestone',
  'milestone.status_changed': 'milestone',
  'milestone.cancelled': 'milestone',

  'decision.created': 'decision',
  'decision.proposed': 'decision',
  'decision.updated': 'decision',
  'decision.status_changed': 'decision',
  'decision.accepted': 'decision',
  'decision.rejected': 'decision',
  'decision.withdrawn': 'decision',
  'decision.deprecated': 'decision',
  'decision.superseded': 'decision',

  'capacity.configured': 'capacity',
  'capacity.updated': 'capacity',
  'capacity.removed': 'capacity',
};

const EVENT_TYPE_TO_SUBJECT_TYPE = {
  'project.created': 'project',
  'project.updated': 'project',
  'project.status_changed': 'project',
  'project.member_added': 'project',
  'project.member_removed': 'project',
  'project.deleted': 'project',

  'task.created': 'task',
  'task.updated': 'task',
  'task.status_changed': 'task',
  'task.assigned': 'task',
  'task.unassigned': 'task',
  'task.priority_changed': 'task',
  'task.estimate_changed': 'task',
  'task.milestone_linked': 'task',
  'task.milestone_unlinked': 'task',
  'task.deleted': 'task',

  'dependency.added': 'task',
  'dependency.removed': 'task',

  'blocker.added': 'task',
  'blocker.activated': 'task',
  'blocker.updated': 'task',
  'blocker.resolved': 'task',
  'blocker.eta_changed': 'task',

  'release.created': 'release',
  'release.updated': 'release',
  'release.status_changed': 'release',
  'release.cancelled': 'release',
  'release.deleted': 'release',

  'milestone.created': 'milestone',
  'milestone.updated': 'milestone',
  'milestone.status_changed': 'milestone',
  'milestone.cancelled': 'milestone',

  'decision.created': 'decision',
  'decision.proposed': 'decision',
  'decision.updated': 'decision',
  'decision.status_changed': 'decision',
  'decision.accepted': 'decision',
  'decision.rejected': 'decision',
  'decision.withdrawn': 'decision',
  'decision.deprecated': 'decision',
  'decision.superseded': 'decision',

  'capacity.configured': 'capacity',
  'capacity.updated': 'capacity',
  'capacity.removed': 'capacity',
};

function getSummaryCodeForEventType(eventType) {
  return eventType.replace('.', '_').toUpperCase();
}

function truncateString(str, maxLen = 160) {
  if (typeof str !== 'string') return '';
  const trimmed = str.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function sanitizeChangeValue(val) {
  if (val === undefined || val === null) return null;
  if (typeof val === 'string') return truncateString(val, 160);
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  if (val instanceof Date) return val.toISOString();
  if (val._id) return val._id.toString();
  if (typeof val.toString === 'function') {
    const s = val.toString();
    return s === '[object Object]' ? null : truncateString(s, 160);
  }
  return null;
}

/**
 * Filter and sanitize change entries
 * @param {Array<{ field: string, from: any, to: any }>} rawChanges
 * @returns {Array<{ field: string, from: any, to: any }>}
 */
function sanitizeChanges(rawChanges) {
  if (!Array.isArray(rawChanges)) return [];
  const valid = [];

  for (const c of rawChanges) {
    if (!c || typeof c.field !== 'string') continue;
    const f = c.field.trim();
    if (!ALLOWED_CHANGE_FIELDS.has(f)) continue;
    if (FORBIDDEN_FIELDS.has(f.toLowerCase())) continue;

    valid.push({
      field: f,
      from: sanitizeChangeValue(c.from),
      to: sanitizeChangeValue(c.to),
    });

    if (valid.length >= 20) break; // Maximum 20 change entries
  }

  return valid;
}

/**
 * Sanitize metadata: only allow small safe key-value pairs, max 10 keys
 */
function sanitizeMetadata(rawMeta) {
  if (!rawMeta || typeof rawMeta !== 'object' || Array.isArray(rawMeta)) {
    return {};
  }
  const clean = {};
  let count = 0;
  for (const [k, v] of Object.entries(rawMeta)) {
    if (count >= 10) break;
    if (FORBIDDEN_FIELDS.has(k.toLowerCase())) continue;
    if (typeof v === 'string') {
      clean[k] = truncateString(v, 160);
      count++;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      clean[k] = v;
      count++;
    } else if (v instanceof Date) {
      clean[k] = v.toISOString();
      count++;
    }
  }
  return clean;
}

/**
 * Format human-readable event summary
 */
function formatEventSummary({ eventType, subjectTitleSnapshot, changes = [], actorSnapshot }) {
  const title = subjectTitleSnapshot ? `"${truncateString(subjectTitleSnapshot, 60)}"` : 'an item';
  const actor = actorSnapshot?.name || 'Someone';

  switch (eventType) {
    case 'task.created':
      return `${actor} created task ${title}`;
    case 'task.status_changed': {
      const stChange = changes.find((c) => c.field === 'status');
      if (stChange) {
        return `${actor} moved ${title} from ${stChange.from || 'none'} to ${stChange.to}`;
      }
      return `${actor} updated status of ${title}`;
    }
    case 'blocker.added':
      return `${actor} marked ${title} as blocked`;
    case 'blocker.resolved':
      return `${actor} resolved blocker on ${title}`;
    case 'task.assigned':
      return `${actor} assigned ${title}`;
    case 'task.unassigned':
      return `${actor} unassigned ${title}`;
    case 'task.priority_changed':
      return `${actor} changed priority of ${title}`;
    case 'task.deleted':
      return `${actor} deleted task ${title}`;
    case 'project.created':
      return `${actor} created project ${title}`;
    case 'project.updated':
      return `${actor} updated project ${title}`;
    case 'project.member_added':
      return `${actor} added a member to project ${title}`;
    case 'project.member_removed':
      return `${actor} removed a member from project ${title}`;
    case 'project.deleted':
      return `${actor} deleted project ${title}`;
    case 'release.created':
      return `${actor} created release ${title}`;
    case 'release.updated':
      return `${actor} updated release ${title}`;
    case 'milestone.created':
      return `${actor} created milestone ${title}`;
    case 'decision.created':
      return `${actor} proposed decision ${title}`;
    case 'decision.deprecated':
      return `${actor} deprecated decision ${title}`;
    case 'capacity.configured':
      return `${actor} configured team capacity for ${title}`;
    default:
      return `${actor} modified ${title} (${eventType})`;
  }
}

/**
 * Encode pagination cursor into URL-safe base64 string
 */
function encodeCursor(event) {
  if (!event || !event.occurredAt || !event._id) return null;
  const payload = JSON.stringify({
    occurredAt: event.occurredAt instanceof Date ? event.occurredAt.toISOString() : event.occurredAt,
    _id: event._id.toString(),
  });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * Decode pagination cursor from URL-safe base64 string
 */
function decodeCursor(cursorStr) {
  if (!cursorStr || typeof cursorStr !== 'string') return null;
  try {
    const raw = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    const targetId = parsed._id || parsed.id;
    if (!parsed.occurredAt || !targetId) return null;
    const occurredAt = new Date(parsed.occurredAt);
    if (isNaN(occurredAt.getTime())) return null;
    return { occurredAt, _id: targetId, id: targetId };
  } catch (err) {
    return null;
  }
}

/**
 * Strict internal event factory
 * Validates and constructs an event descriptor ready to be recorded.
 */
function buildExecutionEventDescriptor({
  eventType,
  project,
  actor,
  actorSnapshot,
  subjectType,
  subjectId,
  subjectTitleSnapshot,
  task = null,
  release = null,
  milestone = null,
  decision = null,
  capacityUser = null,
  aggregateVersion,
  correlationId,
  changes = [],
  metadata = {},
  occurredAt = new Date(),
}) {
  if (!CANONICAL_EVENT_TYPES.includes(eventType)) {
    throw new Error(`Unrecognized eventType: ${eventType}`);
  }

  const category = EVENT_TYPE_TO_CATEGORY[eventType] || eventType.split('.')[0];
  const expectedSubjectType = EVENT_TYPE_TO_SUBJECT_TYPE[eventType];
  const finalSubjectType = subjectType || expectedSubjectType || 'task';

  const finalProject = project || (finalSubjectType === 'project' ? subjectId : null);
  if (!actor) throw new Error('actor is required for execution event');
  if (!subjectId && !finalProject) throw new Error('subjectId is required for execution event');

  const finalSubjectId = subjectId || finalProject;
  const finalVersion = typeof aggregateVersion === 'number' && aggregateVersion >= 1 ? aggregateVersion : 1;
  const finalCorrelationId = correlationId && typeof correlationId === 'string' ? correlationId : crypto.randomUUID();

  const sanitizedChanges = sanitizeChanges(changes);
  const sanitizedMeta = sanitizeMetadata(metadata);
  const summaryCode = getSummaryCodeForEventType(eventType);
  const summary = formatEventSummary({
    eventType,
    subjectTitleSnapshot,
    changes: sanitizedChanges,
    actorSnapshot,
  });

  return {
    schemaVersion: 1,
    eventType,
    category,
    project: finalProject,
    actor,
    actorSnapshot: {
      name: truncateString(actorSnapshot?.name || '', 80),
      role: truncateString(actorSnapshot?.role || '', 40),
    },
    subjectType: finalSubjectType,
    subjectId: finalSubjectId,
    subjectTitleSnapshot: truncateString(subjectTitleSnapshot || '', 160),
    task,
    release,
    milestone,
    decision,
    capacityUser,
    aggregateVersion: finalVersion,
    correlationId: finalCorrelationId,
    summaryCode,
    summary,
    changes: sanitizedChanges,
    metadata: sanitizedMeta,
    occurredAt: occurredAt instanceof Date ? occurredAt : new Date(occurredAt),
  };
}

module.exports = {
  buildExecutionEventDescriptor,
  formatEventSummary,
  encodeCursor,
  decodeCursor,
  sanitizeChanges,
  sanitizeMetadata,
  getSummaryCodeForEventType,
  ALLOWED_CHANGE_FIELDS,
  FORBIDDEN_FIELDS,
  CANONICAL_EVENT_TYPES,
  CANONICAL_CATEGORIES,
  CANONICAL_SUBJECT_TYPES,
};
