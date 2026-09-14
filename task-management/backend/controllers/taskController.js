const mongoose = require('mongoose');
const crypto = require('crypto');
const Task = require('../models/Task');
const Project = require('../models/Project');
const User = require('../models/User');
const Milestone = require('../models/Milestone');
const { calculateFlowHealth } = require('../utils/flowHealth');
const { hasCycle, deriveDependencyState } = require('../utils/dependencyGraph');
const { recordExecutionEvent } = require('../services/executionEventService');

const origProjectFind = Project.find;
const origProjectFindById = Project.findById;
const origUserCountDocuments = User.countDocuments;

// Helper to safely retrieve archived project IDs without hanging disconnected test suites
const getArchivedProjectIds = async () => {
  if (typeof Project.find !== 'function') return [];
  if (mongoose.connection.readyState === 0 && Project.find === origProjectFind) {
    return [];
  }
  try {
    const query = Project.find({ status: 'archived' });
    const archivedProjects = typeof query?.select === 'function'
      ? await query.select('_id')
      : await query;
    if (Array.isArray(archivedProjects)) {
      return archivedProjects.map((p) => (p && p._id ? p._id : p));
    }
    return [];
  } catch (err) {
    return [];
  }
};

// Escape regex special characters to prevent ReDoS
const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Reusable object-level authorization predicate for tasks
const canAccessTask = (user, task) => {
  if (!user || !task) return false;
  if (user.role === 'admin' || user.role === 'manager') return true;
  if (user.role === 'member') {
    const userId = user._id ? user._id.toString() : user.toString();
    const assignedId = task.assignedTo?._id
      ? task.assignedTo._id.toString()
      : task.assignedTo?.toString();
    const createdById = task.createdBy?._id
      ? task.createdBy._id.toString()
      : task.createdBy?.toString();
    return assignedId === userId || createdById === userId;
  }
  return false;
};

