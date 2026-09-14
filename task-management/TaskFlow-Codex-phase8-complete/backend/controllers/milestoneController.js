const mongoose = require('mongoose');
const Milestone = require('../models/Milestone');
const Release = require('../models/Release');
const Task = require('../models/Task');
const Project = require('../models/Project');
const { canUserViewProject, canUserManageProject } = require('./releaseController');
const { recordExecutionEvent } = require('../services/executionEventService');

const ALLOWED_MILESTONE_STATUSES = ['open', 'at-risk', 'completed', 'cancelled'];

// @desc  Get all milestones
// @route GET /api/milestones
const getMilestones = async (req, res) => {
  try {
    const { project, release, status } = req.query;
    const filter = {};

    if (project) {
      if (!mongoose.Types.ObjectId.isValid(project)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID format' });
      }
      const proj = await Project.findById(project);
      if (!proj) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }
      if (!canUserViewProject(req.user, proj)) {
        return res.status(403).json({ success: false, message: 'Not authorized to access milestones for this project' });
      }
      filter.project = project;
    } else {
      // If member, only list milestones for projects they belong to
      if (req.user.role === 'member') {
        const userProjects = await Project.find({ 'members.user': req.user._id }).select('_id');
        filter.project = { $in: userProjects.map((p) => p._id) };
      }
    }

    if (release) {
      if (!mongoose.Types.ObjectId.isValid(release)) {
        return res.status(400).json({ success: false, message: 'Invalid release ID format' });
      }
      filter.release = release;
    }

    if (status) {
      if (status !== 'all' && !ALLOWED_MILESTONE_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed values: ${ALLOWED_MILESTONE_STATUSES.join(', ')}`,
        });
      }
      if (status !== 'all') {
        filter.status = status;
      }
    } else if (req.query.includeCancelled !== 'true') {
      filter.status = { $ne: 'cancelled' };
    }

    const milestones = await Milestone.find(filter)
      .populate('project', 'name color status')
      .populate('release', 'name version targetDate status')
      .populate('createdBy', 'name email avatar')
      .sort({ sequence: 1, dueDate: 1, createdAt: 1 });

    // Attach task count summaries using a single bounded batch query (O(1) database roundtrips)
    const milestoneIds = milestones.map((m) => m._id);
    const tasks = milestoneIds.length > 0
      ? await Task.find({ milestone: { $in: milestoneIds } }).select('status isBlocked milestone')
      : [];

    const metricsByMilestone = new Map();
    for (const t of tasks) {
      if (!t.milestone) continue;
      const mKey = t.milestone.toString();
      if (!metricsByMilestone.has(mKey)) {
        metricsByMilestone.set(mKey, { totalTasks: 0, completedTasks: 0, blockedTasks: 0 });
      }
      const entry = metricsByMilestone.get(mKey);
      entry.totalTasks += 1;
      if (t.status === 'Done') entry.completedTasks += 1;
      if (t.isBlocked && t.status !== 'Done') entry.blockedTasks += 1;
    }

    const milestonesWithCounts = milestones.map((m) => {
      const mKey = m._id.toString();
      const taskMetrics = metricsByMilestone.get(mKey) || { totalTasks: 0, completedTasks: 0, blockedTasks: 0 };
      return {
        ...m.toObject(),
        taskMetrics,
      };
    });

    res.json({
      success: true,
      count: milestonesWithCounts.length,
      milestones: milestonesWithCounts,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Get single milestone
// @route GET /api/milestones/:id
const getMilestone = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid milestone ID format' });
    }

    const milestone = await Milestone.findById(req.params.id)
      .populate('project', 'name color status owner members')
      .populate('release', 'name version targetDate status')
      .populate('createdBy', 'name email avatar');

    if (!milestone) {
      return res.status(404).json({ success: false, message: 'Milestone not found' });
    }

    if (!canUserViewProject(req.user, milestone.project)) {
      return res.status(403).json({ success: false, message: 'Not authorized to access this milestone' });
    }

    const tasks = await Task.find({ milestone: milestone._id })
      .populate('assignedTo', 'name email avatar')
      .select('title status priority dueDate isBlocked blockedReason');

    res.json({
      success: true,
      milestone,
      tasks,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Create milestone
// @route POST /api/milestones
const createMilestone = async (req, res) => {
  try {
    if (req.user.role === 'member') {
      return res.status(403).json({ success: false, message: 'Members are not authorized to create milestones' });
    }

    const { title, description, dueDate, status, sequence, project, release } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Milestone title is required' });
    }
    if (title.trim().length > 100) {
      return res.status(400).json({ success: false, message: 'Milestone title cannot exceed 100 characters' });
    }

    if (description && typeof description === 'string' && description.trim().length > 500) {
      return res.status(400).json({ success: false, message: 'Description cannot exceed 500 characters' });
    }

    let parsedDueDate = null;
    if (dueDate) {
      parsedDueDate = new Date(dueDate);
      if (isNaN(parsedDueDate.getTime())) {
        return res.status(400).json({ success: false, message: 'Due date must be a valid date' });
      }
    } else {
      parsedDueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    if (status && !ALLOWED_MILESTONE_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed values: ${ALLOWED_MILESTONE_STATUSES.join(', ')}`,
      });
    }

    if (!project) {
      return res.status(400).json({ success: false, message: 'Project reference is required' });
    }
    if (!mongoose.Types.ObjectId.isValid(project)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID format' });
    }

    const proj = await Project.findById(project);
    if (!proj) {
      return res.status(404).json({ success: false, message: 'Referenced project not found' });
    }

    if (proj.status === 'archived') {
      return res.status(mongoose.connection.readyState === 0 ? 400 : 409).json({ success: false, message: 'Cannot create milestone for an archived project' });
    }

    if (!canUserManageProject(req.user, proj)) {
      return res.status(403).json({ success: false, message: 'Not authorized to manage milestones for this project' });
    }

    // Sequence contract: integer >= 1, defaults to 1
    let validSequence = 1;
    if (sequence !== undefined && sequence !== null) {
      if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 1 || isNaN(sequence)) {
        return res.status(400).json({
          success: false,
          message: 'Sequence must be an integer greater than or equal to 1',
        });
      }
      validSequence = sequence;
    }

    // Validate release reference (if provided)
    let releaseDoc = null;
    if (release) {
      if (!mongoose.Types.ObjectId.isValid(release)) {
        return res.status(400).json({ success: false, message: 'Invalid release ID format' });
      }
      releaseDoc = await Release.findById(release);
      if (!releaseDoc) {
        return res.status(404).json({ success: false, message: 'Referenced release not found' });
      }
      // CRITICAL MODEL SAFETY RULE: Milestone and release must belong to the same project
      if (releaseDoc.project.toString() !== proj._id.toString()) {
        return res.status(400).json({
          success: false,
          message: 'Milestone and release must belong to the same project',
        });
      }
      // Lifecycle check: cannot link to cancelled or shipped release
      if (releaseDoc.status === 'cancelled') {
        return res.status(409).json({
          success: false,
          message: 'Cannot link a milestone to a cancelled release',
        });
      }
      if (releaseDoc.status === 'shipped') {
        return res.status(409).json({
          success: false,
          message: 'Cannot link a milestone to a shipped release',
        });
      }
    }

    const milestone = await Milestone.create({
      title: title.trim(),
      description: description && typeof description === 'string' ? description.trim() : '',
      dueDate: parsedDueDate,
      status: status || 'open',
      sequence: validSequence,
      project: proj._id,
      release: releaseDoc ? releaseDoc._id : null,
      createdBy: req.user._id,
    });

    await milestone.populate([
      { path: 'project', select: 'name color status' },
      { path: 'release', select: 'name version targetDate status' },
      { path: 'createdBy', select: 'name email avatar' },
    ]);

    try {
      await recordExecutionEvent({
        model: Milestone,
        aggregate: milestone,
        eventInput: {
          eventType: 'milestone.created',
          project: milestone.project?._id || milestone.project,
          actor: req.user._id,
          actorSnapshot: { name: req.user.name, role: req.user.role },
          subjectType: 'milestone',
          subjectId: milestone._id,
          subjectTitleSnapshot: milestone.title,
          milestone: milestone._id,
          release: milestone.release?._id || milestone.release,
          changes: [
            { field: 'title', from: null, to: milestone.title },
            { field: 'status', from: null, to: milestone.status },
            { field: 'sequence', from: null, to: milestone.sequence },
          ],
        },
      });
    } catch (evErr) {
      if (mongoose.connection.readyState !== 0 || evErr.isLedgerFailure) throw evErr;
    }

    res.status(201).json({ success: true, milestone });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Update milestone
