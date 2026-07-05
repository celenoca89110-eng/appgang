const express = require('express');
const { v4: uuid } = require('uuid');

const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../db/auditLog');

const router = express.Router();

// ---------- HELPERS ----------

async function getFullGang(gangId) {
  const gangRes = await db.query('SELECT * FROM gangs WHERE id = $1', [gangId]);
  const gang = gangRes.rows[0];
  if (!gang) return null;

  const categoriesRes = await db.query(
    'SELECT * FROM categories WHERE gang_id = $1 ORDER BY created_at ASC',
    [gangId]
  );

  const categories = categoriesRes.rows;

  gang.categories = await Promise.all(
    categories.map(async (cat) => {
      const itemsRes = await db.query(
        'SELECT * FROM items WHERE category_id = $1 ORDER BY created_at ASC',
        [cat.id]
      );

      return {
        ...cat,
        items: itemsRes.rows
      };
    })
  );

  return gang;
}

async function getAllGangsFull() {
  const gangsRes = await db.query('SELECT * FROM gangs ORDER BY created_at ASC');
  const gangs = gangsRes.rows;

  return Promise.all(gangs.map((g) => getFullGang(g.id)));
}

async function touchGang(gangId) {
  await db.query(
    "UPDATE gangs SET updated_at = NOW() WHERE id = $1",
    [gangId]
  );
}

function emitUpdate(req, event, payload) {
  const io = req.app.get('io');
  if (io) io.emit(event, payload);
}

// ================= GANGS =================

router.get('/', requireAuth, async (req, res) => {
  res.json(await getAllGangsFull());
});

router.get('/:id', requireAuth, async (req, res) => {
  const gang = await getFullGang(req.params.id);
  if (!gang) return res.status(404).json({ error: 'Gang introuvable.' });
  res.json(gang);
});

router.post('/', requireAuth, requireRole('admin', 'staff'), async (req, res) => {
  const { name, color } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Le nom du gang est requis.' });
  }

  const existing = await db.query(
    'SELECT id FROM gangs WHERE name = $1',
    [name.trim()]
  );

  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'Un gang existe deja.' });
  }

  const id = uuid();

  await db.query(
    'INSERT INTO gangs (id, name, color, created_by) VALUES ($1,$2,$3,$4)',
    [id, name.trim(), color || '#D9A63E', req.user.id]
  );

  logAction(req.user, 'create', 'gang', id, name.trim());

  const gang = await getFullGang(id);
  emitUpdate(req, 'gang:created', gang);

  res.status(201).json(gang);
});

router.put('/:id', requireAuth, requireRole('admin', 'staff'), async (req, res) => {
  const { id } = req.params;
  const { name, color } = req.body || {};

  const gangRes = await db.query('SELECT * FROM gangs WHERE id = $1', [id]);
  const gang = gangRes.rows[0];

  if (!gang) return res.status(404).json({ error: 'Gang introuvable.' });

  if (name?.trim()) {
    await db.query('UPDATE gangs SET name = $1 WHERE id = $2', [name.trim(), id]);
  }

  if (color) {
    await db.query('UPDATE gangs SET color = $1 WHERE id = $2', [color, id]);
  }

  await touchGang(id);

  logAction(req.user, 'update', 'gang', id, name || gang.name);

  const updated = await getFullGang(id);
  emitUpdate(req, 'gang:updated', updated);

  res.json(updated);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;

  const gangRes = await db.query('SELECT * FROM gangs WHERE id = $1', [id]);
  const gang = gangRes.rows[0];

  if (!gang) return res.status(404).json({ error: 'Gang introuvable.' });

  await db.query('DELETE FROM gangs WHERE id = $1', [id]);

  logAction(req.user, 'delete', 'gang', id, gang.name);

  emitUpdate(req, 'gang:deleted', { id });

  res.json({ message: 'Gang supprime.' });
});

// ================= CATEGORIES =================

// CREATE CATEGORY
router.post('/:gangId/categories', requireAuth, requireRole('admin', 'staff'), async (req, res) => {
  const { gangId } = req.params;
  const { name } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Le nom de la categorie est requis.' });
  }

  const gangRes = await db.query('SELECT * FROM gangs WHERE id = $1', [gangId]);
  const gang = gangRes.rows[0];
  if (!gang) return res.status(404).json({ error: 'Gang introuvable.' });

  const dupe = await db.query(
    'SELECT id FROM categories WHERE gang_id = $1 AND name = $2',
    [gangId, name.trim()]
  );

  if (dupe.rows.length > 0) {
    return res.status(409).json({ error: 'Cette categorie existe deja.' });
  }

  const id = uuid();

  await db.query(
    'INSERT INTO categories (id, gang_id, name) VALUES ($1, $2, $3)',
    [id, gangId, name.trim()]
  );

  await touchGang(gangId);

  const updated = await getFullGang(gangId);
  emitUpdate(req, 'gang:updated', updated);

  res.status(201).json(updated);
});


// UPDATE CATEGORY
router.put('/:gangId/categories/:catId', requireAuth, requireRole('admin', 'staff'), async (req, res) => {
  const { gangId, catId } = req.params;
  const { name } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Le nom de la categorie est requis.' });
  }

  const catRes = await db.query(
    'SELECT * FROM categories WHERE id = $1 AND gang_id = $2',
    [catId, gangId]
  );

  const cat = catRes.rows[0];
  if (!cat) return res.status(404).json({ error: 'Categorie introuvable.' });

  await db.query(
    'UPDATE categories SET name = $1 WHERE id = $2',
    [name.trim(), catId]
  );

  await touchGang(gangId);

  const updated = await getFullGang(gangId);
  emitUpdate(req, 'gang:updated', updated);

  res.json(updated);
});


// DELETE CATEGORY (FIX 404)
router.delete('/:gangId/categories/:catId', requireAuth, requireRole('admin', 'staff'), async (req, res) => {
  const { gangId, catId } = req.params;

  const catRes = await db.query(
    'SELECT * FROM categories WHERE id = $1 AND gang_id = $2',
    [catId, gangId]
  );

  const category = catRes.rows[0];
  if (!category) {
    return res.status(404).json({ error: 'Categorie introuvable.' });
  }

  // supprimer items liés (sécurité propre)
  await db.query('DELETE FROM items WHERE category_id = $1', [catId]);

  // supprimer catégorie
  await db.query('DELETE FROM categories WHERE id = $1', [catId]);

  await touchGang(gangId);

  const updated = await getFullGang(gangId);
  emitUpdate(req, 'gang:updated', updated);

  res.json({ message: 'Categorie supprimee.' });
});

// ================= ITEMS =================

router.post('/:gangId/categories/:catId/items', requireAuth, requireRole('admin', 'staff'), async (req, res) => {
  const { catId, gangId } = req.params;
  const { name, price, description } = req.body || {};

  const id = uuid();

  await db.query(
    'INSERT INTO items (id, category_id, name, price, description) VALUES ($1,$2,$3,$4,$5)',
    [id, catId, name.trim(), Number(price), description || '']
  );

  await touchGang(gangId);

  const updated = await getFullGang(gangId);
  emitUpdate(req, 'gang:updated', updated);

  res.status(201).json(updated);
});

module.exports = { router, getAllGangsFull, getFullGang };
