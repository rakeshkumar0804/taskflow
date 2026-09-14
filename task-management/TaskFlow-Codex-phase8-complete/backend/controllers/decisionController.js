const mongoose = require('mongoose');
const DecisionRecord = require('../models/DecisionRecord');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Milestone = require('../models/Milestone');
const Release = require('../models/Release');
const { computeDecisionImpact, canUserAccessTask } = require('../utils/decisionImpact');
const {
  canReadProject,
  canManageProject,
} = require('../utils/projectAuthorization');
const { recordExecutionEvent } = require('../services/executionEventService');

// Escape regex special characters to prevent ReDoS
const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// @desc  Get all decision records (filtered)
// @route GET /api/decisions
const getDecisions = async (req, res) => {
  try {
    const { project, status, release, milestone, task, search, page = 1, limit = 20 } = req.query;

    const filter = {};

    // Validate and scope by project
    if (project) {
      if (!mongoose.Types.ObjectId.isValid(project)) {
        return res.status(400).json({ success: false, message: 'Invalid project ID format' });
      }
      const projDoc = await Project.findById(project);
      if (!projDoc) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }
      if (!canReadProject(req.user, projDoc)) {
        return res.status(403).json({ success: false, message: 'Not authorized to access decisions for this project' });
      }
      filter.project = project;
    } else {
      // Role-based project scoping
      if (req.user.role === 'member') {
        const memberProjects = await Project.find({ 'members.user': req.user._id }).select('_id');
        const allowedProjIds = memberProjects.map((p) => p._id);
        filter.project = { $in: allowedProjIds };
      } else if (req.user.role === 'manager') {
        const managerProjects = await Project.find({
          $or: [{ owner: req.user._id }, { 'members.user': req.user._id }],
        }).select('_id');
        const allowedProjIds = managerProjects.map((p) => p._id);
        filter.project = { $in: allowedProjIds };
      }
    }

    if (status) {
      const ALLOWED_STATUSES = ['proposed', 'accepted', 'rejected', 'superseded', 'withdrawn'];
      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status filter' });
      }
      filter.status = status;
    }

    if (release) {
      if (!mongoose.Types.ObjectId.isValid(release)) {
        return res.status(400).json({ success: false, message: 'Invalid release ID format' });
      }
      filter.linkedReleases = release;
    }

    if (milestone) {
      if (!mongoose.Types.ObjectId.isValid(milestone)) {
        return res.status(400).json({ success: false, message: 'Invalid milestone ID format' });
      }
      filter.linkedMilestones = milestone;
    }

    if (task) {
      if (!mongoose.Types.ObjectId.isValid(task)) {
        return res.status(400).json({ success: false, message: 'Invalid task ID format' });
      }
      if (req.user.role === 'member') {
        const taskDoc = await Task.findById(task);
        if (!taskDoc || !canUserAccessTask(req.user, taskDoc)) {
          // Amendment 2: Inaccessible and nonexistent task IDs behave identically and do not leak existence
          return res.json({
            success: true,
            count: 0,
            totalCount: 0,
            totalPages: 0,
            currentPage: 1,
            decisions: [],
          });
        }
      }
      filter.linkedTasks = task;
    }

    if (search && typeof search === 'string' && search.trim()) {
      const safeSearch = escapeRegex(search.trim());
      filter.$or = [
        { title: { $regex: safeSearch, $options: 'i' } },
        { context: { $regex: safeSearch, $options: 'i' } },
        { decision: { $regex: safeSearch, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [decisions, totalCount] = await Promise.all([
      DecisionRecord.find(filter)
        .populate('project', 'name color status')
        .populate('proposedBy', 'name email avatar')
        .populate('decidedBy', 'name email avatar')
        .populate('supersededBy', 'title status')
        .sort({ updatedAt: -1, _id: -1 })
        .skip(skip)
        .limit(limitNum),
      DecisionRecord.countDocuments(filter),
    ]);

    const formatted = decisions.map((d) => {
      const doc = d.toObject ? d.toObject() : { ...d };
      return doc;
    });

    res.json({
      success: true,
      count: formatted.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
      currentPage: pageNum,
      decisions: formatted,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Get single decision record
// @route GET /api/decisions/:id
const getDecision = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid decision ID format' });
    }

    const decision = await DecisionRecord.findById(req.params.id)
      .populate('project', 'name color status owner members')
      .populate('proposedBy', 'name email avatar')
      .populate('decidedBy', 'name email avatar')
      .populate('supersededBy', 'title status')
      .populate('linkedTasks', 'title status priority assignedTo createdBy project')
      .populate('linkedMilestones', 'title status sequence dueDate release')
      .populate('linkedReleases', 'name version status targetDate');

    if (!decision) {
      return res.status(404).json({ success: false, message: 'Decision record not found' });
    }

    if (!canReadProject(req.user, decision.project)) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this decision record' });
    }

    const doc = decision.toObject ? decision.toObject() : { ...decision };

    // Member privacy: filter out inaccessible linked tasks
    if (req.user.role === 'member' && Array.isArray(doc.linkedTasks)) {
      doc.linkedTasks = doc.linkedTasks.filter((t) => canUserAccessTask(req.user, t));
    }

    res.json({ success: true, decision: doc });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Create decision record (proposal)
// @route POST /api/decisions
const createDecision = async (req, res) => {
  try {
    const {
      title,
      context,
      decision,
      rationale,
      alternatives,
      consequences,
      project,
      linkedTasks,
      linkedMilestones,
      linkedReleases,
    } = req.body;

    // Required content validations
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Decision title is required' });
    }
    if (title.trim().length > 120) {
      return res.status(400).json({ success: false, message: 'Title cannot exceed 120 characters' });
    }

    if (!context || typeof context !== 'string' || !context.trim()) {
      return res.status(400).json({ success: false, message: 'Context is required' });
    }
    if (context.trim().length > 3000) {
      return res.status(400).json({ success: false, message: 'Context cannot exceed 3000 characters' });
    }

    if (!decision || typeof decision !== 'string' || !decision.trim()) {
      return res.status(400).json({ success: false, message: 'Decision statement is required' });
    }
    if (decision.trim().length > 3000) {
      return res.status(400).json({ success: false, message: 'Decision statement cannot exceed 3000 characters' });
    }

    if (!rationale || typeof rationale !== 'string' || !rationale.trim()) {
      return res.status(400).json({ success: false, message: 'Rationale is required' });
    }
    if (rationale.trim().length > 3000) {
      return res.status(400).json({ success: false, message: 'Rationale cannot exceed 3000 characters' });
    }

    if (!project || !mongoose.Types.ObjectId.isValid(project)) {
      return res.status(400).json({ success: false, message: 'Valid project ID is required' });
    }

    const projectDoc = await Project.findById(project);
    if (!projectDoc) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Invariant: Archived projects are read-only
    if (projectDoc.status === 'archived') {
      return res.status(409).json({ success: false, message: 'Cannot create decisions in an archived project' });
    }

    // Authorization: Admin, Project-owning Manager, or Member belonging to project
    if (req.user.role === 'member') {
      const isMember = projectDoc.members.some(
        (m) => m.user && (m.user._id ? m.user._id.toString() : m.user.toString()) === req.user._id.toString()
      );
      if (!isMember) {
        return res.status(403).json({ success: false, message: 'Not authorized to propose decisions for this project' });
      }
    } else if (req.user.role === 'manager') {
      if (!canManageProject(req.user, projectDoc)) {
        return res.status(403).json({ success: false, message: 'Not authorized to create decisions in another manager project' });
      }
    }

    // Alternatives validation
    const parsedAlternatives = [];
    if (alternatives !== undefined) {
      if (!Array.isArray(alternatives)) {
        return res.status(400).json({ success: false, message: 'Alternatives must be an array' });
      }
      if (alternatives.length > 10) {
        return res.status(400).json({ success: false, message: 'Maximum 10 alternatives allowed' });
      }
      for (const alt of alternatives) {
        if (!alt || typeof alt.title !== 'string' || !alt.title.trim()) {
          return res.status(400).json({ success: false, message: 'Alternative title is required' });
        }
        if (alt.title.trim().length > 120) {
          return res.status(400).json({ success: false, message: 'Alternative title cannot exceed 120 characters' });
        }
        if (!alt.reasonRejected || typeof alt.reasonRejected !== 'string' || !alt.reasonRejected.trim()) {
          return res.status(400).json({ success: false, message: 'Alternative rejection reason is required' });
        }
        if (alt.reasonRejected.trim().length > 600) {
          return res.status(400).json({ success: false, message: 'Alternative rejection reason cannot exceed 600 characters' });
        }
        parsedAlternatives.push({
          title: alt.title.trim(),
          reasonRejected: alt.reasonRejected.trim(),
        });
      }
    }

    // Consequences validation
    const parsedConsequences = { positive: [], negative: [], risks: [] };
    if (typeof consequences === 'string' && consequences.trim()) {
      parsedConsequences.positive.push(consequences.trim());
    } else if (consequences && typeof consequences === 'object') {
      for (const cat of ['positive', 'negative', 'risks']) {
        if (consequences[cat] !== undefined) {
          if (!Array.isArray(consequences[cat])) {
            return res.status(400).json({ success: false, message: `Consequences ${cat} must be an array` });
          }
          if (consequences[cat].length > 10) {
            return res.status(400).json({ success: false, message: `Maximum 10 ${cat} consequences allowed` });
          }
          for (const item of consequences[cat]) {
            if (typeof item !== 'string' || !item.trim()) {
              return res.status(400).json({ success: false, message: 'Consequence entry cannot be empty' });
            }
            if (item.trim().length > 600) {
              return res.status(400).json({ success: false, message: 'Consequence entry cannot exceed 600 characters' });
            }
            parsedConsequences[cat].push(item.trim());
          }
        }
      }
    }

    // Relationship Integrity: linkedTasks
    const deduplicatedTasks = [];
    if (linkedTasks !== undefined) {
      if (!Array.isArray(linkedTasks)) {
        return res.status(400).json({ success: false, message: 'Linked tasks must be an array' });
      }
      if (linkedTasks.length > 25) {
        return res.status(400).json({ success: false, message: 'Maximum 25 linked tasks allowed' });
      }
      const taskIds = Array.from(new Set(linkedTasks.map((id) => (id ? id.toString() : '')))).filter(Boolean);
      for (const tId of taskIds) {
        if (!mongoose.Types.ObjectId.isValid(tId)) {
          return res.status(400).json({ success: false, message: `Invalid linked task ID format: ${tId}` });
        }
        const taskDoc = await Task.findById(tId);

        // Amendment 2: Member server-side privacy enforcement
        // Nonexistent and inaccessible tasks must produce the identical generic message without revealing existence
        if (req.user.role === 'member') {
          if (!taskDoc || !canUserAccessTask(req.user, taskDoc)) {
            return res.status(400).json({
              success: false,
              message: 'One or more linked tasks are invalid or inaccessible.',
            });
          }
        } else {
          if (!taskDoc) {
            return res.status(404).json({ success: false, message: `Linked task not found: ${tId}` });
          }
        }

        const tProj = taskDoc.project ? taskDoc.project.toString() : '';
        if (tProj !== project.toString()) {
          return res.status(400).json({ success: false, message: `Linked task ${tId} does not belong to project ${project}` });
        }
        deduplicatedTasks.push(taskDoc._id);
      }
    }

    // Relationship Integrity: linkedMilestones
    const deduplicatedMilestones = [];
    if (linkedMilestones !== undefined) {
      if (!Array.isArray(linkedMilestones)) {
        return res.status(400).json({ success: false, message: 'Linked milestones must be an array' });
      }
      if (linkedMilestones.length > 15) {
        return res.status(400).json({ success: false, message: 'Maximum 15 linked milestones allowed' });
      }
      const msIds = Array.from(new Set(linkedMilestones.map((id) => (id ? id.toString() : '')))).filter(Boolean);
      for (const mId of msIds) {
        if (!mongoose.Types.ObjectId.isValid(mId)) {
          return res.status(400).json({ success: false, message: `Invalid linked milestone ID format: ${mId}` });
        }
        const msDoc = await Milestone.findById(mId);
        if (!msDoc) {
          return res.status(404).json({ success: false, message: `Linked milestone not found: ${mId}` });
        }
        const mProj = msDoc.project ? msDoc.project.toString() : '';
        if (mProj !== project.toString()) {
          return res.status(400).json({ success: false, message: `Linked milestone ${mId} does not belong to project ${project}` });
        }
        deduplicatedMilestones.push(msDoc._id);
      }
    }

    // Relationship Integrity: linkedReleases
    const deduplicatedReleases = [];
    if (linkedReleases !== undefined) {
      if (!Array.isArray(linkedReleases)) {
        return res.status(400).json({ success: false, message: 'Linked releases must be an array' });
      }
      if (linkedReleases.length > 10) {
        return res.status(400).json({ success: false, message: 'Maximum 10 linked releases allowed' });
      }
      const relIds = Array.from(new Set(linkedReleases.map((id) => (id ? id.toString() : '')))).filter(Boolean);
      for (const rId of relIds) {
        if (!mongoose.Types.ObjectId.isValid(rId)) {
          return res.status(400).json({ success: false, message: `Invalid linked release ID format: ${rId}` });
        }
        const relDoc = await Release.findById(rId);
        if (!relDoc) {
          return res.status(404).json({ success: false, message: `Linked release not found: ${rId}` });
        }
        const rProj = relDoc.project ? relDoc.project.toString() : '';
        if (rProj !== project.toString()) {
          return res.status(400).json({ success: false, message: `Linked release ${rId} does not belong to project ${project}` });
        }
        deduplicatedReleases.push(relDoc._id);
      }
    }

    // Creation payload: strictly enforces proposal status and strips client audit fields
    const newDecision = await DecisionRecord.create({
      title: title.trim(),
      context: context.trim(),
      decision: decision.trim(),
      rationale: rationale.trim(),
      alternatives: parsedAlternatives,
      consequences: parsedConsequences,
      status: 'proposed',
      project: projectDoc._id,
      linkedTasks: deduplicatedTasks,
      linkedMilestones: deduplicatedMilestones,
      linkedReleases: deduplicatedReleases,
      proposedBy: req.user._id,
      decidedBy: null,
      decidedAt: null,
      supersededBy: null,
    });

    const populated = await newDecision.populate([
      { path: 'project', select: 'name color status' },
      { path: 'proposedBy', select: 'name email avatar' },
    ]);

    req.io?.emit('decision:created', populated);

    try {
      await recordExecutionEvent({
        model: DecisionRecord,
        aggregate: newDecision,
        eventInput: {
          eventType: 'decision.created',
          project: newDecision.project?._id || newDecision.project,
          actor: req.user._id,
          actorSnapshot: { name: req.user.name, role: req.user.role },
          subjectType: 'decision',
          subjectId: newDecision._id,
          subjectTitleSnapshot: newDecision.title,
          decision: newDecision._id,
          changes: [
            { field: 'title', from: null, to: newDecision.title },
            { field: 'status', from: null, to: newDecision.status },
          ],
        },
      });
    } catch (evErr) {
      if (mongoose.connection.readyState !== 0 || evErr.isLedgerFailure) throw evErr;
    }

    res.status(201).json({ success: true, decision: populated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Update decision record (content only, for proposed records)
// @route PUT /api/decisions/:id
const updateDecision = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid decision ID format' });
    }

    const decision = await DecisionRecord.findById(req.params.id);
    if (!decision) {
      return res.status(404).json({ success: false, message: 'Decision record not found' });
    }

    // Lifecycle invariant: Only proposed decisions can be updated
    if (decision.status !== 'proposed') {
      return res.status(409).json({
        success: false,
        message: 'Accepted, rejected, superseded, or withdrawn decisions are immutable in content',
      });
    }

    const projectDoc = await Project.findById(decision.project);
    if (!projectDoc) {
      return res.status(404).json({ success: false, message: 'Associated project not found' });
    }

    if (projectDoc.status === 'archived') {
      return res.status(409).json({ success: false, message: 'Cannot modify decisions in an archived project' });
    }

    // Authorization: Proposer can edit own proposal; Project-owning Manager or Admin can edit proposals
    const isProposer = decision.proposedBy ? decision.proposedBy.toString() === req.user._id.toString() : false;
    const canManage = canManageProject(req.user, projectDoc);

    if (!isProposer && !canManage) {
      return res.status(403).json({ success: false, message: 'Not authorized to edit this proposed decision' });
    }

    const oldTitle = decision.title;

    // Field whitelist (explicitly strips status, proposedBy, decidedBy, decidedAt, supersededBy, project)
    const {
      title,
      context,
      decision: decisionText,
      rationale,
      alternatives,
      consequences,
      linkedTasks,
      linkedMilestones,
      linkedReleases,
    } = req.body;

    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ success: false, message: 'Title cannot be empty' });
      }
      if (title.trim().length > 120) {
        return res.status(400).json({ success: false, message: 'Title cannot exceed 120 characters' });
      }
      decision.title = title.trim();
    }

    if (context !== undefined) {
      if (typeof context !== 'string' || !context.trim()) {
        return res.status(400).json({ success: false, message: 'Context cannot be empty' });
      }
      if (context.trim().length > 3000) {
        return res.status(400).json({ success: false, message: 'Context cannot exceed 3000 characters' });
      }
      decision.context = context.trim();
    }

    if (decisionText !== undefined) {
      if (typeof decisionText !== 'string' || !decisionText.trim()) {
        return res.status(400).json({ success: false, message: 'Decision statement cannot be empty' });
      }
      if (decisionText.trim().length > 3000) {
        return res.status(400).json({ success: false, message: 'Decision statement cannot exceed 3000 characters' });
      }
      decision.decision = decisionText.trim();
    }

    if (rationale !== undefined) {
      if (typeof rationale !== 'string' || !rationale.trim()) {
        return res.status(400).json({ success: false, message: 'Rationale cannot be empty' });
      }
      if (rationale.trim().length > 3000) {
        return res.status(400).json({ success: false, message: 'Rationale cannot exceed 3000 characters' });
      }
      decision.rationale = rationale.trim();
    }

    if (alternatives !== undefined) {
      if (!Array.isArray(alternatives)) {
        return res.status(400).json({ success: false, message: 'Alternatives must be an array' });
      }
      if (alternatives.length > 10) {
        return res.status(400).json({ success: false, message: 'Maximum 10 alternatives allowed' });
      }
      const parsedAlts = [];
      for (const alt of alternatives) {
        if (!alt || typeof alt.title !== 'string' || !alt.title.trim()) {
          return res.status(400).json({ success: false, message: 'Alternative title is required' });
        }
        if (alt.title.trim().length > 120) {
          return res.status(400).json({ success: false, message: 'Alternative title cannot exceed 120 characters' });
        }
        if (!alt.reasonRejected || typeof alt.reasonRejected !== 'string' || !alt.reasonRejected.trim()) {
          return res.status(400).json({ success: false, message: 'Alternative rejection reason is required' });
        }
        if (alt.reasonRejected.trim().length > 600) {
          return res.status(400).json({ success: false, message: 'Alternative rejection reason cannot exceed 600 characters' });
        }
        parsedAlts.push({ title: alt.title.trim(), reasonRejected: alt.reasonRejected.trim() });
      }
      decision.alternatives = parsedAlts;
    }

    if (consequences !== undefined) {
      const parsedCons = { positive: [], negative: [], risks: [] };
      for (const cat of ['positive', 'negative', 'risks']) {
        if (consequences[cat] !== undefined) {
          if (!Array.isArray(consequences[cat])) {
            return res.status(400).json({ success: false, message: `Consequences ${cat} must be an array` });
          }
          if (consequences[cat].length > 10) {
            return res.status(400).json({ success: false, message: `Maximum 10 ${cat} consequences allowed` });
          }
          for (const item of consequences[cat]) {
            if (typeof item !== 'string' || !item.trim()) {
              return res.status(400).json({ success: false, message: 'Consequence entry cannot be empty' });
            }
            if (item.trim().length > 600) {
              return res.status(400).json({ success: false, message: 'Consequence entry cannot exceed 600 characters' });
            }
            parsedCons[cat].push(item.trim());
          }
        }
      }
      decision.consequences = parsedCons;
    }

    // Relationship updates: linkedTasks
    if (linkedTasks !== undefined) {
      if (!Array.isArray(linkedTasks)) {
        return res.status(400).json({ success: false, message: 'Linked tasks must be an array' });
      }
      if (linkedTasks.length > 25) {
        return res.status(400).json({ success: false, message: 'Maximum 25 linked tasks allowed' });
      }
      const taskIds = Array.from(new Set(linkedTasks.map((id) => (id ? id.toString() : '')))).filter(Boolean);
      const validTaskIds = [];
      for (const tId of taskIds) {
        if (!mongoose.Types.ObjectId.isValid(tId)) {
          return res.status(400).json({ success: false, message: `Invalid linked task ID format: ${tId}` });
        }
        const taskDoc = await Task.findById(tId);

        // Amendment 2: Member server-side privacy enforcement
        if (req.user.role === 'member') {
          if (!taskDoc || !canUserAccessTask(req.user, taskDoc)) {
            return res.status(400).json({
              success: false,
              message: 'One or more linked tasks are invalid or inaccessible.',
            });
          }
        } else {
          if (!taskDoc) {
            return res.status(404).json({ success: false, message: `Linked task not found: ${tId}` });
          }
        }

        const tProj = taskDoc.project ? taskDoc.project.toString() : '';
        if (tProj !== decision.project.toString()) {
          return res.status(400).json({ success: false, message: `Linked task ${tId} does not belong to project ${decision.project}` });
        }
        validTaskIds.push(taskDoc._id);
      }
      decision.linkedTasks = validTaskIds;
    }

    // Relationship updates: linkedMilestones
    if (linkedMilestones !== undefined) {
      if (!Array.isArray(linkedMilestones)) {
        return res.status(400).json({ success: false, message: 'Linked milestones must be an array' });
      }
      if (linkedMilestones.length > 15) {
        return res.status(400).json({ success: false, message: 'Maximum 15 linked milestones allowed' });
      }
      const msIds = Array.from(new Set(linkedMilestones.map((id) => (id ? id.toString() : '')))).filter(Boolean);
      const validMsIds = [];
      for (const mId of msIds) {
        if (!mongoose.Types.ObjectId.isValid(mId)) {
          return res.status(400).json({ success: false, message: `Invalid linked milestone ID format: ${mId}` });
        }
        const msDoc = await Milestone.findById(mId);
        if (!msDoc) {
          return res.status(404).json({ success: false, message: `Linked milestone not found: ${mId}` });
        }
        const mProj = msDoc.project ? msDoc.project.toString() : '';
        if (mProj !== decision.project.toString()) {
          return res.status(400).json({ success: false, message: `Linked milestone ${mId} does not belong to project ${decision.project}` });
        }
        validMsIds.push(msDoc._id);
      }
      decision.linkedMilestones = validMsIds;
    }

    // Relationship updates: linkedReleases
    if (linkedReleases !== undefined) {
      if (!Array.isArray(linkedReleases)) {
        return res.status(400).json({ success: false, message: 'Linked releases must be an array' });
      }
      if (linkedReleases.length > 10) {
        return res.status(400).json({ success: false, message: 'Maximum 10 linked releases allowed' });
      }
      const relIds = Array.from(new Set(linkedReleases.map((id) => (id ? id.toString() : '')))).filter(Boolean);
      const validRelIds = [];
      for (const rId of relIds) {
        if (!mongoose.Types.ObjectId.isValid(rId)) {
          return res.status(400).json({ success: false, message: `Invalid linked release ID format: ${rId}` });
        }
        const relDoc = await Release.findById(rId);
        if (!relDoc) {
          return res.status(404).json({ success: false, message: `Linked release not found: ${rId}` });
        }
        const rProj = relDoc.project ? relDoc.project.toString() : '';
        if (rProj !== decision.project.toString()) {
          return res.status(400).json({ success: false, message: `Linked release ${rId} does not belong to project ${decision.project}` });
        }
        validRelIds.push(relDoc._id);
      }
      decision.linkedReleases = validRelIds;
    }

    await decision.save();

    await decision.populate([
      { path: 'project', select: 'name color status' },
      { path: 'proposedBy', select: 'name email avatar' },
    ]);

    req.io?.emit('decision:updated', decision);

    try {
      const changes = [];
      if (decision.title !== oldTitle) changes.push({ field: 'title', from: oldTitle, to: decision.title });
      await recordExecutionEvent({
        model: DecisionRecord,
        aggregate: decision,
        eventInput: {
          eventType: 'decision.updated',
          project: decision.project?._id || decision.project,
          actor: req.user._id,
          actorSnapshot: { name: req.user.name, role: req.user.role },
          subjectType: 'decision',
          subjectId: decision._id,
          subjectTitleSnapshot: decision.title,
          decision: decision._id,
          changes,
        },
      });
    } catch (evErr) {
      if (mongoose.connection.readyState !== 0 || evErr.isLedgerFailure) throw evErr;
    }

    res.json({ success: true, decision });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Transition decision record lifecycle state
// @route POST /api/decisions/:id/transition
const transitionDecision = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid decision ID format' });
    }

    const decision = await DecisionRecord.findById(req.params.id);
    if (!decision) {
      return res.status(404).json({ success: false, message: 'Decision record not found' });
    }

    const projectDoc = await Project.findById(decision.project);
    if (!projectDoc) {
      return res.status(404).json({ success: false, message: 'Associated project not found' });
    }

    // Amendment 3: Archived project mutation returns 409 Conflict
    if (projectDoc.status === 'archived') {
      return res.status(409).json({ success: false, message: 'Cannot transition decisions in an archived project' });
    }

    const { status: targetStatus, replacementDecisionId } = req.body;
    const ALLOWED_TARGETS = ['accepted', 'rejected', 'withdrawn', 'superseded', 'deprecated'];

    // Amendment 3: Malformed identifier or malformed payload returns 400
    if (!targetStatus || !ALLOWED_TARGETS.includes(targetStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid target status. Allowed transitions: ${ALLOWED_TARGETS.join(', ')}`,
      });
    }

    const currentStatus = decision.status;

    // Amendment 3: Terminal-state mutation returns 409 Conflict
    if (['rejected', 'withdrawn', 'superseded', 'deprecated'].includes(currentStatus)) {
      return res.status(409).json({
        success: false,
        message: `Decision is in terminal state '${currentStatus}' and cannot be transitioned`,
      });
    }

    // Amendment 3: Invalid lifecycle transition returns 409 Conflict
    if (currentStatus === 'proposed') {
      if (targetStatus === 'superseded' || targetStatus === 'deprecated') {
        return res.status(409).json({
          success: false,
          message: `Proposed decisions cannot be directly ${targetStatus}; they must be accepted first or withdrawn`,
        });
      }
    } else if (currentStatus === 'accepted') {
      if (targetStatus !== 'superseded' && targetStatus !== 'deprecated') {
        return res.status(409).json({
          success: false,
          message: `Accepted decisions cannot transition to '${targetStatus}'; they can only be superseded by another accepted decision or deprecated`,
        });
      }
    }

    // Amendment 3: Unauthorized transition returns 403 Forbidden
    const canManage = canManageProject(req.user, projectDoc);
    const isProposer = decision.proposedBy ? decision.proposedBy.toString() === req.user._id.toString() : false;

    if (['accepted', 'rejected', 'superseded', 'deprecated'].includes(targetStatus)) {
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: `Only project managers and admins can transition decisions to '${targetStatus}'`,
        });
      }
    } else if (targetStatus === 'withdrawn') {
      if (!isProposer && !canManage) {
        return res.status(403).json({
          success: false,
          message: 'Only the proposer or project managers can withdraw a proposed decision',
        });
      }
    }

    // Supersession verification
    if (targetStatus === 'superseded') {
      // Amendment 3: Malformed payload / missing replacement -> 400
      if (!replacementDecisionId) {
        return res.status(400).json({
          success: false,
          message: 'Replacement decision ID is required when superseding a decision',
        });
      }
      if (!mongoose.Types.ObjectId.isValid(replacementDecisionId)) {
        return res.status(400).json({ success: false, message: 'Invalid replacement decision ID format' });
      }
      // Amendment 3: Self-supersession returns 400
      if (replacementDecisionId.toString() === decision._id.toString()) {
        return res.status(400).json({ success: false, message: 'A decision cannot supersede itself' });
      }

      // Amendment 3: Missing accessible entity returns 404
      const replacementDoc = await DecisionRecord.findById(replacementDecisionId);
      if (!replacementDoc) {
        return res.status(404).json({ success: false, message: 'Replacement decision not found' });
      }
      // Amendment 3: Cross-project relationship returns 400
      if (replacementDoc.project.toString() !== decision.project.toString()) {
        return res.status(400).json({
          success: false,
          message: 'Replacement decision must belong to the same project',
        });
      }
      // Amendment 3: Non-accepted replacement decision returns 409 Conflict
      if (replacementDoc.status !== 'accepted') {
        return res.status(409).json({
          success: false,
          message: 'Replacement decision must have status "accepted"',
        });
      }

      // Amendment 3: Circular supersession chain detection returns 409 Conflict
      let curr = replacementDoc;
      const visitedChain = new Set([decision._id.toString()]);
      while (curr && curr.supersededBy) {
        const nextId = curr.supersededBy.toString();
        if (visitedChain.has(nextId)) {
          return res.status(409).json({
            success: false,
            message: 'Circular supersession chain detected; cannot complete transition',
          });
        }
        visitedChain.add(nextId);
        curr = await DecisionRecord.findById(nextId);
      }

      decision.supersededBy = replacementDoc._id;
    }

    decision.status = targetStatus;
    decision.decidedBy = req.user._id;
    decision.decidedAt = new Date();

    await decision.save();

    await decision.populate([
      { path: 'project', select: 'name color status' },
      { path: 'proposedBy', select: 'name email avatar' },
      { path: 'decidedBy', select: 'name email avatar' },
      { path: 'supersededBy', select: 'title status' },
    ]);

    req.io?.emit('decision:transitioned', decision);

    try {
      const changes = [{ field: 'status', from: currentStatus, to: targetStatus }];
      if (targetStatus === 'superseded' && decision.supersededBy) {
        const supId = decision.supersededBy._id ? decision.supersededBy._id.toString() : decision.supersededBy.toString();
        changes.push({ field: 'supersededBy', from: null, to: supId });
      }

      await recordExecutionEvent({
        model: DecisionRecord,
        aggregate: decision,
        eventInput: {
          eventType: `decision.${targetStatus}`,
          project: decision.project?._id || decision.project,
          actor: req.user._id,
          actorSnapshot: { name: req.user.name, role: req.user.role },
          subjectType: 'decision',
          subjectId: decision._id,
          subjectTitleSnapshot: decision.title,
          decision: decision._id,
          changes,
        },
      });
    } catch (evErr) {
      if (mongoose.connection.readyState !== 0 || evErr.isLedgerFailure) throw evErr;
    }

    res.json({ success: true, decision });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Get deterministic delivery impact for a decision
// @route GET /api/decisions/:id/impact
const getDecisionImpact = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid decision ID format' });
    }

    const decision = await DecisionRecord.findById(req.params.id);
    if (!decision) {
      return res.status(404).json({ success: false, message: 'Decision record not found' });
    }

    const projectDoc = await Project.findById(decision.project);
    if (!projectDoc) {
      return res.status(404).json({ success: false, message: 'Associated project not found' });
    }

    if (!canReadProject(req.user, projectDoc)) {
      return res.status(403).json({ success: false, message: 'Not authorized to view impact for this decision' });
    }

    // Bounded batch queries: exactly 3 queries for task, milestone, and release data
    const [tasks, milestones, releases] = await Promise.all([
      Task.find({ project: decision.project }).select(
        '_id title status priority estimateDays blockerEta isBlocked milestone dependsOn assignedTo createdBy project'
      ),
      Milestone.find({ project: decision.project }).select('_id title status sequence dueDate release project'),
      Release.find({ project: decision.project }).select('_id name version status targetDate project'),
    ]);

    const impact = computeDecisionImpact(decision, projectDoc, tasks, milestones, releases, req.user);

    res.json({
      success: true,
      decision: {
        id: decision._id,
        title: decision.title,
        status: decision.status,
      },
      ...impact,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDecisions,
  getDecision,
  createDecision,
  updateDecision,
  transitionDecision,
  getDecisionImpact,
  canReadProject,
  canManageProject,
  escapeRegex,
};