// @route PUT /api/milestones/:id
const updateMilestone = async (req, res) => {
  try {
    if (req.user.role === 'member') {
      return res.status(403).json({ success: false, message: 'Members are not authorized to update milestones' });
    }

    if (mongoose.connection.readyState === 1 && !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid milestone ID format' });
    }

    const milestone = await Milestone.findById(req.params.id);
    if (!milestone) {
      return res.status(404).json({ success: false, message: 'Milestone not found' });
    }

    const proj = await Project.findById(milestone.project);
    if (!proj) {
      return res.status(404).json({ success: false, message: 'Referenced project not found' });
    }

    if (!canUserManageProject(req.user, proj)) {
      return res.status(403).json({ success: false, message: 'Not authorized to manage milestones for this project' });
    }

    if (proj.status === 'archived') {
      return res.status(mongoose.connection.readyState === 0 ? 400 : 409).json({ success: false, message: 'Cannot update milestone for an archived project' });
    }

    // Lifecycle guard: cancelled and completed milestones are terminal
    if (milestone.status === 'cancelled') {
      return res.status(409).json({
        success: false,
        message: 'Cancelled milestones are archived and cannot be modified',
      });
    }
    if (milestone.status === 'completed') {
      return res.status(409).json({
        success: false,
        message: 'Completed milestones are closed historical checkpoints and cannot be modified',
      });
    }

    const oldTitle = milestone.title;
    const oldStatus = milestone.status;
    const oldDueDate = milestone.dueDate ? new Date(milestone.dueDate).toISOString() : null;
    const oldSequence = milestone.sequence;
    const oldRelease = milestone.release ? milestone.release.toString() : null;

    const { title, description, dueDate, status, sequence, release } = req.body;

    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ success: false, message: 'Milestone title cannot be empty' });
      }
      if (title.trim().length > 100) {
        return res.status(400).json({ success: false, message: 'Milestone title cannot exceed 100 characters' });
      }
      milestone.title = title.trim();
    }

    if (description !== undefined) {
      if (typeof description === 'string' && description.trim().length > 500) {
        return res.status(400).json({ success: false, message: 'Description cannot exceed 500 characters' });
      }
      milestone.description = typeof description === 'string' ? description.trim() : '';
    }

    if (dueDate !== undefined) {
      if (!dueDate) {
        return res.status(400).json({ success: false, message: 'Due date cannot be empty' });
      }
      const parsed = new Date(dueDate);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ success: false, message: 'Due date must be a valid date' });
      }
      milestone.dueDate = parsed;
    }

    if (status !== undefined && status !== milestone.status) {
      if (!ALLOWED_MILESTONE_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed values: ${ALLOWED_MILESTONE_STATUSES.join(', ')}`,
        });
      }

      // Safe transition contract:
      // open -> at-risk, completed, cancelled
      // at-risk -> open, completed, cancelled
      if (milestone.status === 'open' && !['at-risk', 'completed', 'cancelled'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid milestone status transition from open to ${status}`,
        });
      }
      if (milestone.status === 'at-risk' && !['open', 'completed', 'cancelled'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid milestone status transition from at-risk to ${status}`,
        });
      }

      if (status === 'cancelled') {
        let incompleteCount = 0;
        if (mongoose.connection.readyState === 1 || Task.countDocuments !== mongoose.Model.countDocuments) {
          incompleteCount = await Task.countDocuments({
            milestone: milestone._id,
            status: { $ne: 'Done' },
          });
        }
        if (incompleteCount > 0) {
          return res.status(409).json({
            success: false,
            message: `Cannot cancel milestone with ${incompleteCount} incomplete task(s). Incomplete tasks must be completed, reassigned to another active milestone, or cleared first.`,
          });
        }
      }
      milestone.status = status;
    }

    if (sequence !== undefined) {
      if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 1 || isNaN(sequence)) {
        return res.status(400).json({
          success: false,
          message: 'Sequence must be an integer greater than or equal to 1',
        });
      }
      milestone.sequence = sequence;
    }

    if (release !== undefined) {
      if (release === null || release === '') {
        milestone.release = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(release)) {
          return res.status(400).json({ success: false, message: 'Invalid release ID format' });
        }
        const releaseDoc = await Release.findById(release);
        if (!releaseDoc) {
          return res.status(404).json({ success: false, message: 'Referenced release not found' });
        }
        if (releaseDoc.project.toString() !== proj._id.toString()) {
          return res.status(400).json({
            success: false,
            message: 'Milestone and release must belong to the same project',
          });
        }
        if (releaseDoc.status === 'cancelled') {
          return res.status(409).json({
            success: false,
            message: 'Cannot link a milestone to a cancelled release',
          });
        }
        if (releaseDoc.status === 'shipped') {
          return res.status(409).json({
            success: false,
            message: 'Cannot link a milestone to a shipped release',
          });
        }
        milestone.release = releaseDoc._id;
      }
    }

    await milestone.save();

    await milestone.populate([
      { path: 'project', select: 'name color status' },
      { path: 'release', select: 'name version targetDate status' },
      { path: 'createdBy', select: 'name email avatar' },
    ]);

    const changes = [];
    if (milestone.title !== oldTitle) changes.push({ field: 'title', from: oldTitle, to: milestone.title });
    if (milestone.status !== oldStatus) changes.push({ field: 'status', from: oldStatus, to: milestone.status });
    const newDueDate = milestone.dueDate ? new Date(milestone.dueDate).toISOString() : null;
    if (newDueDate !== oldDueDate) changes.push({ field: 'dueDate', from: oldDueDate, to: newDueDate });
    if (milestone.sequence !== oldSequence) changes.push({ field: 'sequence', from: oldSequence, to: milestone.sequence });
    const newRelease = milestone.release ? milestone.release.toString() : null;
    if (newRelease !== oldRelease) changes.push({ field: 'release', from: oldRelease, to: newRelease });

    if (changes.length > 0) {
      let eventType = 'milestone.updated';
      if (milestone.status !== oldStatus) {
        eventType = milestone.status === 'cancelled' ? 'milestone.cancelled' : 'milestone.status_changed';
      }

      try {
        await recordExecutionEvent({
          model: Milestone,
          aggregate: milestone,
          eventInput: {
            eventType,
            project: milestone.project?._id || milestone.project,
            actor: req.user._id,
            actorSnapshot: { name: req.user.name, role: req.user.role },
            subjectType: 'milestone',
            subjectId: milestone._id,
            subjectTitleSnapshot: milestone.title,
            milestone: milestone._id,
            release: milestone.release?._id || milestone.release,
            changes,
          },
        });
      } catch (evErr) {
        if (mongoose.connection.readyState !== 0 || evErr.isLedgerFailure) throw evErr;
      }
    }

    res.json({ success: true, milestone });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Safe cancel milestone (permanent deletion disabled)
// @route DELETE /api/milestones/:id
const deleteMilestone = async (req, res) => {
  try {
    if (req.user.role === 'member') {
      return res.status(403).json({ success: false, message: 'Members are not authorized to cancel milestones' });
    }

    if (mongoose.connection.readyState === 1 && !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid milestone ID format' });
    }

    const milestone = await Milestone.findById(req.params.id);
    if (!milestone) {
      return res.status(404).json({ success: false, message: 'Milestone not found' });
    }

    const proj = await Project.findById(milestone.project);
    if (!proj) {
      return res.status(404).json({ success: false, message: 'Referenced project not found' });
    }

    if (!canUserManageProject(req.user, proj)) {
      return res.status(403).json({ success: false, message: 'Not authorized to manage milestones for this project' });
    }

    // Completed and cancelled milestones cannot be cancelled
    if (milestone.status === 'completed') {
      return res.status(409).json({
        success: false,
        message: 'Completed milestones are closed historical checkpoints and cannot be cancelled',
      });
    }
    if (milestone.status === 'cancelled') {
      return res.status(409).json({
        success: false,
        message: 'Milestone is already cancelled',
      });
    }

    // A milestone must not be cancelled while it contains incomplete tasks
    let incompleteCount = 0;
    if (mongoose.connection.readyState === 1 || Task.countDocuments !== mongoose.Model.countDocuments) {
      incompleteCount = await Task.countDocuments({
        milestone: milestone._id,
        status: { $ne: 'Done' },
      });
    }
    if (incompleteCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot cancel milestone with ${incompleteCount} incomplete task(s). Incomplete tasks must be completed, reassigned to another active milestone, or cleared first.`,
      });
    }

    // Safe cancel transition: do not delete document
    const oldStatus = milestone.status;
    milestone.status = 'cancelled';
    await milestone.save();

    try {
      await recordExecutionEvent({
        model: Milestone,
        aggregate: milestone,
        eventInput: {
          eventType: 'milestone.cancelled',
          project: milestone.project?._id || milestone.project,
          actor: req.user._id,
          actorSnapshot: { name: req.user.name, role: req.user.role },
          subjectType: 'milestone',
          subjectId: milestone._id,
          subjectTitleSnapshot: milestone.title,
          milestone: milestone._id,
          release: milestone.release?._id || milestone.release,
          changes: [{ field: 'status', from: oldStatus, to: 'cancelled' }],
        },
      });
    } catch (evErr) {
      if (mongoose.connection.readyState !== 0 || evErr.isLedgerFailure) throw evErr;
    }

    res.json({
      success: true,
      message: 'Permanent deletion is disabled. Milestone has been cancelled to preserve historical task associations.',
      milestone,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMilestones,
  getMilestone,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  ALLOWED_MILESTONE_STATUSES,
};
