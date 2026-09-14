const express = require('express');
const Task = require('../models/Task');
const Project = require('../models/Project');
const { protect } = require('../middleware/auth');

const router = express.Router();

const canAccessProject = async (userId, userRole, projectId) => {
  if (userRole === 'admin') return true;
  const project = await Project.findById(projectId);
  if (!project) return false;
  const isOwner = project.owner.toString() === userId.toString();
  const isMember = project.members.some((m) => m.user.toString() === userId.toString());
  return isOwner || isMember;
};

// @GET /api/tasks?project=:projectId&status=&priority=&assignedTo=
router.get('/', protect, async (req, res) => {
  try {
    const { project, status, priority, assignedTo } = req.query;
    const filter = {};
    if (project) filter.project = project;
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (assignedTo) filter.assignedTo = assignedTo;

    if (req.user.role !== 'admin') {
      const projects = await Project.find({
        $or: [{ owner: req.user._id }, { 'members.user': req.user._id }],
      }).select('_id');
      filter.project = filter.project || { $in: projects.map((p) => p._id) };
    }

    const tasks = await Task.find(filter)
      .populate('assignedTo', 'name email avatar')
      .populate('createdBy', 'name email avatar')
      .populate('project', 'name color')
      .sort({ order: 1, createdAt: -1 });

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @POST /api/tasks
router.post('/', protect, async (req, res) => {
  try {
    const access = await canAccessProject(req.user._id, req.user.role, req.body.project);
    if (!access) return res.status(403).json({ message: 'Access denied' });

    const task = await Task.create({ ...req.body, createdBy: req.user._id });
    await task.populate('assignedTo', 'name email avatar');
    await task.populate('createdBy', 'name email avatar');
    await task.populate('project', 'name color');

    req.io.to(`project_${task.project._id}`).emit('task_created', task);
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @GET /api/tasks/:id
router.get('/:id', protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('assignedTo', 'name email avatar')
      .populate('createdBy', 'name email avatar')
      .populate('project', 'name color')
      .populate('comments.user', 'name avatar');
    if (!task) return res.status(404).json({ message: 'Task not found' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @PUT /api/tasks/:id
router.put('/:id', protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    const access = await canAccessProject(req.user._id, req.user.role, task.project);
    if (!access) return res.status(403).json({ message: 'Access denied' });

    const updated = await Task.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('assignedTo', 'name email avatar')
      .populate('createdBy', 'name email avatar')
      .populate('project', 'name color');

    req.io.to(`project_${updated.project._id}`).emit('task_updated', updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @POST /api/tasks/:id/comments
router.post('/:id/comments', protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    task.comments.push({ user: req.user._id, text: req.body.text });
    await task.save();
    await task.populate('comments.user', 'name avatar');
    await task.populate('project', 'name color');

    req.io.to(`project_${task.project._id}`).emit('task_updated', task);
    res.json(task);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @DELETE /api/tasks/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    const access = await canAccessProject(req.user._id, req.user.role, task.project);
    if (!access) return res.status(403).json({ message: 'Access denied' });

    const projectId = task.project;
    await task.deleteOne();
    req.io.to(`project_${projectId}`).emit('task_deleted', req.params.id);
    res.json({ message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
