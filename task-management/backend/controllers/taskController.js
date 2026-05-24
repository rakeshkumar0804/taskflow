const Task = require('../models/Task');

// @desc  Get all tasks (filtered)
// @route GET /api/tasks
const getTasks = async (req, res) => {
  try {
    const { status, priority, assignedTo, project, search } = req.query;
    const filter = {};

    // Members only see their own tasks; admins/managers see all
    if (req.user.role === 'member') {
      filter.$or = [{ assignedTo: req.user._id }, { createdBy: req.user._id }];
    }

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (project) filter.project = project;
    if (search) filter.title = { $regex: search, $options: 'i' };

    const tasks = await Task.find(filter)
      .populate('assignedTo', 'name email avatar')
      .populate('createdBy', 'name email')
      .populate('project', 'name color')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: tasks.length, tasks });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Get single task
// @route GET /api/tasks/:id
const getTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('assignedTo', 'name email avatar')
      .populate('createdBy', 'name email')
      .populate('project', 'name color')
      .populate('comments.user', 'name avatar');

    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    res.json({ success: true, task });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Create task
// @route POST /api/tasks
const createTask = async (req, res) => {
  try {
    const task = await Task.create({ ...req.body, createdBy: req.user._id });
    const populated = await task.populate([
      { path: 'assignedTo', select: 'name email avatar' },
      { path: 'createdBy', select: 'name email' },
      { path: 'project', select: 'name color' },
    ]);

    // Emit real-time event
    req.io?.emit('task:created', populated);

    res.status(201).json({ success: true, task: populated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc  Update task
// @route PUT /api/tasks/:id
const updateTask = async (req, res) => {
  try {
    let task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    // Members can only update tasks assigned to them
    if (
      req.user.role === 'member' &&
      task.assignedTo?.toString() !== req.user._id.toString() &&
      task.createdBy.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this task' });
    }

    task = await Task.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    })
      .populate('assignedTo', 'name email avatar')
      .populate('createdBy', 'name email')
      .populate('project', 'name color');

    req.io?.emit('task:updated', task);

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
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    if (req.user.role === 'member') {
      return res.status(403).json({ success: false, message: 'Members cannot delete tasks' });
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
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    task.comments.push({ user: req.user._id, text: req.body.text });
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

module.exports = { getTasks, getTask, createTask, updateTask, deleteTask, addComment, getStats };