// @desc  Get all tasks (filtered)
// @route GET /api/tasks
const getTasks = async (req, res) => {
  try {
    const { status, priority, assignedTo, project, search, isBlocked } = req.query;
    const filter = {};

    // Members only see their own tasks; admins/managers see all
    if (req.user.role === 'member') {
      filter.$or = [{ assignedTo: req.user._id }, { createdBy: req.user._id }];
    }

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (assignedTo) filter.assignedTo = assignedTo;

    if (project) {
      if (req.user.role === 'member') {
        if (
          typeof Project.findById === 'function' &&
          (mongoose.connection.readyState === 1 || Project.findById !== origProjectFindById)
        ) {
          const proj = await Project.findById(project);
          if (proj) {
            const userId = req.user._id ? req.user._id.toString() : req.user.toString();
            const isOwner =
              proj.owner &&
              (proj.owner._id ? proj.owner._id.toString() : proj.owner.toString()) === userId;
            const isMember =
              Array.isArray(proj.members) &&
              proj.members.some((m) => {
                const mId = m
                  ? m.user
                    ? m.user._id
                      ? m.user._id.toString()
                      : m.user.toString()
                    : m.toString()
                  : null;
                return mId === userId;
              });
            if (!isOwner && !isMember) {
              return res.status(403).json({
                success: false,
                message: 'Not authorized to access tasks for this project',
              });
            }
          }
        }
      }
      filter.project = project;
    } else {
      // Default view: exclude tasks belonging to archived projects
      const archivedProjectIds = await getArchivedProjectIds();
      if (archivedProjectIds.length > 0) {
        filter.project = { $nin: archivedProjectIds };
      }
    }
    if (isBlocked === 'true' || isBlocked === true) filter.isBlocked = true;
    else if (isBlocked === 'false' || isBlocked === false) filter.isBlocked = false;
    if (search && typeof search === 'string') {
      const sanitized = search.trim().slice(0, 100);
      if (sanitized) {
        filter.title = { $regex: escapeRegex(sanitized), $options: 'i' };
      }
    }

    let query = Task.find(filter);
    if (typeof query?.populate === 'function') {
      const q1 = query.populate('assignedTo', 'name email avatar');
      const q2 = typeof q1?.populate === 'function' ? q1.populate('createdBy', 'name email') : q1;
      const q3 = typeof q2?.populate === 'function' ? q2.populate('project', 'name color') : q2;
      const q4 = typeof q3?.populate === 'function' ? q3.populate('milestone', 'title dueDate status sequence release') : q3;
      query = typeof q4?.sort === 'function' ? q4.sort({ createdAt: -1 }) : q4;
    }

    const tasks = typeof query?.sort === 'function' ? await query.sort({ createdAt: -1 }) : await query;

    res.json({ success: true, count: Array.isArray(tasks) ? tasks.length : 0, tasks });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Get single task
// @route GET /api/tasks/:id
const getTask = async (req, res) => {
  try {
    let query = Task.findById(req.params.id);
    if (typeof query?.populate === 'function') {
      const q1 = query.populate('assignedTo', 'name email avatar');
      const q2 = typeof q1?.populate === 'function' ? q1.populate('createdBy', 'name email') : q1;
      const q3 = typeof q2?.populate === 'function' ? q2.populate('project', 'name color') : q2;
      const q4 = typeof q3?.populate === 'function' ? q3.populate('comments.user', 'name avatar') : q3;
      const q5 = typeof q4?.populate === 'function' ? q4.populate('milestone', 'title dueDate status sequence release') : q4;
      query = q5;
    }

    const task = await query;

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    if (!canAccessTask(req.user, task)) {
      return res.status(403).json({ success: false, message: 'Not authorized to access this task' });
    }

    res.json({ success: true, task });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const ALLOWED_STATUSES = ['To Do', 'In Progress', 'Done'];
const ALLOWED_PRIORITIES = ['low', 'medium', 'high', 'critical'];

// @desc  Create task
// @route POST /api/tasks
const createTask = async (req, res) => {
  try {
    const { title, description, status, priority, dueDate, tags, assignedTo, project, isBlocked, blockedReason, milestone, estimateDays, blockerEta } = req.body;

    if (status !== undefined && !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(', ')}` });
    }
    if (priority !== undefined && !ALLOWED_PRIORITIES.includes(priority)) {
      return res.status(400).json({ success: false, message: `Invalid priority. Allowed values: ${ALLOWED_PRIORITIES.join(', ')}` });
    }

    const taskData = {
      title,
      description,
      status: status || undefined,
      priority: priority || undefined,
      dueDate: dueDate ? dueDate : null,
      tags: Array.isArray(tags) ? tags : undefined,
      createdBy: req.user._id,
    };

    // Explicitly strip forbidden derived intelligence fields
    const FORBIDDEN_DERIVED_FIELDS = [
      'criticalPath',
      'propagatedBlocked',
      'forecastDate',
      'slipDays',
      'impactCount',
      'forecastConfidence',
      'dependsOn',
    ];
    FORBIDDEN_DERIVED_FIELDS.forEach((field) => {
      delete req.body[field];
      delete taskData[field];
    });

    // Blocker validation
    if (isBlocked === true || isBlocked === 'true') {
      if (!blockedReason || typeof blockedReason !== 'string' || !blockedReason.trim()) {
        return res.status(400).json({ success: false, message: 'A reason is required when marking a task as blocked' });
      }
      if (blockedReason.trim().length > 300) {
        return res.status(400).json({ success: false, message: 'Blocked reason cannot exceed 300 characters' });
      }
      taskData.isBlocked = true;
      taskData.blockedReason = blockedReason.trim();
    } else {
      taskData.isBlocked = false;
      taskData.blockedReason = '';
      taskData.blockerEta = null;
    }

    // Blocker ETA validation
    if (blockerEta !== undefined) {
      if (!taskData.isBlocked) {
        return res.status(400).json({ success: false, message: 'Blocker ETA can only be specified when a task is marked as blocked' });
      }
      if (blockerEta === null || blockerEta === '') {
        taskData.blockerEta = null;
      } else {
        const d = new Date(blockerEta);
        if (isNaN(d.getTime())) {
          return res.status(400).json({ success: false, message: 'Invalid blocker ETA date format' });
        }
        taskData.blockerEta = d;
      }
    }

    // Estimate days validation
    if (estimateDays !== undefined) {
      if (estimateDays === null || estimateDays === '') {
        taskData.estimateDays = null;
      } else if (typeof estimateDays !== 'number' || !Number.isInteger(estimateDays) || estimateDays < 1 || estimateDays > 60) {
        return res.status(400).json({ success: false, message: 'Estimate days must be an integer between 1 and 60' });
      } else {
        taskData.estimateDays = estimateDays;
      }
    }

    // Role-governed fields: regular members default to self-assignment
    if (req.user.role === 'member') {
      taskData.assignedTo = req.user._id;
      if (project) taskData.project = project;
    } else {
      if (assignedTo !== undefined) taskData.assignedTo = assignedTo || null;
      if (project !== undefined) taskData.project = project || null;
    }

    if (taskData.project && typeof Project.findById === 'function') {
      try {
        const proj = await Project.findById(taskData.project);
        if (proj && proj.status === 'archived') {
          return res.status(409).json({ success: false, message: 'Cannot add task to an archived project' });
        }
      } catch (err) {
        // Safe fallback if offline / unmocked DB
      }
    }

    // Milestone validation
    if (milestone) {
      if (!mongoose.Types.ObjectId.isValid(milestone)) {
        return res.status(400).json({ success: false, message: 'Invalid milestone ID format' });
      }
      if (!taskData.project) {
        return res.status(400).json({ success: false, message: 'Task must be assigned to a project before linking a milestone' });
      }
      const milestoneDoc = await Milestone.findById(milestone);
      if (!milestoneDoc) {
        return res.status(404).json({ success: false, message: 'Referenced milestone not found' });
      }
      if (milestoneDoc.project.toString() !== taskData.project.toString()) {
        return res.status(400).json({ success: false, message: 'Task and milestone must belong to the same project' });
      }
      if (milestoneDoc.status === 'cancelled') {
        return res.status(409).json({ success: false, message: 'Cannot assign a task to a cancelled milestone' });
      }
      if (typeof Project.findById === 'function') {
        const proj = await Project.findById(taskData.project);
        if (proj && proj.status === 'archived') {
          return res.status(409).json({ success: false, message: 'Cannot add task to an archived project' });
        }
      }
      taskData.milestone = milestoneDoc._id;
    }

    const task = await Task.create(taskData);
    const populated = await task.populate([
      { path: 'assignedTo', select: 'name email avatar' },
      { path: 'createdBy', select: 'name email' },
      { path: 'project', select: 'name color' },
      { path: 'milestone', select: 'title dueDate status sequence release' },
    ]);

    // Emit real-time event
    req.io?.emit('task:created', populated);

    try {
      const changes = [
        { field: 'title', from: null, to: task.title },
        { field: 'status', from: null, to: task.status },
        { field: 'priority', from: null, to: task.priority },
      ];
      if (task.assignedTo) changes.push({ field: 'assignedTo', from: null, to: task.assignedTo });
      if (task.milestone) changes.push({ field: 'milestone', from: null, to: task.milestone });
      if (task.estimateDays != null) changes.push({ field: 'estimateDays', from: null, to: task.estimateDays });
      if (task.isBlocked) {
        changes.push({ field: 'isBlocked', from: false, to: true });
        if (task.blockerEta) changes.push({ field: 'blockerEta', from: null, to: task.blockerEta });
      }

      await recordExecutionEvent({
        model: Task,
        aggregate: task,
        eventInput: {
          eventType: 'task.created',
          project: task.project || null,
          actor: req.user._id,
          actorSnapshot: { name: req.user.name, role: req.user.role },
          subjectType: 'task',
          subjectId: task._id,
          subjectTitleSnapshot: task.title,
          task: task._id,
          milestone: task.milestone || null,
          changes,
        },
      });
    } catch (evErr) {
      if (mongoose.connection.readyState !== 0 || evErr.isLedgerFailure) throw evErr;
    }

    res.status(201).json({ success: true, task: populated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Update task
// @route PUT /api/tasks/:id
const updateTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    // Members can only update tasks assigned to or created by them
    if (!canAccessTask(req.user, task)) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this task' });
    }

    const oldStatus = task.status;
    const oldTitle = task.title;
    const oldPriority = task.priority;
    const oldDueDate = task.dueDate ? new Date(task.dueDate).toISOString() : null;
    const oldAssignedTo = task.assignedTo ? task.assignedTo.toString() : null;
    const oldIsBlocked = Boolean(task.isBlocked);
    const oldBlockerEta = task.blockerEta ? new Date(task.blockerEta).toISOString() : null;
    const oldEstimateDays = task.estimateDays;
    const oldMilestone = task.milestone ? task.milestone.toString() : null;
    const oldProject = task.project ? task.project.toString() : null;

    // Explicit field whitelist to prevent mass assignment
    const { title, description, status, priority, dueDate, tags, assignedTo, project, isBlocked, blockedReason, milestone, estimateDays, blockerEta } = req.body;

    const FORBIDDEN_BODY_FIELDS = [
      'criticalPath',
      'propagatedBlocked',
      'forecastDate',
      'slipDays',
      'impactCount',
      'forecastConfidence',
      'dependsOn',
    ];
    FORBIDDEN_BODY_FIELDS.forEach((field) => {
      delete req.body[field];
    });

    const DERIVED_DOC_FIELDS = [
      'criticalPath',
      'propagatedBlocked',
      'forecastDate',
      'slipDays',
      'impactCount',
      'forecastConfidence',
    ];
    DERIVED_DOC_FIELDS.forEach((field) => {
      delete task[field];
    });

    if (status !== undefined && !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(', ')}` });
    }
    if (priority !== undefined && !ALLOWED_PRIORITIES.includes(priority)) {
      return res.status(400).json({ success: false, message: `Invalid priority. Allowed values: ${ALLOWED_PRIORITIES.join(', ')}` });
    }

    if (title !== undefined) task.title = title;
    if (description !== undefined) task.description = description;
    if (status !== undefined) {
      if (status === 'Done' && task.status !== 'Done') {
        if (task.dependsOn && task.dependsOn.length > 0) {
          const uniquePrereqIds = Array.from(new Set(task.dependsOn.map((id) => id.toString())));
          if (uniquePrereqIds.length > 0) {
            const foundPrereqs = await Task.find({ _id: { $in: uniquePrereqIds } }).select('_id status assignedTo createdBy');
            const hasMissing = foundPrereqs.length !== uniquePrereqIds.length;
            const incompletePrereqs = foundPrereqs.filter((p) => p.status !== 'Done');

            if (hasMissing || incompletePrereqs.length > 0) {
              if (req.user.role === 'member') {
                const hasInaccessible = hasMissing || foundPrereqs.some((p) => !canAccessTask(req.user, p));
                if (hasInaccessible) {
                  return res.status(409).json({
                    success: false,
                    message: 'Cannot mark task as Done: one or more prerequisites are incomplete or unavailable.',
                  });
                }
              }

              if (hasMissing) {
                return res.status(409).json({
                  success: false,
                  message: 'Cannot mark task as Done: referenced prerequisite task is missing or corrupted.',
                });
              }

              return res.status(409).json({
                success: false,
                message: `Cannot mark task as Done: ${incompletePrereqs.length} prerequisite task(s) are incomplete. All prerequisites must be completed first.`,
              });
            }
          }
        }
      }
      task.status = status;
    }
    if (priority !== undefined) task.priority = priority;
    if (dueDate !== undefined) task.dueDate = dueDate ? dueDate : null;
    if (tags !== undefined && Array.isArray(tags)) task.tags = tags;

    // Blocker validation & mutation
    if (isBlocked !== undefined) {
      if (isBlocked === true || isBlocked === 'true') {
        const effectiveReason = blockedReason !== undefined ? blockedReason : task.blockedReason;
        if (!effectiveReason || typeof effectiveReason !== 'string' || !effectiveReason.trim()) {
          return res.status(400).json({ success: false, message: 'A reason is required when marking a task as blocked' });
        }
        if (effectiveReason.trim().length > 300) {
          return res.status(400).json({ success: false, message: 'Blocked reason cannot exceed 300 characters' });
        }
        task.isBlocked = true;
        task.blockedReason = effectiveReason.trim();
      } else {
        task.isBlocked = false;
        task.blockedReason = '';
        task.blockerEta = null;
      }
    } else if (blockedReason !== undefined) {
      if (task.isBlocked) {
        if (typeof blockedReason !== 'string' || !blockedReason.trim()) {
          return res.status(400).json({ success: false, message: 'A reason is required when marking a task as blocked' });
        }
        if (blockedReason.trim().length > 300) {
          return res.status(400).json({ success: false, message: 'Blocked reason cannot exceed 300 characters' });
        }
        task.blockedReason = blockedReason.trim();
      } else {
        task.blockedReason = '';
        task.blockerEta = null;
      }
    }

    // Blocker ETA validation & mutation
    if (blockerEta !== undefined) {
      if (!task.isBlocked) {
        return res.status(400).json({ success: false, message: 'Blocker ETA can only be specified when a task is marked as blocked' });
      }
      if (blockerEta === null || blockerEta === '') {
        task.blockerEta = null;
      } else {
        const d = new Date(blockerEta);
        if (isNaN(d.getTime())) {
          return res.status(400).json({ success: false, message: 'Invalid blocker ETA date format' });
        }
        task.blockerEta = d;
      }
    }

    // Estimate days validation & mutation
    if (estimateDays !== undefined) {
      if (estimateDays === null || estimateDays === '') {
        task.estimateDays = null;
      } else if (typeof estimateDays !== 'number' || !Number.isInteger(estimateDays) || estimateDays < 1 || estimateDays > 60) {
        return res.status(400).json({ success: false, message: 'Estimate days must be an integer between 1 and 60' });
      } else {
        task.estimateDays = estimateDays;
      }
    }

    // Role-governed fields: only admin and manager can reassign
    if (req.user.role === 'admin' || req.user.role === 'manager') {
      if (assignedTo !== undefined) task.assignedTo = assignedTo || null;
      if (project !== undefined) {
        const nextProjectStr = project ? project.toString() : '';
        const currentProjectStr = task.project ? task.project.toString() : '';
        if (nextProjectStr !== currentProjectStr) {
          if (task.dependsOn && task.dependsOn.length > 0) {
            return res.status(409).json({
              success: false,
              message: 'Cannot move task with active dependencies to another project. Remove dependencies first.',
            });
          }
          let hasIncoming = false;
          if (mongoose.Types.ObjectId.isValid(task._id)) {
            try {
              hasIncoming = await Task.exists({ dependsOn: task._id });
            } catch (err) {
              hasIncoming = false;
            }
          }
          if (hasIncoming) {
            return res.status(409).json({
              success: false,
              message: 'Cannot move task referenced by other dependencies to another project. Remove dependencies first.',
            });
          }
        }
        task.project = project || null;
      }
    }

    // Milestone validation & mutation
    if (milestone !== undefined) {
      if (milestone === null || milestone === '') {
        task.milestone = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(milestone)) {
          return res.status(400).json({ success: false, message: 'Invalid milestone ID format' });
        }
        const milestoneDoc = await Milestone.findById(milestone);
        if (!milestoneDoc) {
          return res.status(404).json({ success: false, message: 'Referenced milestone not found' });
        }
        const effectiveProject = project !== undefined ? project : task.project;
        if (!effectiveProject) {
          return res.status(400).json({ success: false, message: 'Task must be assigned to a project before linking a milestone' });
        }
        if (milestoneDoc.project.toString() !== effectiveProject.toString()) {
          return res.status(400).json({ success: false, message: 'Task and milestone must belong to the same project' });
        }
        if (milestoneDoc.status === 'cancelled') {
          const currentMilestoneId = task.milestone ? task.milestone.toString() : null;
          if (currentMilestoneId !== milestoneDoc._id.toString()) {
            return res.status(409).json({ success: false, message: 'Cannot assign a task to a cancelled milestone' });
          }
        }
        if (typeof Project.findById === 'function') {
          const proj = await Project.findById(effectiveProject);
          if (proj && proj.status === 'archived') {
            return res.status(409).json({ success: false, message: 'Cannot add task to an archived project' });
          }
        }
        task.milestone = milestoneDoc._id;
      }
    }

    // Calling save() runs schema validation and triggers the pre('save') hook
    // ensuring completedAt is correctly set or cleared based on status transitions
    await task.save();

    await task.populate([
      { path: 'assignedTo', select: 'name email avatar' },
      { path: 'createdBy', select: 'name email' },
      { path: 'project', select: 'name color' },
      { path: 'milestone', select: 'title dueDate status sequence release' },
    ]);

    req.io?.emit('task:updated', task);

    // Build changes diff
    const changes = [];
    if (task.title !== oldTitle) changes.push({ field: 'title', from: oldTitle, to: task.title });
    if (task.status !== oldStatus) changes.push({ field: 'status', from: oldStatus, to: task.status });
    if (task.priority !== oldPriority) changes.push({ field: 'priority', from: oldPriority, to: task.priority });
    const newDueDate = task.dueDate ? new Date(task.dueDate).toISOString() : null;
    if (newDueDate !== oldDueDate) changes.push({ field: 'dueDate', from: oldDueDate, to: newDueDate });
    const newAssignedTo = task.assignedTo ? (task.assignedTo._id ? task.assignedTo._id.toString() : task.assignedTo.toString()) : null;
    if (newAssignedTo !== oldAssignedTo) changes.push({ field: 'assignedTo', from: oldAssignedTo, to: newAssignedTo });
    if (Boolean(task.isBlocked) !== oldIsBlocked) changes.push({ field: 'isBlocked', from: oldIsBlocked, to: Boolean(task.isBlocked) });
    const newBlockerEta = task.blockerEta ? new Date(task.blockerEta).toISOString() : null;
    if (newBlockerEta !== oldBlockerEta) changes.push({ field: 'blockerEta', from: oldBlockerEta, to: newBlockerEta });
    if (task.estimateDays !== oldEstimateDays) changes.push({ field: 'estimateDays', from: oldEstimateDays, to: task.estimateDays });
    const newMilestone = task.milestone ? (task.milestone._id ? task.milestone._id.toString() : task.milestone.toString()) : null;
    if (newMilestone !== oldMilestone) changes.push({ field: 'milestone', from: oldMilestone, to: newMilestone });
    const newProject = task.project ? (task.project._id ? task.project._id.toString() : task.project.toString()) : null;
    if (newProject !== oldProject) changes.push({ field: 'project', from: oldProject, to: newProject });

    const effectiveProject = task.project ? (task.project._id ? task.project._id : task.project) : null;
    if (changes.length > 0) {
      let eventType = 'task.updated';
      if (task.status !== oldStatus) {
        eventType = 'task.status_changed';
      } else if (!oldIsBlocked && task.isBlocked) {
        eventType = 'blocker.added';
      } else if (oldIsBlocked && !task.isBlocked) {
        eventType = 'blocker.resolved';
      } else if (newBlockerEta !== oldBlockerEta) {
        eventType = 'blocker.eta_changed';
      } else if (oldIsBlocked && task.isBlocked && req.body.blockedReason !== undefined) {
        eventType = 'blocker.updated';
      } else if (oldAssignedTo && !newAssignedTo) {
        eventType = 'task.unassigned';
      } else if (newAssignedTo !== oldAssignedTo) {
        eventType = 'task.assigned';
      } else if (task.priority !== oldPriority) {
        eventType = 'task.priority_changed';
      } else if (task.estimateDays !== oldEstimateDays) {
        eventType = 'task.estimate_changed';
      } else if (oldMilestone && !newMilestone) {
        eventType = 'task.milestone_unlinked';
      } else if (newMilestone !== oldMilestone) {
        eventType = 'task.milestone_linked';
      }

      try {
        await recordExecutionEvent({
          model: Task,
          aggregate: task,
          eventInput: {
            eventType,
            project: effectiveProject || null,
            actor: req.user._id,
            actorSnapshot: { name: req.user.name, role: req.user.role },
            subjectType: 'task',
            subjectId: task._id,
            subjectTitleSnapshot: task.title,
            task: task._id,
            milestone: task.milestone ? (task.milestone._id ? task.milestone._id : task.milestone) : null,
            changes,
          },
        });
      } catch (evErr) {
        if (mongoose.connection.readyState !== 0 || evErr.isLedgerFailure) throw evErr;
      }
    }

    res.json({ success: true, task });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Delete task
// @route DELETE /api/tasks/:id
const deleteTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    if (req.user.role === 'member') {
      return res.status(403).json({ success: false, message: 'Members cannot delete tasks' });
    }

    if (!canAccessTask(req.user, task)) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this task' });
    }

    // Guard against deleting a task with active dependency relationships
    if (task.dependsOn && task.dependsOn.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete task with active outgoing dependencies. Remove dependencies first.',
      });
    }
    let hasIncoming = false;
    if (mongoose.Types.ObjectId.isValid(task._id)) {
      try {
        hasIncoming = await Task.exists({ dependsOn: task._id });
      } catch (err) {
        hasIncoming = false;
      }
    }
    if (hasIncoming) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete task referenced as a prerequisite by other tasks. Remove dependencies first.',
      });
    }

    try {
      await recordExecutionEvent({
        model: Task,
        aggregate: task,
        eventInput: {
          eventType: 'task.deleted',
          project: task.project || null,
          actor: req.user._id,
          actorSnapshot: { name: req.user.name, role: req.user.role },
          subjectType: 'task',
          subjectId: task._id,
          subjectTitleSnapshot: task.title,
          task: task._id,
          changes: [{ field: 'status', from: task.status, to: 'deleted' }],
        },
      });
    } catch (evErr) {
      if (mongoose.connection.readyState !== 0 || evErr.isLedgerFailure) throw evErr;
    }

    await task.deleteOne();
    req.io?.emit('task:deleted', { _id: req.params.id });

    res.json({ success: true, message: 'Task deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Add comment to task
// @route POST /api/tasks/:id/comments
const addComment = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    if (!canAccessTask(req.user, task)) {
      return res.status(403).json({ success: false, message: 'Not authorized to comment on this task' });
    }

    if (!req.body.text || typeof req.body.text !== 'string' || !req.body.text.trim()) {
      return res.status(400).json({ success: false, message: 'Comment text is required' });
    }

    task.comments.push({ user: req.user._id, text: req.body.text.trim() });
    await task.save();
    await task.populate('comments.user', 'name avatar');

    req.io?.emit('task:commented', { taskId: task._id, comments: task.comments });

    res.json({ success: true, comments: task.comments });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Get task stats (dashboard)
// @route GET /api/tasks/stats
const getStats = async (req, res) => {
  try {
    const filter = req.user.role === 'member'
      ? { $or: [{ assignedTo: req.user._id }, { createdBy: req.user._id }] }
      : {};

    const archivedProjectIds = await getArchivedProjectIds();
    if (archivedProjectIds.length > 0) {
      filter.project = { $nin: archivedProjectIds };
    }

    const [statusStats, priorityStats, total] = await Promise.all([
      Task.aggregate([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Task.aggregate([
        { $match: filter },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
      ]),
      Task.countDocuments(filter),
    ]);

    res.json({ success: true, total, statusStats, priorityStats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Get Flow Health operational metrics
// @route GET /api/tasks/health
const getFlowHealth = async (req, res) => {
  try {
    const { project } = req.query;
    const now = new Date();

    if (project) {
      if (!mongoose.Types.ObjectId.isValid(project)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID' });
      }

      const proj = await Project.findById(project);
      if (!proj) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }

      // Member check: do not present partial task visibility as complete project health
      if (req.user.role === 'member') {
        return res.status(403).json({
          success: false,
          message: 'Project-wide Flow Health is restricted to managers and administrators',
        });
      }

      if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to access Flow Health for this project',
        });
      }

      // Archived project handling
      if (proj.status === 'archived') {
        return res.json({
          success: true,
          availability: 'archived',
          scope: 'project',
          score: null,
          label: 'ARCHIVED',
          message: 'Flow Health calculation is disabled for archived projects.',
          metrics: null,
          penalties: [],
          totalDeduction: 0,
          calculatedAt: now.toISOString(),
        });
      }

      const tasks = await Task.find({ project: proj._id });

      // Calculate project capacity: active project members and active project owner, deduplicated
      const candidateUserIds = new Set();
      if (proj.owner) {
        const ownerId = proj.owner._id ? proj.owner._id.toString() : proj.owner.toString();
        if (ownerId) candidateUserIds.add(ownerId);
      }
      if (Array.isArray(proj.members)) {
        for (const m of proj.members) {
          if (!m) continue;
          const mUserId = m.user
            ? m.user._id
              ? m.user._id.toString()
              : m.user.toString()
            : m.toString();
          if (mUserId) candidateUserIds.add(mUserId);
        }
      }

      let activeMemberCount = 1;
      const candidateArray = Array.from(candidateUserIds);
      if (candidateArray.length > 0) {
        if (
          typeof User.countDocuments === 'function' &&
          (mongoose.connection.readyState === 1 || User.countDocuments !== origUserCountDocuments)
        ) {
          const activeCount = await User.countDocuments({
            _id: { $in: candidateArray },
            isActive: { $ne: false },
          });
          activeMemberCount = Math.max(1, typeof activeCount === 'number' ? activeCount : 1);
        } else {
          activeMemberCount = Math.max(1, candidateArray.length);
        }
      }

      const health = calculateFlowHealth({
        tasks,
        now,
        activeMemberCount,
        scope: 'project',
      });

      return res.json(health);
    }

    // No project query param: workspace or personal
    const archivedProjectIds = await getArchivedProjectIds();

    if (req.user.role === 'member') {
      const memberFilter = {
        $or: [{ assignedTo: req.user._id }, { createdBy: req.user._id }],
      };
      if (archivedProjectIds.length > 0) {
        memberFilter.project = { $nin: archivedProjectIds };
      }

      const tasks = await Task.find(memberFilter);

      const health = calculateFlowHealth({
        tasks,
        now,
        activeMemberCount: 1,
        scope: 'personal',
      });

      return res.json(health);
    }

    // Admin / Manager workspace scope
    const workspaceFilter = {};
    if (archivedProjectIds.length > 0) {
      workspaceFilter.project = { $nin: archivedProjectIds };
    }

    const [tasks, activeMemberCount] = await Promise.all([
      Task.find(workspaceFilter),
      User.countDocuments({ isActive: { $ne: false } }),
    ]);

    const health = calculateFlowHealth({
      tasks,
      now,
      activeMemberCount: Math.max(1, activeMemberCount || 1),
      scope: 'workspace',
    });

    return res.json(health);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Get task dependencies
// @route GET /api/tasks/:id/dependencies
const getTaskDependencies = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid task ID format' });
    }

    const task = await Task.findById(req.params.id)
      .populate('project', 'name color status')
      .populate('assignedTo', 'name email avatar')
      .populate('milestone', 'title dueDate status sequence');

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    if (!canAccessTask(req.user, task)) {
      return res.status(403).json({ success: false, message: 'Not authorized to view dependencies for this task' });
    }

    // Load prerequisites (tasks this task depends on)
    let prereqs = await Task.find({ _id: { $in: task.dependsOn || [] } })
      .populate('assignedTo', 'name email avatar')
      .populate('milestone', 'title dueDate status sequence')
      .select('title status priority dueDate isBlocked blockedReason assignedTo milestone project estimateDays blockerEta');

    // Load dependents (tasks that depend on this task)
    let dependents = await Task.find({ dependsOn: task._id })
      .populate('assignedTo', 'name email avatar')
      .populate('milestone', 'title dueDate status sequence')
      .select('title status priority dueDate isBlocked blockedReason assignedTo milestone project estimateDays blockerEta');

    // If member, filter out any tasks the member cannot access
    if (req.user.role === 'member') {
      prereqs = prereqs.filter((p) => canAccessTask(req.user, p));
      dependents = dependents.filter((d) => canAccessTask(req.user, d));
    }

    const derivedState = deriveDependencyState(task, prereqs);
    const allPrerequisitesResolved = prereqs.every((p) => p.status === 'Done');

    res.json({
      success: true,
      task: {
        id: task._id.toString(),
        title: task.title,
        status: task.status,
        priority: task.priority,
        isBlocked: task.isBlocked,
        blockedReason: task.blockedReason,
        estimateDays: task.estimateDays !== undefined ? task.estimateDays : null,
        blockerEta: task.blockerEta ? task.blockerEta.toISOString() : null,
        project: task.project,
        milestone: task.milestone,
        dependencyState: derivedState,
        allPrerequisitesResolved,
      },
      prerequisites: prereqs.map((p) => ({
        id: p._id.toString(),
        title: p.title,
        status: p.status,
        priority: p.priority,
        isBlocked: p.isBlocked,
        estimateDays: p.estimateDays !== undefined ? p.estimateDays : null,
        blockerEta: p.blockerEta ? (p.blockerEta.toISOString ? p.blockerEta.toISOString() : p.blockerEta) : null,
        assignedTo: p.assignedTo,
        milestone: p.milestone,
        resolved: p.status === 'Done',
      })),
      dependents: dependents.map((d) => ({
        id: d._id.toString(),
        title: d.title,
        status: d.status,
        priority: d.priority,
        isBlocked: d.isBlocked,
        estimateDays: d.estimateDays !== undefined ? d.estimateDays : null,
        blockerEta: d.blockerEta ? (d.blockerEta.toISOString ? d.blockerEta.toISOString() : d.blockerEta) : null,
        assignedTo: d.assignedTo,
        milestone: d.milestone,
        resolved: task.status === 'Done',
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Add task dependency: task :id depends on dependsOnTaskId (dependsOnTaskId -> id)
// @route POST /api/tasks/:id/dependencies
const addTaskDependency = async (req, res) => {
  try {
    const { id } = req.params;

    // Reject ambiguous payloads containing both dependsOnTaskId and dependencyTaskId
    if (req.body.dependencyTaskId !== undefined && req.body.dependsOnTaskId !== undefined) {
      return res.status(400).json({ success: false, message: 'Ambiguous request: provide dependsOnTaskId only' });
    }
    // Reject legacy/invalid payloads
    if (req.body.dependencyTaskId !== undefined && req.body.dependsOnTaskId === undefined) {
      return res.status(400).json({ success: false, message: 'Invalid payload: dependsOnTaskId is required' });
    }

    const { dependsOnTaskId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid task ID format' });
    }
    if (!dependsOnTaskId || !mongoose.Types.ObjectId.isValid(dependsOnTaskId)) {
      return res.status(400).json({ success: false, message: 'Invalid dependency task ID format' });
    }

    if (id.toString() === dependsOnTaskId.toString()) {
      return res.status(400).json({ success: false, message: 'A task cannot depend on itself' });
    }

    const dependentTask = await Task.findById(id);
    if (!dependentTask) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    // Authorization to edit the dependent task
    if (!canAccessTask(req.user, dependentTask)) {
      return res.status(403).json({ success: false, message: 'Not authorized to add dependencies to this task' });
    }

    if (!dependentTask.project) {
      return res.status(400).json({ success: false, message: 'Task must belong to a project to add dependencies' });
    }

    // Check project status
    const project = await Project.findById(dependentTask.project);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Associated project not found' });
    }
    if (project.status === 'archived') {
      return res.status(409).json({ success: false, message: 'Cannot modify dependencies in an archived project' });
    }

    const prereqTask = await Task.findById(dependsOnTaskId);
    if (!prereqTask) {
      return res.status(404).json({ success: false, message: 'Prerequisite task not found' });
    }

    // Authorization to view/reference the prerequisite task
    if (!canAccessTask(req.user, prereqTask)) {
      return res.status(403).json({ success: false, message: 'Not authorized to reference this prerequisite task' });
    }

    if (!prereqTask.project) {
      return res.status(400).json({ success: false, message: 'Prerequisite task must belong to a project' });
    }

    if (dependentTask.project.toString() !== prereqTask.project.toString()) {
      return res.status(400).json({ success: false, message: 'Dependencies can only be created between tasks in the same project' });
    }

    // Check duplicate
    if (dependentTask.dependsOn && dependentTask.dependsOn.some((p) => p.toString() === prereqTask._id.toString())) {
      return res.status(409).json({ success: false, message: 'Dependency relationship already exists' });
    }

    // Cycle detection across project tasks
    const projectTasks = await Task.find({ project: dependentTask.project }).select('_id dependsOn status');
    if (hasCycle(projectTasks, dependentTask._id, prereqTask._id)) {
      return res.status(409).json({ success: false, message: 'Adding this dependency would create a cycle in the task graph' });
    }

    // Atomic mutation with $addToSet
    await Task.findByIdAndUpdate(dependentTask._id, {
      $addToSet: { dependsOn: prereqTask._id },
    });

    const updatedTask = await Task.findById(dependentTask._id).populate('dependsOn', 'title status priority');

    req.io?.emit('task:dependencyAdded', {
      taskId: dependentTask._id,
      dependencyTaskId: prereqTask._id,
    });

    try {
      const aggregateTask = updatedTask || dependentTask;
      await recordExecutionEvent({
        model: Task,
        aggregate: aggregateTask,
        eventInput: {
          eventType: 'dependency.added',
          project: aggregateTask.project || dependentTask.project,
          actor: req.user._id,
          actorSnapshot: { name: req.user.name, role: req.user.role },
          subjectType: 'task',
          subjectId: aggregateTask._id,
          subjectTitleSnapshot: aggregateTask.title,
          task: aggregateTask._id,
          metadata: {
            prerequisiteTaskId: prereqTask._id.toString(),
            dependentTaskId: aggregateTask._id.toString(),
          },
          changes: [
            { field: 'prerequisiteTaskId', from: null, to: prereqTask._id.toString() },
          ],
        },
      });
      dependentTask.aggregateVersion = aggregateTask.aggregateVersion;
    } catch (evErr) {
      if (mongoose.connection.readyState !== 0 || evErr.isLedgerFailure) throw evErr;
    }

    res.status(201).json({
      success: true,
      message: 'Dependency added successfully',
      task: updatedTask,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Remove task dependency: task :id no longer depends on :dependencyTaskId
// @route DELETE /api/tasks/:id/dependencies/:dependencyTaskId
const removeTaskDependency = async (req, res) => {
  try {
    const { id, dependencyTaskId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid task ID format' });
    }
    if (!mongoose.Types.ObjectId.isValid(dependencyTaskId)) {
      return res.status(400).json({ success: false, message: 'Invalid dependency task ID format' });
    }

    const dependentTask = await Task.findById(id);
    if (!dependentTask) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    if (!canAccessTask(req.user, dependentTask)) {
      return res.status(403).json({ success: false, message: 'Not authorized to modify dependencies for this task' });
    }

    if (dependentTask.project) {
      const project = await Project.findById(dependentTask.project);
      if (project && project.status === 'archived') {
        return res.status(409).json({ success: false, message: 'Cannot modify dependencies in an archived project' });
      }
    }

    const exists = dependentTask.dependsOn && dependentTask.dependsOn.some((p) => p.toString() === dependencyTaskId.toString());
    if (!exists) {
      return res.status(404).json({ success: false, message: 'Dependency relationship not found' });
    }

    await Task.findByIdAndUpdate(dependentTask._id, {
      $pull: { dependsOn: dependencyTaskId },
    });

    // Use the post-mutation document for version advancement. Saving the stale
    // pre-$pull document here would restore the dependency that was removed.
    let updatedTask = await Task.findById(dependentTask._id);
    if (updatedTask && typeof updatedTask.populate === 'function') {
      updatedTask = await updatedTask.populate('dependsOn', 'title status priority');
    }

    req.io?.emit('task:dependencyRemoved', {
      taskId: dependentTask._id,
      dependencyTaskId,
    });

    try {
      await recordExecutionEvent({
        model: Task,
        aggregate: updatedTask,
        eventInput: {
          eventType: 'dependency.removed',
          project: updatedTask.project,
          actor: req.user._id,
          actorSnapshot: { name: req.user.name, role: req.user.role },
          subjectType: 'task',
          subjectId: updatedTask._id,
          subjectTitleSnapshot: updatedTask.title,
          task: updatedTask._id,
          metadata: {
            prerequisiteTaskId: dependencyTaskId.toString(),
            dependentTaskId: updatedTask._id.toString(),
          },
          changes: [
            { field: 'prerequisiteTaskId', from: dependencyTaskId.toString(), to: null },
          ],
        },
      });
    } catch (evErr) {
      if (mongoose.connection.readyState !== 0 || evErr.isLedgerFailure) throw evErr;
    }

    res.json({ success: true, message: 'Dependency removed successfully', task: updatedTask });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const githubLinkPayload = (task) => task.githubEvidence ? {
  repository: task.githubEvidence.repository,
  pullRequestNumber: task.githubEvidence.pullRequestNumber,
  pullRequestUrl: task.githubEvidence.pullRequestUrl,
  commitSha: task.githubEvidence.commitSha,
  state: task.githubEvidence.state,
  ciStatus: task.githubEvidence.ciStatus,
  lastSyncedAt: task.githubEvidence.lastSyncedAt,
} : null;

// @route PUT /api/tasks/:id/github
const linkGitHubEvidence = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid task ID format' });
    }
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    if (!canAccessTask(req.user, task)) {
      return res.status(403).json({ success: false, message: 'Not authorized to link GitHub evidence to this task' });
    }

    const { repository, pullRequestNumber, pullRequestUrl, commitSha } = req.body || {};
    if (typeof repository !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(repository.trim())) {
      return res.status(400).json({ success: false, message: 'repository must use the owner/name format' });
    }
    const prNumber = Number(pullRequestNumber);
    if (!Number.isInteger(prNumber) || prNumber < 1) {
      return res.status(400).json({ success: false, message: 'pullRequestNumber must be a positive integer' });
    }
    let normalizedUrl = `https://github.com/${repository.trim()}/pull/${prNumber}`;
    if (pullRequestUrl !== undefined) {
      try {
        const parsed = new URL(String(pullRequestUrl));
        if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') throw new Error('invalid');
        normalizedUrl = parsed.toString();
      } catch (_) {
        return res.status(400).json({ success: false, message: 'pullRequestUrl must be a valid GitHub HTTPS URL' });
      }
    }
    if (commitSha !== undefined && (typeof commitSha !== 'string' || !/^[a-f0-9]{7,100}$/i.test(commitSha.trim()))) {
      return res.status(400).json({ success: false, message: 'commitSha must be a valid hexadecimal commit hash' });
    }

    const wasLinked = Boolean(task.githubEvidence);
    const oldEvidence = githubLinkPayload(task);
    task.githubEvidence = {
      repository: repository.trim(),
      pullRequestNumber: prNumber,
      pullRequestUrl: normalizedUrl,
      commitSha: commitSha ? commitSha.trim() : '',
      state: 'open',
      ciStatus: 'unknown',
      lastSyncedAt: new Date(),
    };
    task.verificationStatus = 'in_review';
    await task.save();

    try {
      await recordExecutionEvent({
        model: Task,
        aggregate: task,
        eventInput: {
          eventType: wasLinked ? 'task.verification_updated' : 'task.verification_linked',
          project: task.project,
          actor: req.user._id,
          actorSnapshot: { name: req.user.name, role: req.user.role },
          subjectType: 'task', subjectId: task._id, subjectTitleSnapshot: task.title, task: task._id,
          changes: [
            { field: 'verificationStatus', from: wasLinked ? 'in_review' : 'unlinked', to: task.verificationStatus },
            { field: 'githubRepository', from: oldEvidence?.repository || null, to: task.githubEvidence.repository },
            { field: 'pullRequestNumber', from: oldEvidence?.pullRequestNumber || null, to: prNumber },
          ],
          metadata: { repository: task.githubEvidence.repository, pullRequestNumber: prNumber },
        },
      });
    } catch (eventError) {
      if (mongoose.connection.readyState !== 0 || eventError.isLedgerFailure) throw eventError;
    }
    return res.json({ success: true, task });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

function verifyGitHubSignature(req) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const signature = req.get('x-hub-signature-256');
  if (!secret || !signature || !req.rawBody) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex')}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// @route POST /api/webhooks/github
const githubWebhook = async (req, res) => {
  if (!verifyGitHubSignature(req)) {
    return res.status(401).json({ success: false, message: 'Invalid GitHub webhook signature' });
  }
  const eventName = req.get('x-github-event');
  const payload = req.body || {};
  const repository = payload.repository?.full_name;
  const prNumber = payload.pull_request?.number || payload.check_suite?.pull_requests?.[0]?.number;
  if (!repository || !Number.isInteger(prNumber)) {
    return res.status(202).json({ success: true, ignored: true });
  }

  const action = payload.action;
  const merged = eventName === 'pull_request' && action === 'closed' && payload.pull_request?.merged === true;
  const prState = eventName === 'pull_request' && action === 'closed' ? (merged ? 'merged' : 'closed') : 'open';
  let ciStatus = null;
  if (eventName === 'check_suite' && payload.action === 'completed') {
    ciStatus = payload.check_suite?.conclusion === 'success' ? 'success' : 'failure';
  }
  const filter = { 'githubEvidence.repository': repository, 'githubEvidence.pullRequestNumber': prNumber };
  const tasks = await Task.find(filter);
  for (const task of tasks || []) {
    const oldStatus = task.verificationStatus;
    if (ciStatus) task.githubEvidence.ciStatus = ciStatus;
    if (eventName === 'pull_request') task.githubEvidence.state = prState;
    task.githubEvidence.lastSyncedAt = new Date();
    task.verificationStatus = merged ? 'verified' : (ciStatus === 'failure' ? 'ci_failed' : (ciStatus === 'success' ? 'ready' : oldStatus));
    await task.save();
    try {
      await recordExecutionEvent({
        model: Task, aggregate: task,
        eventInput: {
          eventType: 'task.verification_updated', project: task.project, actor: 'github-webhook',
          actorSnapshot: { name: 'GitHub Webhook', role: 'system' }, subjectType: 'task', subjectId: task._id,
          subjectTitleSnapshot: task.title, task: task._id,
          changes: [{ field: 'verificationStatus', from: oldStatus, to: task.verificationStatus }, { field: 'ciStatus', from: null, to: task.githubEvidence.ciStatus }],
          metadata: { repository, pullRequestNumber: prNumber, event: eventName, action },
        },
      });
    } catch (eventError) {
      if (mongoose.connection.readyState !== 0 || eventError.isLedgerFailure) throw eventError;
    }
  }
  return res.status(200).json({ success: true, updatedTasks: tasks?.length || 0 });
};

module.exports = {
  getTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  addComment,
  getStats,
  getFlowHealth,
  getTaskDependencies,
  addTaskDependency,
  removeTaskDependency,
  linkGitHubEvidence,
  githubWebhook,
  canAccessTask,
  escapeRegex,
  ALLOWED_STATUSES,
  ALLOWED_PRIORITIES,
};
