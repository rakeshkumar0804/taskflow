const mongoose = require('mongoose');
const Project = require('../models/Project');
const User = require('../models/User');
const Task = require('../models/Task');
const Milestone = require('../models/Milestone');
const Release = require('../models/Release');
const ProjectCapacity = require('../models/ProjectCapacity');
const {
  canReadProject,
  canManageProject,
  isActiveProjectMember,
} = require('../utils/projectAuthorization');
const {
  parseHorizonDays,
  computeCapacityIntelligence,
} = require('../utils/capacityIntelligence');
const { recordExecutionEvent } = require('../services/executionEventService');

// @desc  Get all project capacity configurations
// @route GET /api/projects/:projectId/capacity
const getProjectCapacities = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID format' });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    if (!canReadProject(req.user, project)) {
      return res.status(403).json({ success: false, message: 'Not authorized to view capacity for this project' });
    }

    let capacities = await ProjectCapacity.find({ project: projectId })
      .populate('user', 'name email role avatar isActive')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .sort({ updatedAt: -1 });

    if (req.user && req.user.role === 'member') {
      const requesterId = req.user._id ? req.user._id.toString() : req.user.toString();
      capacities = capacities.filter((c) => {
        const uId = c.user ? (c.user._id ? c.user._id.toString() : c.user.toString()) : null;
        return uId === requesterId;
      });
    }

    return res.status(200).json({
      success: true,
      count: capacities.length,
      data: capacities,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Set/update capacity configuration for a project user
// @route PUT /api/projects/:projectId/capacity/:userId
const upsertProjectCapacity = async (req, res) => {
  try {
    const { projectId, userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID format' });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID format' });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Capacity configuration mutations permitted only when project.status === 'active'
    if (project.status !== 'active') {
      return res.status(409).json({
        success: false,
        message: `Cannot configure capacity on a ${project.status} project`,
      });
    }

    // Authorization check: Admin or Project-owning Manager only
    if (!canManageProject(req.user, project)) {
      return res.status(403).json({
        success: false,
        message: 'Only the project owner or an administrator may configure team capacity',
      });
    }

    // Target user must exist and be active
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Target user not found' });
    }
    if (!targetUser.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Cannot configure capacity for an inactive user',
      });
    }

    // Target user must be owner or explicit member of the project
    if (!isActiveProjectMember(userId, project)) {
      return res.status(400).json({
        success: false,
        message: 'User must be the project owner or an active member of this project',
      });
    }

    const { availableDaysPerWeek, wipLimit } = req.body;

    // Validation for availableDaysPerWeek (0.5 to 7.0 in 0.5 increments)
    if (availableDaysPerWeek === undefined || availableDaysPerWeek === null) {
      return res.status(400).json({ success: false, message: 'availableDaysPerWeek is required' });
    }
    const daysNum = Number(availableDaysPerWeek);
    if (
      !Number.isFinite(daysNum) ||
      daysNum < 0.5 ||
      daysNum > 7.0 ||
      Math.round(daysNum * 2) !== daysNum * 2
    ) {
      return res.status(400).json({
        success: false,
        message: 'availableDaysPerWeek must be a number between 0.5 and 7.0 in increments of 0.5',
      });
    }

    // Validation for wipLimit (integer 1 to 10, canonical default: 3)
    let capacity = await ProjectCapacity.findOne({ project: projectId, user: userId });

    let wipNum = 3;
    if (wipLimit !== undefined && wipLimit !== null) {
      wipNum = Number(wipLimit);
      if (!Number.isInteger(wipNum) || wipNum < 1 || wipNum > 10) {
        return res.status(400).json({
          success: false,
          message: 'wipLimit must be an integer between 1 and 10',
        });
      }
    } else if (capacity && capacity.wipLimit != null) {
      wipNum = capacity.wipLimit;
    }

    const isNew = !capacity;
    const oldDays = capacity ? capacity.availableDaysPerWeek : null;
    const oldWip = capacity ? capacity.wipLimit : null;

    if (capacity) {
      capacity.availableDaysPerWeek = daysNum;
      capacity.wipLimit = wipNum;
      capacity.updatedBy = req.user._id;
      await capacity.save();
    } else {
      capacity = await ProjectCapacity.create({
        project: projectId,
        user: userId,
        availableDaysPerWeek: daysNum,
        wipLimit: wipNum,
        createdBy: req.user._id,
        updatedBy: req.user._id,
      });
    }

    await capacity.populate([
      { path: 'user', select: 'name email role avatar isActive' },
      { path: 'createdBy', select: 'name email' },
      { path: 'updatedBy', select: 'name email' },
    ]);

    try {
      await recordExecutionEvent({
        model: ProjectCapacity,
        aggregate: capacity,
        eventInput: {
          eventType: isNew ? 'capacity.configured' : 'capacity.updated',
          project: projectId,
          actor: req.user._id,
          actorSnapshot: { name: req.user.name, role: req.user.role },
          subjectType: 'capacity',
          subjectId: capacity._id,
          subjectTitleSnapshot: `Capacity:${userId}`,
          capacityUser: userId,
          changes: [
            { field: 'availableDaysPerWeek', from: isNew ? null : oldDays, to: daysNum },
            { field: 'wipLimit', from: isNew ? null : oldWip, to: wipNum },
          ],
        },
      });
    } catch (evErr) {
      if (evErr.isLedgerFailure) throw evErr;
    }

    return res.status(200).json({
      success: true,
      message: 'Capacity allocation configured successfully',
      data: capacity,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Delete a capacity configuration
// @route DELETE /api/projects/:projectId/capacity/:userId
const deleteProjectCapacity = async (req, res) => {
  try {
    const { projectId, userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID format' });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID format' });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    if (project.status !== 'active') {
      return res.status(409).json({
        success: false,
        message: `Cannot delete capacity configuration on a ${project.status} project`,
      });
    }

    if (!canManageProject(req.user, project)) {
      return res.status(403).json({
        success: false,
        message: 'Only the project owner or an administrator may delete capacity configurations',
      });
    }

    const deleted = await ProjectCapacity.findOneAndDelete({
      project: projectId,
      user: userId,
    });

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Capacity allocation not found',
      });
    }

    try {
      await recordExecutionEvent({
        model: ProjectCapacity,
        aggregate: deleted,
        eventInput: {
          eventType: 'capacity.removed',
          project: projectId,
          actor: req.user._id,
          actorSnapshot: { name: req.user.name, role: req.user.role },
          subjectType: 'capacity',
          subjectId: deleted._id,
          subjectTitleSnapshot: `Capacity:${userId}`,
          capacityUser: userId,
          changes: [
            { field: 'availableDaysPerWeek', from: deleted.availableDaysPerWeek, to: null },
            { field: 'wipLimit', from: deleted.wipLimit, to: null },
          ],
        },
      });
    } catch (evErr) {
      if (evErr.isLedgerFailure) throw evErr;
    }

    return res.status(200).json({
      success: true,
      message: 'Capacity allocation deleted successfully',
      data: { id: deleted._id },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Get deterministic capacity intelligence
// @route GET /api/projects/:projectId/capacity-intelligence
const getProjectCapacityIntelligence = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID format' });
    }

    // Horizon validation
    let horizonDays;
    try {
      horizonDays = parseHorizonDays(req.query.horizonDays);
    } catch (err) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }

    // Bounded Batch Query 1: Project
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    if (!canReadProject(req.user, project)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view capacity intelligence for this project',
      });
    }

    // Collect all relevant user IDs for batch loading
    const relevantUserIds = new Set();
    if (project.owner) relevantUserIds.add(project.owner.toString());
    if (Array.isArray(project.members)) {
      for (const m of project.members) {
        if (m.user) relevantUserIds.add(m.user.toString());
      }
    }

    // Bounded Batch Query 2: Users
    const users = await User.find({
      _id: { $in: Array.from(relevantUserIds) },
    }).select('name email role avatar isActive');

    // Bounded Batch Query 3: Project Capacities
    const capacities = await ProjectCapacity.find({ project: projectId });

    // Bounded Batch Query 4: Tasks
    const tasks = await Task.find({ project: projectId });

    // Bounded Batch Query 5: Milestones
    const milestones = await Milestone.find({ project: projectId });

    // Bounded Batch Query 6: Releases
    const releases = await Release.find({ project: projectId });

    // Execute pure calculation engine
    const intelligence = computeCapacityIntelligence({
      project,
      users,
      capacities,
      tasks,
      milestones,
      releases,
      horizonDays,
      requestingUser: req.user,
    });

    return res.status(200).json({
      success: true,
      data: intelligence,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getProjectCapacities,
  upsertProjectCapacity,
  deleteProjectCapacity,
  getProjectCapacityIntelligence,
};
