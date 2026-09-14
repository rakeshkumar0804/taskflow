const mongoose = require('mongoose');
const {
  ExecutionEvent,
  CANONICAL_EVENT_TYPES,
  CANONICAL_CATEGORIES,
  CANONICAL_SUBJECT_TYPES,
} = require('../models/ExecutionEvent');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Release = require('../models/Release');
const Milestone = require('../models/Milestone');
const DecisionRecord = require('../models/DecisionRecord');
const ProjectCapacity = require('../models/ProjectCapacity');
const {
  canReadProject,
  canManageProject,
  canAccessTask,
} = require('../utils/projectAuthorization');
const { computeLedgerCoverage } = require('../services/executionEventService');
const origProjectFind = Project.find;

const INVARIANT_MEMBER_NOTICE = {
  type: 'restricted_activity_context',
  message: 'Activity outside your permitted project memberships and assigned scope is omitted from this view.',
};

/**
 * Encode an opaque cursor from an event document
 */
function encodeCursor(event) {
  if (!event) return null;
  const idStr = (event._id || event.id || '').toString();
  const payload = {
    occurredAt: event.occurredAt instanceof Date ? event.occurredAt.toISOString() : event.occurredAt,
    _id: idStr,
    id: idStr,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decode an opaque cursor string
 */
function decodeCursor(cursorStr) {
  if (!cursorStr || typeof cursorStr !== 'string') return null;
  try {
    const raw = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    const targetId = parsed._id || parsed.id;
    if (!parsed.occurredAt || !targetId || !mongoose.Types.ObjectId.isValid(targetId)) {
      return null;
    }
    const d = new Date(parsed.occurredAt);
    if (isNaN(d.getTime())) return null;
    return { occurredAt: d, _id: targetId, id: targetId };
  } catch (err) {
    return null;
  }
}

/**
 * Build security filter for Member role
 */
async function buildMemberSecurityFilter(memberUser) {
  const memberId = memberUser._id ? memberUser._id.toString() : memberUser.toString();

  let projectIds = [];
  if (mongoose.connection.readyState === 1 || Project.find !== mongoose.Model.find) {
    try {
      const projects = await Project.find({
        $or: [{ owner: memberId }, { 'members.user': memberId }],
      }).select('_id');
      projectIds = projects ? projects.map((p) => p._id) : [];
    } catch (err) {
      projectIds = [];
    }
  }

  let accessibleTaskIds = new Set();
  if (mongoose.connection.readyState === 1 || Task.find !== mongoose.Model.find) {
    try {
      const accessibleTasks = await Task.find({
        project: { $in: projectIds },
        $or: [{ assignedTo: memberId }, { createdBy: memberId }],
      }).select('_id dependsOn');
      accessibleTaskIds = new Set(accessibleTasks ? accessibleTasks.map((t) => t._id.toString()) : []);
    } catch (err) {
      accessibleTaskIds = new Set();
    }
  }

  return {
    projectIds,
    accessibleTaskIds,
    memberId,
  };
}

/**
 * Security check: Can requesting user view this execution event?
 */
function canUserViewEvent(user, event, memberContext = null) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'manager') return true;

  // Member role
  if (!memberContext) return false;
  const { projectIds, accessibleTaskIds, memberId } = memberContext;

  const eventProjId = event.project ? (event.project._id || event.project).toString() : null;
  if (!eventProjId || !projectIds.some((p) => p.toString() === eventProjId)) {
    return false;
  }

  // Capacity events: only visible if it concerns the requesting member
  if (event.category === 'capacity') {
    const capUserId = event.capacityUser ? (event.capacityUser._id || event.capacityUser).toString() : null;
    return capUserId === memberId;
  }

  // Task events: visible only if member has access to the task
  if (event.category === 'task' || event.category === 'blocker') {
    const tId = event.task ? (event.task._id || event.task).toString() : event.subjectId?.toString();
    return tId ? accessibleTaskIds.has(tId) : false;
  }

  // Dependency events: require visibility of both tasks
  if (event.category === 'dependency') {
    const depTaskId = event.task ? (event.task._id || event.task).toString() : event.subjectId?.toString();
    const prereqTaskId = event.metadata?.prerequisiteTaskId ? event.metadata.prerequisiteTaskId.toString() : null;
    if (!depTaskId || !prereqTaskId) return false;
    return accessibleTaskIds.has(depTaskId) && accessibleTaskIds.has(prereqTaskId);
  }

  // Project, Release, Milestone, Decision events are visible if project is readable
  return true;
}

