const express = require('express');
const router = express.Router();
const {
  getTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  addComment,
  getStats,
  getFlowHealth,
  getTaskDependencies,
  addTaskDependency,
  removeTaskDependency,
  linkGitHubEvidence,
} = require('../controllers/taskController');
const { protect, authorize } = require('../middleware/auth');
const { withLedgerTransaction } = require('../middleware/ledgerTransaction');

router.use(protect); // All task routes require auth

router.get('/health', getFlowHealth);
router.get('/stats', getStats);
router.get('/', getTasks);
router.post('/', withLedgerTransaction(createTask));
router.get('/:id', getTask);
router.put('/:id', withLedgerTransaction(updateTask));
router.put('/:id/github', withLedgerTransaction(linkGitHubEvidence));
router.delete('/:id', authorize('admin', 'manager'), withLedgerTransaction(deleteTask));
router.post('/:id/comments', withLedgerTransaction(addComment));

// Task dependency routes
router.get('/:id/dependencies', getTaskDependencies);
router.post('/:id/dependencies', withLedgerTransaction(addTaskDependency));
router.delete('/:id/dependencies/:dependencyTaskId', withLedgerTransaction(removeTaskDependency));

module.exports = router;
