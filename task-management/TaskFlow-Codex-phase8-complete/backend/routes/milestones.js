const express = require('express');
const router = express.Router();
const {
  getMilestones,
  getMilestone,
  createMilestone,
  updateMilestone,
  deleteMilestone,
} = require('../controllers/milestoneController');
const { protect, authorize } = require('../middleware/auth');
const { withLedgerTransaction } = require('../middleware/ledgerTransaction');

router.use(protect);

router.get('/', getMilestones);
router.get('/:id', getMilestone);
router.post('/', authorize('admin', 'manager'), withLedgerTransaction(createMilestone));
router.put('/:id', authorize('admin', 'manager'), withLedgerTransaction(updateMilestone));
router.delete('/:id', authorize('admin', 'manager'), withLedgerTransaction(deleteMilestone));

module.exports = router;
