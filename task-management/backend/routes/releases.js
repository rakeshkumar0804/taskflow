const express = require('express');
const router = express.Router();
const {
  getReleases,
  getRelease,
  createRelease,
  updateRelease,
  deleteRelease,
  getReleaseDeliveryIntelligence,
} = require('../controllers/releaseController');
const { protect, authorize } = require('../middleware/auth');
const { withLedgerTransaction } = require('../middleware/ledgerTransaction');

router.use(protect);

router.get('/', getReleases);
router.get('/:releaseId/delivery-intelligence', getReleaseDeliveryIntelligence);
router.get('/:id', getRelease);
router.post('/', authorize('admin', 'manager'), withLedgerTransaction(createRelease));
router.put('/:id', authorize('admin', 'manager'), withLedgerTransaction(updateRelease));
router.delete('/:id', authorize('admin', 'manager'), withLedgerTransaction(deleteRelease));

module.exports = router;
