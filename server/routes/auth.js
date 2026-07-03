const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../db/auditLog');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }

  const token = signToken(user);
  logAction({ id: user.id, username: user.username }, 'login', 'auth', user.id, user.username);

  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role },
  });
});

// GET /api/auth/me - infos sur l'utilisateur connecte
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// GET /api/auth/users - liste des comptes (admin uniquement)
router.get('/users', requireAuth, requireRole('admin'), (req, res) => {
  const users = db
    .prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at ASC')
    .all();
  res.json(users);
});

// POST /api/auth/users - creer un compte (admin uniquement)
router.post('/users', requireAuth, requireRole('admin'), (req, res) => {
  const { username, password, role } = req.body || {};
  const validRoles = ['admin', 'staff', 'viewer'];

  if (!username || !password) {
    return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caracteres.' });
  }
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: `Role invalide. Valeurs possibles: ${validRoles.join(', ')}.` });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'Ce nom d\'utilisateur existe deja.' });
  }

  const id = uuid();
  const hash = bcrypt.hashSync(password, 10);
  const finalRole = role || 'viewer';

  db.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(
    id,
    username,
    hash,
    finalRole
  );

  logAction(req.user, 'create', 'user', id, username, { role: finalRole });

  res.status(201).json({ id, username, role: finalRole });
});

// PUT /api/auth/users/:id - modifier le role ou le mot de passe (admin uniquement)
router.put('/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const { role, password } = req.body || {};
  const validRoles = ['admin', 'staff', 'viewer'];

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: `Role invalide. Valeurs possibles: ${validRoles.join(', ')}.` });
  }

  if (role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }
  if (password) {
    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caracteres.' });
    }
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  }

  logAction(req.user, 'update', 'user', id, user.username, { role });
  res.json({ message: 'Utilisateur mis a jour.' });
});

// DELETE /api/auth/users/:id (admin uniquement)
router.delete('/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  logAction(req.user, 'delete', 'user', id, user.username);

  res.json({ message: 'Utilisateur supprime.' });
});

module.exports = router;
