const express = require('express');
const router = express.Router();
const {
  getTasks, getTask, createTask, updateTask, deleteTask, addComment, getStats,
} = require('../controllers/taskController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect); // All task routes require auth

router.get('/stats', getStats);
router.get('/', getTasks);
router.post('/', createTask);
router.get('/:id', getTask);
router.put('/:id', updateTask);
router.delete('/:id', authorize('admin', 'manager'), deleteTask);
router.post('/:id/comments', addComment);

module.exports = router;