// @desc  Get global activity feed
// @route GET /api/activity
const getActivityFeed = async (req, res) => {
  try {
    const reqQuery = req.query || {};
    const params = req.params || {};
    const project = reqQuery.project || params.projectId || params.id;
    const {
      category,
      eventType,
      actor,
      subjectType,
      subjectId,
      dateFrom,
      dateTo,
      cursor,
      limit,
    } = reqQuery;

    const requestedLimit = parseInt(limit, 10);
    const pageSize = Math.min(100, Math.max(1, isNaN(requestedLimit) ? 50 : requestedLimit));

    // Cursor validation
    let cursorObj = null;
    if (cursor) {
      cursorObj = decodeCursor(cursor);
      if (!cursorObj) {
        return res.status(400).json({ success: false, message: 'Invalid cursor parameter' });
      }
    }

    const fieldFilter = {};

    if (project) {
      if (!mongoose.Types.ObjectId.isValid(project)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID format' });
      }
      if (req.user && req.user.role === 'member') {
        const projectDoc = await Project.findById(project);
        if (!projectDoc) {
          return res.status(404).json({ success: false, message: 'Project not found' });
        }
        if (!canReadProject(req.user, projectDoc)) {
          return res.status(403).json({ success: false, message: 'Not authorized to view activity for this project' });
        }
      }
      fieldFilter.project = project;
    }

    if (category && !CANONICAL_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: 'Invalid activity category' });
    }
    if (eventType && !CANONICAL_EVENT_TYPES.includes(eventType)) {
      return res.status(400).json({ success: false, message: 'Invalid activity event type' });
    }
    if (subjectType && !CANONICAL_SUBJECT_TYPES.includes(subjectType)) {
      return res.status(400).json({ success: false, message: 'Invalid activity subject type' });
    }
    if (category) fieldFilter.category = category;
    if (eventType) fieldFilter.eventType = eventType;
    if (subjectType) fieldFilter.subjectType = subjectType;

    if (actor) {
      if (!mongoose.Types.ObjectId.isValid(actor)) {
        return res.status(400).json({ success: false, message: 'Invalid actor ID format' });
      }
      fieldFilter.actor = actor;
    }

    if (subjectId) {
      if (!mongoose.Types.ObjectId.isValid(subjectId)) {
        return res.status(400).json({ success: false, message: 'Invalid subject ID format' });
      }
      fieldFilter.subjectId = subjectId;
    }

    // Date range
    if (dateFrom || dateTo) {
      const dateFilter = {};
      if (dateFrom) {
        const dF = new Date(dateFrom);
        if (isNaN(dF.getTime())) {
          return res.status(400).json({ success: false, message: 'Invalid dateFrom parameter' });
        }
        dateFilter.$gte = dF;
      }
      if (dateTo) {
        const dT = new Date(dateTo);
        if (isNaN(dT.getTime())) {
          return res.status(400).json({ success: false, message: 'Invalid dateTo parameter' });
        }
        dateFilter.$lte = dT;
      }
      if (Object.keys(dateFilter).length > 0) {
        fieldFilter.occurredAt = dateFilter;
      }
    }

    // Cursor condition: occurredAt DESC, _id DESC
    let cursorFilter = null;
    if (cursorObj) {
      cursorFilter = {
        $or: [
          { occurredAt: { $lt: cursorObj.occurredAt } },
          { occurredAt: cursorObj.occurredAt, _id: { $lt: cursorObj.id } },
        ],
      };
    }

    let memberContext = null;
    const isMember = req.user && req.user.role === 'member';

    let finalFilter = {};

    // PRE-PAGINATION AUTHORIZATION FOR MEMBERS
    if (isMember) {
      memberContext = await buildMemberSecurityFilter(req.user);
      const accessibleTaskIdStrings = Array.from(memberContext.accessibleTaskIds);
      const accessibleTaskObjectIds = accessibleTaskIdStrings.map((id) =>
        mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id
      );
      const permittedProjectIds = memberContext.projectIds;

      const memberAuthCriteria = {
        $or: [
          // Project, Release, Milestone, Decision events in permitted projects
          {
            category: { $in: ['project', 'release', 'milestone', 'decision'] },
            project: { $in: permittedProjectIds },
          },
          // Task and Blocker events for accessible tasks
          {
            category: { $in: ['task', 'blocker'] },
            $or: [
              { task: { $in: accessibleTaskObjectIds } },
              { subjectType: 'task', subjectId: { $in: accessibleTaskIdStrings } },
            ],
          },
          // Dependency events where BOTH dependent and prerequisite tasks are accessible
          {
            category: 'dependency',
            $or: [
              { task: { $in: accessibleTaskObjectIds } },
              { subjectType: 'task', subjectId: { $in: accessibleTaskIdStrings } },
            ],
            'metadata.prerequisiteTaskId': { $in: accessibleTaskIdStrings },
          },
          // Capacity events strictly for the requesting member
          {
            category: 'capacity',
            capacityUser: req.user._id,
          },
        ],
      };

      if (cursorFilter) {
        finalFilter = { $and: [fieldFilter, memberAuthCriteria, cursorFilter] };
      } else {
        finalFilter = { ...fieldFilter, $or: memberAuthCriteria.$or };
      }
    } else {
      if (cursorFilter) {
        finalFilter = { ...fieldFilter, $or: cursorFilter.$or };
      } else {
        finalFilter = { ...fieldFilter };
      }
    }

    // Fetch batch with pageSize + 1 to detect hasMore
    let query = ExecutionEvent.find(finalFilter);
    if (typeof query.sort === 'function') {
      query = query.sort({ occurredAt: -1, _id: -1 });
    }
    if (typeof query.limit === 'function') {
      query = query.limit(pageSize + 1);
    }
    if (typeof query.populate === 'function') {
      query = query.populate('project', 'name color');
      if (query && typeof query.populate === 'function') {
        query = query.populate('actor', 'name avatar role');
      }
    }

    const rawEvents = (await query) || [];

    const hasMore = rawEvents.length > pageSize;
    const pagedEvents = rawEvents.slice(0, pageSize);
    const lastItem = pagedEvents.length > 0 ? pagedEvents[pagedEvents.length - 1] : null;
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem) : null;

    const response = {
      success: true,
      events: pagedEvents,
      data: pagedEvents,
      limit: pageSize,
      hasMore,
      nextCursor,
      scope: isMember ? 'personal' : 'project',
      pagination: {
        hasMore,
        nextCursor,
      },
    };

    // Invariant restricted notice: always emitted for authenticated Members
    if (isMember) {
      response.restricted_activity_context = true;
      response.isPartial = true;
      response.notice = INVARIANT_MEMBER_NOTICE;
      response.memberNotice = 'Timeline reflects assigned tasks and projects only. Unassigned project events are omitted.';
    }

    return res.status(200).json(response);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Get project-scoped activity feed
