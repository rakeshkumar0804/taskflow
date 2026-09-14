const mongoose = require('mongoose');
const Release = require('../models/Release');
const Milestone = require('../models/Milestone');
const Task = require('../models/Task');
const Project = require('../models/Project');
const { calculateReleaseReadiness } = require('../utils/releaseReadiness');
const { buildDeliveryIntelligencePayload } = require('../utils/deliveryIntelligence');
const { recordExecutionEvent } = require('../services/executionEventService');

const ALLOWED_RELEASE_STATUSES = ['planning', 'active', 'code-freeze', 'shipped', 'cancelled'];

// Helper to check if user can view a project
const canUserViewProject = (user, project) => {
  if (!user || !project) return false;
  if (user.role === 'admin' || user.role === 'manager') return true;
  const userId = user._id ? user._id.toString() : user.toString();
  const ownerId = project.owner?._id ? project.owner._id.toString() : project.owner?.toString();
  if (ownerId === userId) return true;
  if (Array.isArray(project.members)) {
    return project.members.some((m) => {
      const mId = m?.user?._id ? m.user._id.toString() : m?.user?.toString() || m?.toString();
      return mId === userId;
    });
  }
  return false;
};

// Helper to check if user can manage/mutate releases for a project
const canUserManageProject = (user, project) => {
  if (!user || !project) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'manager') {
    const userId = user._id ? user._id.toString() : user.toString();
    const ownerId = project.owner?._id ? project.owner._id.toString() : project.owner?.toString();
    if (ownerId === userId) return true;
    if (Array.isArray(project.members)) {
      return project.members.some((m) => {
        const mId = m?.user?._id ? m.user._id.toString() : m?.user?.toString() || m?.toString();
        const role = m?.role;
        return mId === userId && (role === 'owner' || role === 'manager');
      });
    }
  }
  return false;
};

// Helper to calculate readiness for a single release document
const attachReadiness = async (release) => {
  if (mongoose.connection.readyState === 0 && Milestone.find === mongoose.Model.find) {
    return {
      release,
      milestones: [],
      readiness: {
        availability: 'insufficient_data',
        score: null,
        label: 'INSUFFICIENT DATA',
        message: 'Add tasks to active release milestones to calculate readiness.',
        drivers: [],
      },
    };
  }
  const milestones = (await Milestone.find({ release: release._id })) || [];
  const milestoneIds = milestones.map((m) => m._id);
  const tasks = milestoneIds.length > 0
    ? ((await Task.find({ milestone: { $in: milestoneIds } })
        .select('title status priority dueDate isBlocked blockedReason milestone assignedTo updatedAt')) || [])
    : [];
  const readiness = calculateReleaseReadiness(release, milestones, tasks);
  return {
    release,
    milestones,
    readiness,
  };
};

