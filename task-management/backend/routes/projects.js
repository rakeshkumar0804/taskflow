const express = require('express');
const router = express.Router();
const {
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  addMember,
  removeMember,
  getProjectDependencyGraph,
  getProjectDeliveryIntelligence,
} = require('../controllers/projectController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

const { getProjectActivity } = require('../controllers/activityController');

router.get('/', getProjects);
router.get('/:projectId/dependency-graph', getProjectDependencyGraph);
router.get('/:projectId/delivery-intelligence', getProjectDeliveryIntelligence);
router.get('/:projectId/activity', getProjectActivity);
router.get('/:id', getProject);
router.post('/', authorize('admin', 'manager'), createProject);
router.put('/:id', authorize('admin', 'manager'), updateProject);
router.delete('/:id', authorize('admin', 'manager'), deleteProject);
router.post('/:id/members', authorize('admin', 'manager'), addMember);
router.delete('/:id/members/:userId', authorize('admin', 'manager'), removeMember);

module.exports = router;