// @route GET /api/projects/:projectId/activity
const getProjectActivity = async (req, res) => {
  const projectId = req.params?.projectId || req.params?.id;
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
    return res.status(400).json({ success: false, message: 'Invalid project ID format' });
  }
  req.query = req.query || {};
  req.query.project = projectId;
  return getActivityFeed(req, res);
};

// @desc  Get single execution event detail
// @route GET /api/activity/:id
const getEventById = async (req, res) => {
  try {
    const eventId = req.params?.eventId || req.params?.id;
    if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ success: false, message: 'Invalid event ID format' });
    }

    const eventQuery = ExecutionEvent.findById(eventId);
    const event = typeof eventQuery?.populate === 'function'
      ? await eventQuery.populate('project', 'name color owner members')
      : await eventQuery;

    if (!event) {
      return res.status(404).json({ success: false, message: 'Activity event not found' });
    }

    if (req.user && req.user.role === 'member') {
      const memberContext = await buildMemberSecurityFilter(req.user);
      if (!canUserViewEvent(req.user, event, memberContext)) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to view this event',
        });
      }
    }

    return res.status(200).json({
      success: true,
      event,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Ledger coverage diagnostics
// @route GET /api/activity/coverage?project=<projectId>
const getLedgerCoverage = async (req, res) => {
  try {
    const projectId = req.query?.project;
    if (!projectId) {
      if (req.user && req.user.role === 'member') {
        return res.status(403).json({
          success: false,
          message: 'Members are not authorized to view ledger coverage diagnostics',
        });
      }

      let globalCoverage;
      if (mongoose.connection.readyState === 1 || Project.find !== origProjectFind) {
        const [projects, tasks, releases, milestones, decisions, capacities] = await Promise.all([
          Project.find({}).select('_id name aggregateVersion').lean(),
          Task.find({}).select('_id title aggregateVersion').lean(),
          Release.find({}).select('_id name aggregateVersion').lean(),
          Milestone.find({}).select('_id title aggregateVersion').lean(),
          DecisionRecord.find({}).select('_id title aggregateVersion').lean(),
          ProjectCapacity.find({}).select('_id user aggregateVersion').lean(),
        ]);

        const events = await ExecutionEvent.find({}).select('_id subjectId subjectType aggregateVersion').lean();

        globalCoverage = await computeLedgerCoverage({
          projects: projects || [],
          tasks: tasks || [],
          releases: releases || [],
          milestones: milestones || [],
          decisions: decisions || [],
          capacities: capacities || [],
          events: events || [],
        });
      } else {
        globalCoverage = await computeLedgerCoverage();
      }

      return res.status(200).json({
        success: true,
        ...globalCoverage,
      });
    }

    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID format' });
    }

    let projectQuery = Project.findById(projectId);
    if (projectQuery && typeof projectQuery.select === 'function') {
      projectQuery = projectQuery.select('+aggregateVersion');
    }
    const projectDoc = await projectQuery;
    if (!projectDoc) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Role check: Admin receives full details; Project-owning Manager receives scoped status; Member receives 403
    if (req.user.role === 'member') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view activity coverage for this project',
      });
    }

    const isOwnerOrAdmin = req.user.role === 'admin' || canManageProject(req.user, projectDoc);
    if (!isOwnerOrAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only the project owner or an administrator may view coverage diagnostics',
      });
    }

    // Bounded batch queries across all project entities with +aggregateVersion selected
    const [tasks, releases, milestones, decisions, capacities, events] = await Promise.all([
      Task.find({ project: projectId }).select('_id title createdAt +aggregateVersion'),
      Release.find({ project: projectId }).select('_id name version createdAt +aggregateVersion'),
      Milestone.find({ project: projectId }).select('_id title createdAt +aggregateVersion'),
      DecisionRecord.find({ project: projectId }).select('_id title createdAt +aggregateVersion'),
      ProjectCapacity.find({ project: projectId }).select('_id user createdAt +aggregateVersion'),
      ExecutionEvent.find({ project: projectId }).select('_id subjectId subjectType aggregateVersion eventType').lean(),
    ]);

    const coverage = await computeLedgerCoverage({
      projectId,
      project: projectDoc,
      tasks,
      releases,
      milestones,
      decisions,
      capacities,
      events: events || [],
    });

    // If non-admin project-owning manager, return scoped status without sensitive internal diagnostics
    if (req.user.role !== 'admin') {
      return res.status(200).json({
        success: true,
        status: coverage.status,
        summaryNotice: coverage.summaryNotice,
        ledgerEnabledAt: coverage.ledgerEnabledAt,
        checkedAggregates: coverage.checkedAggregates,
      });
    }

    return res.status(200).json({
      success: true,
      ...coverage,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getActivityFeed,
  getActivity: getActivityFeed,
  getProjectActivity,
  getEventById,
  getLedgerCoverage,
  canUserViewEvent,
  buildMemberSecurityFilter,
  encodeCursor,
  decodeCursor,
};
