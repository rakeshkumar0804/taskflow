const express = require('express');
const router = express.Router();
const {
  getProjects, createProject, updateProject, deleteProject, addMember,
} = require('../controllers/projectController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.get('/', getProjects);
router.post('/', authorize('admin', 'manager'), createProject);
router.put('/:id', authorize('admin', 'manager'), updateProject);
router.delete('/:id', authorize('admin', 'manager'), deleteProject);
router.post('/:id/members', authorize('admin', 'manager'), addMember);

module.exports = router;
