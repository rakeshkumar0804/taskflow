const express = require('express');
const router = express.Router();
const {
  getActivityFeed,
  getEventById,
  getLedgerCoverage,
} = require('../controllers/activityController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', getActivityFeed);
router.get('/coverage', getLedgerCoverage);
router.get('/:eventId', getEventById);

module.exports = router;
