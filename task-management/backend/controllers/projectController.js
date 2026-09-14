const mongoose = require('mongoose');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Release = require('../models/Release');
const Milestone = require('../models/Milestone');
const { buildGraphPayload } = require('../utils/dependencyGraph');
const {
  buildDeliveryIntelligencePayload,
  computeDeliveryForecast,
} = require('../utils/deliveryIntelligence');
const { recordExecutionEvent } = require('../services/executionEventService');

// @desc  Get all projects
// @route GET /api/projects
const getProjects = async (req, res) => {
  try {
    const filter =
      req.user.role === 'member'
        ? { 'members.user': req.user._id }
        : {};

    const projects = await Project.find(filter)
      .populate('owner', 'name email avatar')
      .populate('members.user', 'name email avatar')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: projects.length, projects });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Get single project
// @route GET /api/projects/:id
const getProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('owner', 'name email avatar')
      .populate('members.user', 'name email avatar');

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Members can only access projects they belong to
    if (req.user.role === 'member') {
      const isMember = project.members.some(
        (m) => m.user && (m.user._id ? m.user._id.toString() : m.user.toString()) === req.user._id.toString()
      );
      if (!isMember) {
        return res.status(403).json({ success: false, message: 'Not authorized to access this project' });
      }
    }

    res.json({ success: true, project });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const ALLOWED_PROJECT_STATUSES = ['active', 'on-hold', 'completed', 'archived'];

// @desc  Create project
// @route POST /api/projects
const createProject = async (req, res) => {
  try {
    const { name, description, color, dueDate, status } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Project name is required' });
    }
    if (name.trim().length > 80) {
      return res.status(400).json({ success: false, message: 'Project name cannot exceed 80 characters' });
    }
    if (description && typeof description === 'string' && description.trim().length > 500) {
      return res.status(400).json({ success: false, message: 'Description cannot exceed 500 characters' });
    }
    if (status && !ALLOWED_PROJECT_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `Invalid status. Allowed values: ${ALLOWED_PROJECT_STATUSES.join(', ')}` });
    }

    const project = await Project.create({
      name: name.trim(),
      description: description && typeof description === 'string' ? description.trim() : '',
      color: color || '#6366f1',
      status: status || 'active',
      dueDate: dueDate ? new Date(dueDate) : null,
      owner: req.user._id,
      members: [{ user: req.user._id, role: 'owner' }],
    });

    await project.populate([
      { path: 'owner', select: 'name email avatar' },
      { path: 'members.user', select: 'name email avatar' },
    ]);

    try {
      await recordExecutionEvent({
        model: Project,
        aggregate: project,
        eventInput: {
          eventType: 'project.created',
          project: project._id,
          actor: req.user._id,
          actorSnapshot: { name: req.user.name, role: req.user.role },
          subjectType: 'project',
          subjectId: project._id,
          subjectTitleSnapshot: project.name,
          changes: [
            { field: 'name', from: null, to: project.name },
            { field: 'status', from: null, to: project.status },
          ],
        },
      });
    } catch (evErr) {
      if (evErr.isLedgerFailure) throw evErr;
    }

    res.status(201).json({ success: true, project });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Update project
// @route PUT /api/projects/:id
const updateProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    if (project.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const oldName = project.name;
    const oldStatus = project.status;
    const oldColor = project.color;
    const oldDueDate = project.dueDate ? new Date(project.dueDate).toISOString() : null;

    const { name, description, color, dueDate, status } = req.body;

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Project name cannot be empty' });
      }
      if (name.trim().length > 80) {
        return res.status(400).json({ success: false, message: 'Project name cannot exceed 80 characters' });
      }
      project.name = name.trim();
    }

    if (description !== undefined) {
      if (typeof description === 'string' && description.trim().length > 500) {
        return res.status(400).json({ success: false, message: 'Description cannot exceed 500 characters' });
      }
      project.description = typeof description === 'string' ? description.trim() : '';
    }

    if (color !== undefined) project.color = color;

    if (status !== undefined) {
      if (!ALLOWED_PROJECT_STATUSES.includes(status)) {
        return res.status(400).json({ success: false, message: `Invalid status. Allowed values: ${ALLOWED_PROJECT_STATUSES.join(', ')}` });
      }
      project.status = status;
    }

    if (dueDate !== undefined) {
      project.dueDate = dueDate ? new Date(dueDate) : null;
    }

    await project.save();
    await project.populate([
      { path: 'owner', select: 'name email avatar' },
      { path: 'members.user', select: 'name email avatar' },
    ]);

    // Build safe change diff for execution event
    const changes = [];
    if (name !== undefined && name.trim() !== oldName) {
      changes.push({ field: 'name', from: oldName, to: project.name });
    }
    if (status !== undefined && status !== oldStatus) {
      changes.push({ field: 'status', from: oldStatus, to: project.status });
    }
    if (color !== undefined && color !== oldColor) {
      changes.push({ field: 'color', from: oldColor, to: project.color });
    }
    const newDueDate = project.dueDate ? new Date(project.dueDate).toISOString() : null;
    if (dueDate !== undefined && newDueDate !== oldDueDate) {
      changes.push({ field: 'dueDate', from: oldDueDate, to: newDueDate });
    }

    if (changes.length > 0) {
      const eventType = (status !== undefined && status !== oldStatus)
        ? 'project.status_changed'
        : 'project.updated';

      try {
        await recordExecutionEvent({
          model: Project,
          aggregate: project,
          eventInput: {
            eventType,
            project: project._id,
            actor: req.user._id,
            actorSnapshot: { name: req.user.name, role: req.user.role },
            subjectType: 'project',
            subjectId: project._id,
            subjectTitleSnapshot: project.name,
            changes,
          },
        });
      } catch (evErr) {
        if (evErr.isLedgerFailure) throw evErr;
      }
    }

    res.json({ success: true, project });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Permanent project deletion is disabled to preserve linked tasks and audit history
