const jwt = require('jsonwebtoken');

function extractUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const payload = extractUser(req);
  if (!payload) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = payload;
  next();
}

function requireAdmin(req, res, next) {
  const payload = extractUser(req);
  if (!payload) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = payload;
  const role = payload.role || 'coach';
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireCoach(req, res, next) {
  const payload = extractUser(req);
  if (!payload) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = payload;
  const role = payload.role || 'coach';
  if (role !== 'coach' && role !== 'admin') {
    return res.status(403).json({ error: 'Coach or admin access required' });
  }
  next();
}

// Populates req.user if a valid token is present, but never rejects.
function optionalAuth(req, res, next) {
  const payload = extractUser(req);
  if (payload) req.user = payload;
  next();
}

module.exports = { requireAuth, requireAdmin, requireCoach, optionalAuth };