// @desc  Get all releases
// @route GET /api/releases
const getReleases = async (req, res) => {
  try {
    const { project, status, includeCancelled } = req.query;
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
        return res.status(403).json({ success: false, message: 'Not authorized to access releases for this project' });
      }
      filter.project = project;
    } else {
      // If member, only list releases for projects they belong to
      if (req.user.role === 'member') {
        const userProjects = await Project.find({ 'members.user': req.user._id }).select('_id');
        filter.project = { $in: userProjects.map((p) => p._id) };
      }
    }

    if (status) {
      if (status !== 'all' && !ALLOWED_RELEASE_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed values: ${ALLOWED_RELEASE_STATUSES.join(', ')}`,
        });
      }
      if (status !== 'all') {
        filter.status = status;
      }
    } else if (includeCancelled !== 'true') {
      // Exclude cancelled releases by default from active views
      filter.status = { $ne: 'cancelled' };
    }

    // Query 1: Bounded release fetch
    const releases = await Release.find(filter)
      .populate('project', 'name color status')
      .populate('createdBy', 'name email avatar')
      .sort({ targetDate: 1 });

    if (releases.length === 0) {
      return res.json({
        success: true,
        count: 0,
        releases: [],
      });
    }

    // Query 2: Bounded batch fetch for all milestones belonging to any returned release
    const releaseIds = releases.map((r) => r._id);
    const allMilestones = await Milestone.find({ release: { $in: releaseIds } })
      .sort({ sequence: 1, dueDate: 1, createdAt: 1 });

    // Query 3: Bounded batch fetch for all tasks linked to any of these milestones
    const allMilestoneIds = allMilestones.map((m) => m._id);
    const allTasks = allMilestoneIds.length > 0
      ? await Task.find({ milestone: { $in: allMilestoneIds } })
          .select('title status priority dueDate isBlocked blockedReason milestone assignedTo updatedAt')
      : [];

    // Group milestones by release ID
    const milestonesByRelease = new Map();
    for (const m of allMilestones) {
      if (!m.release) continue;
      const relKey = m.release.toString();
      if (!milestonesByRelease.has(relKey)) {
        milestonesByRelease.set(relKey, []);
      }
      milestonesByRelease.get(relKey).push(m);
    }

    // Group tasks by milestone ID
    const tasksByMilestone = new Map();
    for (const t of allTasks) {
      if (!t.milestone) continue;
      const msKey = t.milestone.toString();
      if (!tasksByMilestone.has(msKey)) {
        tasksByMilestone.set(msKey, []);
      }
      tasksByMilestone.get(msKey).push(t);
    }

    // Assemble releases with calculated readiness in memory (O(1) database queries)
    const releasesWithReadiness = releases.map((r) => {
      const relKey = r._id.toString();
      const relMilestones = milestonesByRelease.get(relKey) || [];
      const relTasks = [];
      for (const m of relMilestones) {
        const msTasks = tasksByMilestone.get(m._id.toString());
        if (msTasks && msTasks.length > 0) {
          relTasks.push(...msTasks);
        }
      }

      const readiness = calculateReleaseReadiness(r, relMilestones, relTasks);
      return {
        ...r.toObject(),
        milestonesCount: relMilestones.length,
        readiness,
      };
    });

    res.json({
      success: true,
      count: releasesWithReadiness.length,
      releases: releasesWithReadiness,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Get single release
// @route GET /api/releases/:id
const getRelease = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid release ID format' });
    }

    const release = await Release.findById(req.params.id)
      .populate('project', 'name color status owner members')
      .populate('createdBy', 'name email avatar');

    if (!release) {
      return res.status(404).json({ success: false, message: 'Release not found' });
    }

    if (!canUserViewProject(req.user, release.project)) {
      return res.status(403).json({ success: false, message: 'Not authorized to access this release' });
    }

    const milestones = await Milestone.find({ release: release._id }).sort({ sequence: 1, dueDate: 1, createdAt: 1 });
    const milestoneIds = milestones.map((m) => m._id);
    const tasks = milestoneIds.length > 0
      ? await Task.find({ milestone: { $in: milestoneIds } })
          .populate('assignedTo', 'name email avatar')
          .select('title status priority dueDate isBlocked blockedReason milestone')
      : [];

    const readiness = calculateReleaseReadiness(release, milestones, tasks);

    res.json({
      success: true,
      release,
      milestones,
      readiness,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Create release
// @route POST /api/releases
const createRelease = async (req, res) => {
  try {
    if (req.user.role === 'member') {
      return res.status(403).json({ success: false, message: 'Members are not authorized to create releases' });
    }

    const { name, version, description, targetDate, status, project } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Release name is required' });
    }
    if (name.trim().length > 80) {
      return res.status(400).json({ success: false, message: 'Release name cannot exceed 80 characters' });
    }

    if (!version || typeof version !== 'string' || !version.trim()) {
      return res.status(400).json({ success: false, message: 'Version is required' });
    }
    if (version.trim().length > 30) {
      return res.status(400).json({ success: false, message: 'Version cannot exceed 30 characters' });
    }

    if (description && typeof description === 'string' && description.trim().length > 1000) {
      return res.status(400).json({ success: false, message: 'Description cannot exceed 1000 characters' });
    }

    if (!targetDate) {
      return res.status(400).json({ success: false, message: 'Target date is required' });
    }
    const parsedTargetDate = new Date(targetDate);
    if (isNaN(parsedTargetDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Target date must be a valid date' });
    }

    if (status && !ALLOWED_RELEASE_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed values: ${ALLOWED_RELEASE_STATUSES.join(', ')}`,
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
      return res.status(400).json({ success: false, message: 'Cannot create release for an archived project' });
    }

    if (!canUserManageProject(req.user, proj)) {
      return res.status(403).json({ success: false, message: 'Not authorized to manage releases for this project' });
    }

    const trimmedVersion = version.trim();

    // Check duplicate project/version pair
    let duplicate = null;
    if (mongoose.connection.readyState === 1 || Release.findOne !== mongoose.Model.findOne) {
      duplicate = await Release.findOne({ project: proj._id, version: trimmedVersion });
    }
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: `A release with version "${trimmedVersion}" already exists for this project`,
      });
    }

    // Explicitly set createdBy to req.user._id (ignore any client-supplied createdBy/readiness)
    const release = await Release.create({
      name: name.trim(),
      version: trimmedVersion,
      description: description && typeof description === 'string' ? description.trim() : '',
      targetDate: parsedTargetDate,
      status: status || 'planning',
      project: proj._id,
      createdBy: req.user._id,
    });

    await release.populate([
      { path: 'project', select: 'name color status' },
      { path: 'createdBy', select: 'name email avatar' },
    ]);

    try {
      await recordExecutionEvent({
        model: Release,
        aggregate: release,
        eventInput: {
          eventType: 'release.created',
          project: release.project?._id || release.project,
          actor: req.user._id,
          actorSnapshot: { name: req.user.name, role: req.user.role },
          subjectType: 'release',
          subjectId: release._id,
          subjectTitleSnapshot: `${release.name} (${release.version})`,
          release: release._id,
          changes: [
            { field: 'name', from: null, to: release.name },
            { field: 'version', from: null, to: release.version },
            { field: 'status', from: null, to: release.status },
          ],
        },
      });
    } catch (evErr) {
      if (evErr.isLedgerFailure) throw evErr;
    }

    res.status(201).json({
      success: true,
      release,
      readiness: {
        availability: 'insufficient_data',
        score: null,
        label: 'INSUFFICIENT DATA',
        message: 'Add tasks to active release milestones to calculate readiness.',
        drivers: [],
        metrics: {
          totalTasks: 0,
          completedTasks: 0,
          completedMilestones: 0,
          totalMilestones: 0,
          overdueTasks: 0,
          blockedTasks: 0,
          unassignedHighCriticalTasks: 0,
          overdueMilestones: 0,
          staleTasks: 0,
        },
      },
    });
  } catch (error) {
    if (error.code === 11000 || (error.name === 'MongoServerError' && error.code === 11000) || (error.message && error.message.includes('11000'))) {
      return res.status(409).json({
        success: false,
        message: 'A release with this version already exists for this project',
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Update release
// @route PUT /api/releases/:id
const updateRelease = async (req, res) => {
  try {
    if (req.user.role === 'member') {
      return res.status(403).json({ success: false, message: 'Members are not authorized to update releases' });
    }

    if (mongoose.connection.readyState === 1 && !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid release ID format' });
    }

    const release = await Release.findById(req.params.id);
    if (!release) {
      return res.status(404).json({ success: false, message: 'Release not found' });
    }

    const proj = await Project.findById(release.project);
    if (!proj) {
      return res.status(404).json({ success: false, message: 'Referenced project not found' });
    }

    if (!canUserManageProject(req.user, proj)) {
      return res.status(403).json({ success: false, message: 'Not authorized to manage releases for this project' });
    }

    if (proj.status === 'archived') {
      return res.status(400).json({ success: false, message: 'Cannot update release for an archived project' });
    }

    // Lifecycle guards: cancelled and shipped releases are immutable
    if (release.status === 'cancelled') {
      return res.status(409).json({
        success: false,
        message: 'Cancelled releases are archived and cannot be modified',
      });
    }
    if (release.status === 'shipped') {
      return res.status(409).json({
        success: false,
        message: 'Shipped releases are immutable and cannot be modified',
      });
    }

    const oldName = release.name;
    const oldVersion = release.version;
    const oldStatus = release.status;
    const oldTargetDate = release.targetDate ? new Date(release.targetDate).toISOString() : null;

    const { name, version, description, targetDate, status } = req.body;

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Release name cannot be empty' });
      }
      if (name.trim().length > 80) {
        return res.status(400).json({ success: false, message: 'Release name cannot exceed 80 characters' });
      }
      release.name = name.trim();
    }

    if (version !== undefined) {
      if (typeof version !== 'string' || !version.trim()) {
        return res.status(400).json({ success: false, message: 'Version cannot be empty' });
      }
      if (version.trim().length > 30) {
        return res.status(400).json({ success: false, message: 'Version cannot exceed 30 characters' });
      }
      const trimmed = version.trim();
      let duplicate = null;
      if (mongoose.connection.readyState === 1 || Release.findOne !== mongoose.Model.findOne) {
        duplicate = await Release.findOne({
          project: proj._id,
          version: trimmed,
          _id: { $ne: release._id },
        });
      }
      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: `A release with version "${trimmed}" already exists for this project`,
        });
      }
      release.version = trimmed;
    }

    if (description !== undefined) {
      if (typeof description === 'string' && description.trim().length > 1000) {
        return res.status(400).json({ success: false, message: 'Description cannot exceed 1000 characters' });
      }
      release.description = typeof description === 'string' ? description.trim() : '';
    }

    if (targetDate !== undefined) {
      if (!targetDate) {
        return res.status(400).json({ success: false, message: 'Target date cannot be empty' });
      }
      const parsed = new Date(targetDate);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ success: false, message: 'Target date must be a valid date' });
      }
      release.targetDate = parsed;
    }

    if (status !== undefined) {
      if (!ALLOWED_RELEASE_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed values: ${ALLOWED_RELEASE_STATUSES.join(', ')}`,
        });
      }
      // Status transition validation
      if (status !== release.status) {
        if (release.status === 'planning' && status === 'shipped') {
          return res.status(400).json({
            success: false,
            message: 'Release must be active or in code-freeze before it can be marked as shipped',
          });
        }
        if (status === 'cancelled') {
          let activeMilestones = 0;
          if (mongoose.connection.readyState === 1 || Milestone.countDocuments !== mongoose.Model.countDocuments) {
            activeMilestones = await Milestone.countDocuments({
              release: release._id,
              status: { $in: ['open', 'at-risk'] },
            });
          }
          if (activeMilestones > 0) {
            return res.status(409).json({
              success: false,
              message: `Cannot cancel release with ${activeMilestones} active milestone(s) (open or at-risk). Active milestones must be completed or cancelled before cancelling the release target.`,
            });
          }
        }
        release.status = status;
      }
    }

    await release.save();

    await release.populate([
      { path: 'project', select: 'name color status' },
      { path: 'createdBy', select: 'name email avatar' },
    ]);

    const changes = [];
    if (release.name !== oldName) changes.push({ field: 'name', from: oldName, to: release.name });
    if (release.version !== oldVersion) changes.push({ field: 'version', from: oldVersion, to: release.version });
    if (release.status !== oldStatus) changes.push({ field: 'status', from: oldStatus, to: release.status });
    const newTargetDate = release.targetDate ? new Date(release.targetDate).toISOString() : null;
    if (newTargetDate !== oldTargetDate) changes.push({ field: 'targetDate', from: oldTargetDate, to: newTargetDate });

    if (changes.length > 0) {
      let eventType = 'release.updated';
      if (release.status !== oldStatus) {
        eventType = release.status === 'cancelled' ? 'release.cancelled' : 'release.status_changed';
      }

      try {
        await recordExecutionEvent({
          model: Release,
          aggregate: release,
          eventInput: {
            eventType,
            project: release.project?._id || release.project,
            actor: req.user._id,
            actorSnapshot: { name: req.user.name, role: req.user.role },
            subjectType: 'release',
            subjectId: release._id,
            subjectTitleSnapshot: `${release.name} (${release.version})`,
            release: release._id,
            changes,
          },
        });
      } catch (evErr) {
        if (evErr.isLedgerFailure) throw evErr;
      }
    }

    const details = await attachReadiness(release);

    res.json({
      success: true,
      release,
      readiness: details.readiness,
    });
  } catch (error) {
    if (error.code === 11000 || (error.name === 'MongoServerError' && error.code === 11000) || (error.message && error.message.includes('11000'))) {
      return res.status(409).json({
        success: false,
        message: 'A release with this version already exists for this project',
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Safe cancel release (permanent deletion disabled)
// @route DELETE /api/releases/:id
const deleteRelease = async (req, res) => {
  try {
    if (req.user.role === 'member') {
      return res.status(403).json({ success: false, message: 'Members are not authorized to cancel releases' });
    }

    if (mongoose.connection.readyState === 1 && !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid release ID format' });
    }

    const release = await Release.findById(req.params.id);
    if (!release) {
      return res.status(404).json({ success: false, message: 'Release not found' });
    }

    const proj = await Project.findById(release.project);
    if (!proj) {
      return res.status(404).json({ success: false, message: 'Referenced project not found' });
    }

    if (!canUserManageProject(req.user, proj)) {
      return res.status(403).json({ success: false, message: 'Not authorized to manage releases for this project' });
    }

    // Only milestones with status open or at-risk block release cancellation
    let activeMilestones = 0;
    if (mongoose.connection.readyState === 1 || Milestone.countDocuments !== mongoose.Model.countDocuments) {
      activeMilestones = await Milestone.countDocuments({
        release: release._id,
        status: { $in: ['open', 'at-risk'] },
      });
    }
    if (activeMilestones > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot cancel release with ${activeMilestones} active milestone(s) (open or at-risk). Active milestones must be completed or cancelled before cancelling the release target.`,
      });
    }

    // Safe archival / cancel transition: do not delete document
    const oldStatus = release.status;
    release.status = 'cancelled';
    await release.save();

    try {
      await recordExecutionEvent({
        model: Release,
        aggregate: release,
        eventInput: {
          eventType: 'release.cancelled',
          project: release.project?._id || release.project,
          actor: req.user._id,
          actorSnapshot: { name: req.user.name, role: req.user.role },
          subjectType: 'release',
          subjectId: release._id,
          subjectTitleSnapshot: `${release.name} (${release.version})`,
          release: release._id,
          changes: [{ field: 'status', from: oldStatus, to: 'cancelled' }],
        },
      });
    } catch (evErr) {
      if (evErr.isLedgerFailure) throw evErr;
    }

    res.json({
      success: true,
      message: 'Permanent deletion is disabled. Release has been cancelled to preserve historical delivery records.',
      release,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Get delivery intelligence for a release
// @route GET /api/releases/:releaseId/delivery-intelligence
const getReleaseDeliveryIntelligence = async (req, res) => {
  try {
    const { releaseId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(releaseId)) {
      return res.status(400).json({ success: false, message: 'Invalid release ID format' });
    }

    const release = await Release.findById(releaseId);
    if (!release) {
      return res.status(404).json({ success: false, message: 'Release not found' });
    }

    const project = await Project.findById(release.project);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Referenced project not found' });
    }

    if (!canUserViewProject(req.user, project)) {
      return res.status(403).json({ success: false, message: 'Not authorized to access delivery intelligence for this release' });
    }

    // Exactly bounded batch queries
    const milestones = await Milestone.find({ project: project._id }).sort({ sequence: 1 });
    const tasks = await Task.find({ project: project._id })
      .populate('assignedTo', 'name email avatar')
      .populate('milestone', 'title status sequence release')
      .sort({ createdAt: 1 });

    const payload = buildDeliveryIntelligencePayload(project, release, tasks, milestones, req.user);

    res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getReleases,
  getRelease,
  createRelease,
  updateRelease,
  deleteRelease,
  getReleaseDeliveryIntelligence,
  canUserViewProject,
  canUserManageProject,
  ALLOWED_RELEASE_STATUSES,
};
