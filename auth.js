const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Verifie le token JWT envoye dans le header Authorization: Bearer <token>
 * Attache req.user = { id, username, role }
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.id, username: payload.username, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expire.' });
  }
}

/**
 * Restreint l'acces a une liste de roles autorises.
 * Usage: requireRole('admin', 'staff')
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentification requise.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Acces refuse. Role requis: ${allowedRoles.join(' ou ')}.`,
      });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
