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

router.use(protect);

router.get('/', getReleases);
router.get('/:releaseId/delivery-intelligence', getReleaseDeliveryIntelligence);
router.get('/:id', getRelease);
router.post('/', authorize('admin', 'manager'), createRelease);
router.put('/:id', authorize('admin', 'manager'), updateRelease);
router.delete('/:id', authorize('admin', 'manager'), deleteRelease);

module.exports = router;
