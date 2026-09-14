const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getDecisions,
  getDecision,
  createDecision,
  updateDecision,
  transitionDecision,
  getDecisionImpact,
} = require('../controllers/decisionController');

// All decision routes require authenticated session
router.use(protect);

router.route('/')
  .get(getDecisions)
  .post(createDecision);

router.route('/:id')
  .get(getDecision)
  .put(updateDecision);

router.post('/:id/transition', transitionDecision);
router.get('/:id/impact', getDecisionImpact);

module.exports = router;
