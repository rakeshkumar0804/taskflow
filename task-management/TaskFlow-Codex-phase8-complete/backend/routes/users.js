const express = require('express');
const router = express.Router();
const { getUsers, updateRole, toggleActive } = require('../controllers/userController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('admin'));

router.get('/', getUsers);
router.put('/:id/role', updateRole);
router.put('/:id/toggle-active', toggleActive);

module.exports = router;
