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
const { withLedgerTransaction } = require('../middleware/ledgerTransaction');

router.use(protect);

const { getProjectActivity } = require('../controllers/activityController');

router.get('/', getProjects);
router.get('/:projectId/dependency-graph', getProjectDependencyGraph);
router.get('/:projectId/delivery-intelligence', getProjectDeliveryIntelligence);
router.get('/:projectId/activity', getProjectActivity);
router.get('/:id', getProject);
router.post('/', authorize('admin', 'manager'), withLedgerTransaction(createProject));
router.put('/:id', authorize('admin', 'manager'), withLedgerTransaction(updateProject));
router.delete('/:id', authorize('admin', 'manager'), withLedgerTransaction(deleteProject));
router.post('/:id/members', authorize('admin', 'manager'), withLedgerTransaction(addMember));
router.delete('/:id/members/:userId', authorize('admin', 'manager'), withLedgerTransaction(removeMember));

module.exports = router;
