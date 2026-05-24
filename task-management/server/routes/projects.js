const express = require('express');
const Project = require('../models/Project');
const { protect, requireRole } = require('../middleware/auth');

const router = express.Router();

// @GET /api/projects
router.get('/', protect, async (req, res) => {
  try {
    const query =
      req.user.role === 'admin'
        ? {}
        : {
            $or: [{ owner: req.user._id }, { 'members.user': req.user._id }],
          };
    const projects = await Project.find(query)
      .populate('owner', 'name email avatar')
      .populate('members.user', 'name email avatar')
      .sort({ createdAt: -1 });
    res.json(projects);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @POST /api/projects
router.post('/', protect, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const project = await Project.create({ ...req.body, owner: req.user._id });
    await project.populate('owner', 'name email avatar');
    req.io.emit('project_created', project);
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @GET /api/projects/:id
router.get('/:id', protect, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('owner', 'name email avatar')
      .populate('members.user', 'name email avatar');
    if (!project) return res.status(404).json({ message: 'Project not found' });
    res.json(project);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @PUT /api/projects/:id
router.put('/:id', protect, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const isOwner = project.owner.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Access denied' });

    const updated = await Project.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('owner', 'name email avatar')
      .populate('members.user', 'name email avatar');

    req.io.to(`project_${req.params.id}`).emit('project_updated', updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @POST /api/projects/:id/members
router.post('/:id/members', protect, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const isOwner = project.owner.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') return res.status(403).json({ message: 'Access denied' });

    const { userId, role } = req.body;
    const alreadyMember = project.members.find((m) => m.user.toString() === userId);
    if (!alreadyMember) project.members.push({ user: userId, role: role || 'member' });

    await project.save();
    await project.populate('members.user', 'name email avatar');
    req.io.to(`project_${req.params.id}`).emit('project_updated', project);
    res.json(project);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @DELETE /api/projects/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const isOwner = project.owner.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') return res.status(403).json({ message: 'Access denied' });

    await project.deleteOne();
    req.io.emit('project_deleted', req.params.id);
    res.json({ message: 'Project deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
