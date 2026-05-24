const express = require('express');
const User = require('../models/User');
const { protect, requireRole } = require('../middleware/auth');

const router = express.Router();

// @GET /api/users — Admin only
router.get('/', protect, requireRole('admin'), async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @GET /api/users/search?q=name
router.get('/search', protect, async (req, res) => {
  try {
    const { q } = req.query;
    const users = await User.find({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
      ],
    }).select('name email role avatar');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @PUT /api/users/:id — Admin or self
router.put('/:id', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user._id.toString() !== req.params.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    const { name, avatar } = req.body;
    const updates = { name, avatar };
    if (req.user.role === 'admin') updates.role = req.body.role;

    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @DELETE /api/users/:id — Admin only
router.delete('/:id', protect, requireRole('admin'), async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'User deactivated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
