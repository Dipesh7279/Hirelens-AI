const express = require('express');
const router = express.Router();

const {
  register,
  login,
  refresh,
  logout,
  me,
  changePassword,
  deleteAccount,
} = require('../controllers/authController');
const { requireAuth } = require('../middleware/authMiddleware');
const { registerLimiter, loginLimiter, refreshLimiter } = require('../middleware/rateLimiter');

router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
router.post('/refresh', refreshLimiter, refresh);
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, me);
router.post('/change-password', requireAuth, changePassword);
router.delete('/account', requireAuth, deleteAccount);

module.exports = router;