// @route DELETE /api/projects/:id
const deleteProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    if (project.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    // If explicit administrative purge / forced deletion requested
    if (req.query?.force === 'true' || req.query?.permanent === 'true') {
      try {
        await recordExecutionEvent({
          model: Project,
          aggregate: project,
          eventInput: {
            eventType: 'project.deleted',
            project: project._id,
            actor: req.user._id,
            actorSnapshot: { name: req.user.name, role: req.user.role },
            subjectType: 'project',
            subjectId: project._id,
            subjectTitleSnapshot: project.name,
            changes: [{ field: 'status', from: project.status, to: 'deleted' }],
          },
        });
      } catch (evErr) {
        if (evErr.isLedgerFailure) throw evErr;
      }
      await Project.findByIdAndDelete(project._id);
      return res.json({ success: true, message: 'Project deleted successfully' });
    }

    // Safe archival policy: Permanent cascade deletion is disabled to protect task history.
    return res.status(409).json({
      success: false,
      message: 'Permanent project deletion is disabled. Please archive the project instead to preserve tasks and audit history.',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Add member to project
// @route POST /api/projects/:id/members
const addMember = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    if (project.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const { userId, role } = req.body;
    const already = project.members.find((m) => m.user.toString() === userId);
    if (already) return res.status(400).json({ success: false, message: 'User already a member' });

    project.members.push({ user: userId, role: role || 'member' });
    await project.save();
    await project.populate('members.user', 'name email avatar');

    try {
      await recordExecutionEvent({
        model: Project,
        aggregate: project,
        eventInput: {
          eventType: 'project.member_added',
          project: project._id,
          actor: req.user._id,
          actorSnapshot: { name: req.user.name, role: req.user.role },
          subjectType: 'project',
          subjectId: project._id,
          subjectTitleSnapshot: project.name,
          changes: [{ field: 'members', from: null, to: userId.toString() }],
          metadata: { addedUserId: userId.toString(), role: role || 'member' },
        },
      });
    } catch (evErr) {
      if (evErr.isLedgerFailure) throw evErr;
    }

    res.json({ success: true, members: project.members });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Remove member from project
// @route DELETE /api/projects/:id/members/:userId
const removeMember = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    if (project.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const { userId } = req.params;
    const initialLen = project.members.length;
    project.members = project.members.filter((m) => {
      const mId = m.user ? (m.user._id ? m.user._id.toString() : m.user.toString()) : m.toString();
      return mId !== userId;
    });

    if (project.members.length === initialLen) {
      return res.status(404).json({ success: false, message: 'Member not found in project' });
    }

    await project.save();
    await project.populate('members.user', 'name email avatar');

    try {
      await recordExecutionEvent({
        model: Project,
        aggregate: project,
        eventInput: {
          eventType: 'project.member_removed',
          project: project._id,
          actor: req.user._id,
          actorSnapshot: { name: req.user.name, role: req.user.role },
          subjectType: 'project',
          subjectId: project._id,
          subjectTitleSnapshot: project.name,
          changes: [{ field: 'members', from: userId.toString(), to: null }],
          metadata: { removedUserId: userId.toString() },
        },
      });
    } catch (evErr) {
      if (evErr.isLedgerFailure) throw evErr;
    }

    res.json({ success: true, members: project.members });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Get project dependency graph
// @route GET /api/projects/:projectId/dependency-graph
const getProjectDependencyGraph = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID format' });
    }

    const project = await Project.findById(projectId).populate('owner', 'name email');
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Authorization check
    if (req.user.role === 'member') {
      const userId = req.user._id ? req.user._id.toString() : req.user.toString();
      const isOwner = project.owner && (project.owner._id ? project.owner._id.toString() : project.owner.toString()) === userId;
      const isMember = Array.isArray(project.members) && project.members.some((m) => {
        const mId = m ? (m.user ? (m.user._id ? m.user._id.toString() : m.user.toString()) : m.toString()) : null;
        return mId === userId;
      });
      if (!isOwner && !isMember) {
        return res.status(403).json({ success: false, message: 'Not authorized to view this project graph' });
      }
    }

    // Fetch all project tasks
    let tasks = await Task.find({ project: projectId })
      .populate('assignedTo', 'name email avatar')
      .populate('milestone', 'title status sequence')
      .sort({ createdAt: 1 });

    let scope = 'project';
    let isPartial = false;

    // Member scope filtering: members only see tasks assigned to or created by them
    if (req.user.role === 'member') {
      scope = 'personal';
      isPartial = true;
      const userId = req.user._id ? req.user._id.toString() : req.user.toString();
      tasks = tasks.filter((t) => {
        const assignedId = t.assignedTo?._id ? t.assignedTo._id.toString() : t.assignedTo?.toString();
        const createdById = t.createdBy?._id ? t.createdBy._id.toString() : t.createdBy?.toString();
        return assignedId === userId || createdById === userId;
      });
    }

    const payload = buildGraphPayload(project, tasks, { scope, isPartial });
    res.json({ success: true, ...payload });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Get project delivery intelligence (optional ?release=<releaseId>)
// @route GET /api/projects/:projectId/delivery-intelligence
const getProjectDeliveryIntelligence = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID format' });
    }

    const project = await Project.findById(projectId).populate('owner', 'name email');
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Authorization check
    if (req.user.role === 'member') {
      const userId = req.user._id ? req.user._id.toString() : req.user.toString();
      const isOwner = project.owner && (project.owner._id ? project.owner._id.toString() : project.owner.toString()) === userId;
      const isMember = Array.isArray(project.members) && project.members.some((m) => {
        const mId = m ? (m.user ? (m.user._id ? m.user._id.toString() : m.user.toString()) : m.toString()) : null;
        return mId === userId;
      });
      if (!isOwner && !isMember) {
        return res.status(403).json({ success: false, message: 'Not authorized to view this project delivery intelligence' });
      }
    }

    let targetRelease = null;
    if (req.query.release) {
      if (!mongoose.Types.ObjectId.isValid(req.query.release)) {
        return res.status(400).json({ success: false, message: 'Invalid release ID format' });
      }
      targetRelease = await Release.findById(req.query.release);
      if (!targetRelease) {
        return res.status(404).json({ success: false, message: 'Release not found' });
      }
      if (targetRelease.project.toString() !== project._id.toString()) {
        return res.status(400).json({ success: false, message: 'Release does not belong to this project' });
      }
    }

    // Exactly bounded batch queries
    const releases = await Release.find({ project: projectId }).sort({ targetDate: 1 });
    const milestones = await Milestone.find({ project: projectId }).sort({ sequence: 1 });
    const tasks = await Task.find({ project: projectId })
      .populate('assignedTo', 'name email avatar')
      .populate('milestone', 'title status sequence release')
      .sort({ createdAt: 1 });

    const payload = buildDeliveryIntelligencePayload(project, targetRelease, tasks, milestones, req.user);

    // If project scope and authorized user, include release summaries
    let releaseSummaries = [];
    if (!targetRelease && req.user.role !== 'member') {
      const activeReleases = releases.filter((r) => r.status !== 'cancelled');
      releaseSummaries = activeReleases.map((rel) => {
        const relMilestones = milestones.filter(m => m.release && m.release.toString() === rel._id.toString() && m.status !== 'cancelled');
        const relMilestoneIds = new Set(relMilestones.map(m => m._id.toString()));
        const relTasks = tasks.filter(t => t.milestone && relMilestoneIds.has((t.milestone._id || t.milestone).toString()));
        const relForecast = computeDeliveryForecast(project, rel, relTasks);
        return {
          id: rel._id.toString(),
          name: rel.name,
          version: rel.version,
          status: rel.status,
          targetDate: rel.targetDate,
          forecastDate: relForecast.forecastDate,
          slipDays: relForecast.slipDays,
          forecastStatus: relForecast.status,
          criticalPathLength: relForecast.criticalPath?.length || 0,
          availability: relForecast.availability,
        };
      });
    }

    res.json({
      success: true,
      ...payload,
      releases: releases.map((r) => ({
        id: r._id.toString(),
        name: r.name,
        version: r.version,
        status: r.status,
        targetDate: r.targetDate,
      })),
      releaseSummaries,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  addMember,
  removeMember,
  getProjectDependencyGraph,
  getProjectDeliveryIntelligence,
  ALLOWED_PROJECT_STATUSES,
};
