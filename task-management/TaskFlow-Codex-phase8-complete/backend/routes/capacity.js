const express = require('express');
const router = express.Router();
const {
  getProjectCapacities,
  upsertProjectCapacity,
  deleteProjectCapacity,
  getProjectCapacityIntelligence,
} = require('../controllers/capacityController');
const { protect } = require('../middleware/auth');
const { withLedgerTransaction } = require('../middleware/ledgerTransaction');

router.use(protect);

router.get('/:projectId/capacity-intelligence', getProjectCapacityIntelligence);
// Deprecated compatibility alias for /:projectId/capacity-intelligence
router.get('/:projectId/capacity/intelligence', (req, res, next) => {
  res.set('X-Deprecated-Route', 'Use /api/projects/:projectId/capacity-intelligence');
  return getProjectCapacityIntelligence(req, res, next);
});
router.get('/:projectId/capacity', getProjectCapacities);
router.put('/:projectId/capacity/:userId', withLedgerTransaction(upsertProjectCapacity));
router.delete('/:projectId/capacity/:userId', withLedgerTransaction(deleteProjectCapacity));

module.exports = router;
