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

if (!JWT_SECRET) {
  console.error('[fatal] JWT_SECRET manquant');
  process.exit(1);
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

//
// 🔥 LOGIN
//
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: 'Username et password requis.' });
    }

    const result = await db.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);

    if (!passwordOk) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    const token = signToken(user);

    await logAction(
      { id: user.id, username: user.username },
      'login',
      'auth',
      user.id,
      user.username
    );

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur login' });
  }
});

//
// 🔥 ME
//
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

//
// 🔥 LIST USERS (ADMIN)
//
router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  const result = await db.query(
    'SELECT id, username, role, created_at FROM users ORDER BY created_at ASC'
  );

  res.json(result.rows);
});

//
// 🔥 CREATE USER (ADMIN)
//
router.post('/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { username, password, role } = req.body || {};

  const validRoles = ['admin', 'staff', 'viewer'];

  if (!username || !password) {
    return res.status(400).json({ error: 'Username et password requis.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Mot de passe trop court.' });
  }

  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: 'Role invalide.' });
  }

  const existing = await db.query(
    'SELECT id FROM users WHERE username = $1',
    [username]
  );

  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'Utilisateur existe déjà.' });
  }

  const id = uuid();
  const hash = await bcrypt.hash(password, 10);
  const finalRole = role || 'viewer';

  await db.query(
    `INSERT INTO users (id, username, password_hash, role)
     VALUES ($1, $2, $3, $4)`,
    [id, username, hash, finalRole]
  );

  await logAction(req.user, 'create', 'user', id, username, { role: finalRole });

  res.status(201).json({ id, username, role: finalRole });
});

//
// 🔥 UPDATE USER
//
router.put('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { role, password } = req.body || {};

  const validRoles = ['admin', 'staff', 'viewer'];

  const userRes = await db.query(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );

  const user = userRes.rows[0];

  if (!user) {
    return res.status(404).json({ error: 'Utilisateur introuvable.' });
  }

  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: 'Role invalide.' });
  }

  if (role) {
    await db.query(
      'UPDATE users SET role = $1 WHERE id = $2',
      [role, id]
    );
  }

  if (password) {
    if (password.length < 6) {
      return res.status(400).json({ error: 'Mot de passe trop court.' });
    }

    const hash = await bcrypt.hash(password, 10);

    await db.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hash, id]
    );
  }

  await logAction(req.user, 'update', 'user', id, user.username, { role });

  res.json({ message: 'Utilisateur mis à jour.' });
});

//
// 🔥 DELETE USER
//
router.delete('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;

  if (id === req.user.id) {
    return res.status(400).json({ error: 'Impossible de supprimer votre compte.' });
  }

  const userRes = await db.query(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );

  const user = userRes.rows[0];

  if (!user) {
    return res.status(404).json({ error: 'Utilisateur introuvable.' });
  }

  await db.query(
    'DELETE FROM users WHERE id = $1',
    [id]
  );

  await logAction(req.user, 'delete', 'user', id, user.username);

  res.json({ message: 'Utilisateur supprimé.' });
});

module.exports = router;
