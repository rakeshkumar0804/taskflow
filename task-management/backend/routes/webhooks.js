const express = require('express');
const router = express.Router();
const { githubWebhook } = require('../controllers/taskController');
const { withLedgerTransaction } = require('../middleware/ledgerTransaction');

// Signature verification is performed before any mutation. This route is
// intentionally not behind JWT auth because GitHub is the caller.
router.post('/github', withLedgerTransaction(githubWebhook));

module.exports = router;
