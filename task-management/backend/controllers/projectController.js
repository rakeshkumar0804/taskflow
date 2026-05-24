const Project = require('../models/Project');
const Task = require('../models/Task');

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

// @desc  Create project
// @route POST /api/projects
const createProject = async (req, res) => {
  try {
    const project = await Project.create({
      ...req.body,
      owner: req.user._id,
      members: [{ user: req.user._id, role: 'owner' }],
    });
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

    const updated = await Project.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).populate('members.user', 'name email avatar');

    res.json({ success: true, project: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Delete project
// @route DELETE /api/projects/:id
const deleteProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    if (project.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    // Remove all tasks linked to this project
    await Task.deleteMany({ project: req.params.id });
    await project.deleteOne();

    res.json({ success: true, message: 'Project and related tasks deleted' });
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

    const { userId, role } = req.body;
    const already = project.members.find((m) => m.user.toString() === userId);
    if (already) return res.status(400).json({ success: false, message: 'User already a member' });

    project.members.push({ user: userId, role: role || 'member' });
    await project.save();
    await project.populate('members.user', 'name email avatar');

    res.json({ success: true, members: project.members });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getProjects, createProject, updateProject, deleteProject, addMember };
