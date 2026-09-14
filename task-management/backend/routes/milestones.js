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

router.use(protect);

router.get('/', getMilestones);
router.get('/:id', getMilestone);
router.post('/', authorize('admin', 'manager'), createMilestone);
router.put('/:id', authorize('admin', 'manager'), updateMilestone);
router.delete('/:id', authorize('admin', 'manager'), deleteMilestone);

module.exports = router;
