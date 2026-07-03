const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../db/auditLog');

const router = express.Router();

// ---------- HELPERS ----------

function getFullGang(gangId) {
  const gang = db.prepare('SELECT * FROM gangs WHERE id = ?').get(gangId);
  if (!gang) return null;

  const categories = db
    .prepare('SELECT * FROM categories WHERE gang_id = ? ORDER BY created_at ASC')
    .all(gangId);

  gang.categories = categories.map((cat) => {
    const items = db
      .prepare('SELECT * FROM items WHERE category_id = ? ORDER BY created_at ASC')
      .all(cat.id);
    return { ...cat, items };
  });

  return gang;
}

function getAllGangsFull() {
  const gangs = db.prepare('SELECT * FROM gangs ORDER BY created_at ASC').all();
  return gangs.map((g) => getFullGang(g.id));
}

function touchGang(gangId) {
  db.prepare("UPDATE gangs SET updated_at = datetime('now') WHERE id = ?").run(gangId);
}

function emitUpdate(req, event, payload) {
  const io = req.app.get('io');
  if (io) io.emit(event, payload);
}

// ================= GANGS =================

// GET /api/gangs - liste complete (gangs + categories + items imbriques)
router.get('/', requireAuth, (req, res) => {
  res.json(getAllGangsFull());
});

// GET /api/gangs/:id
router.get('/:id', requireAuth, (req, res) => {
  const gang = getFullGang(req.params.id);
  if (!gang) return res.status(404).json({ error: 'Gang introuvable.' });
  res.json(gang);
});

// POST /api/gangs - creer un gang (admin + staff)
router.post('/', requireAuth, requireRole('admin', 'staff'), (req, res) => {
  const { name, color } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Le nom du gang est requis.' });
  }

  const existing = db.prepare('SELECT id FROM gangs WHERE name = ?').get(name.trim());
  if (existing) {
    return res.status(409).json({ error: 'Un gang avec ce nom existe deja.' });
  }

  const id = uuid();
  db.prepare('INSERT INTO gangs (id, name, color, created_by) VALUES (?, ?, ?, ?)').run(
    id,
    name.trim(),
    color || '#D9A63E',
    req.user.id
  );

  logAction(req.user, 'create', 'gang', id, name.trim());
  const gang = getFullGang(id);
  emitUpdate(req, 'gang:created', gang);
  res.status(201).json(gang);
});

// PUT /api/gangs/:id - renommer / changer couleur (admin + staff)
router.put('/:id', requireAuth, requireRole('admin', 'staff'), (req, res) => {
  const { id } = req.params;
  const { name, color } = req.body || {};

  const gang = db.prepare('SELECT * FROM gangs WHERE id = ?').get(id);
  if (!gang) return res.status(404).json({ error: 'Gang introuvable.' });

  if (name && name.trim()) {
    const dupe = db.prepare('SELECT id FROM gangs WHERE name = ? AND id != ?').get(name.trim(), id);
    if (dupe) return res.status(409).json({ error: 'Un autre gang porte deja ce nom.' });
    db.prepare('UPDATE gangs SET name = ? WHERE id = ?').run(name.trim(), id);
  }
  if (color) {
    db.prepare('UPDATE gangs SET color = ? WHERE id = ?').run(color, id);
  }
  touchGang(id);

  logAction(req.user, 'update', 'gang', id, name || gang.name, { name, color });
  const updated = getFullGang(id);
  emitUpdate(req, 'gang:updated', updated);
  res.json(updated);
});

// DELETE /api/gangs/:id (admin uniquement)
router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const gang = db.prepare('SELECT * FROM gangs WHERE id = ?').get(id);
  if (!gang) return res.status(404).json({ error: 'Gang introuvable.' });

  db.prepare('DELETE FROM gangs WHERE id = ?').run(id); // cascade categories + items
  logAction(req.user, 'delete', 'gang', id, gang.name);
  emitUpdate(req, 'gang:deleted', { id });
  res.json({ message: 'Gang supprime.' });
});

// ================= CATEGORIES =================

// POST /api/gangs/:gangId/categories (admin + staff)
router.post('/:gangId/categories', requireAuth, requireRole('admin', 'staff'), (req, res) => {
  const { gangId } = req.params;
  const { name } = req.body || {};

  const gang = db.prepare('SELECT * FROM gangs WHERE id = ?').get(gangId);
  if (!gang) return res.status(404).json({ error: 'Gang introuvable.' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Le nom de la categorie est requis.' });

  const dupe = db
    .prepare('SELECT id FROM categories WHERE gang_id = ? AND name = ?')
    .get(gangId, name.trim());
  if (dupe) return res.status(409).json({ error: 'Cette categorie existe deja pour ce gang.' });

  const id = uuid();
  db.prepare('INSERT INTO categories (id, gang_id, name) VALUES (?, ?, ?)').run(id, gangId, name.trim());
  touchGang(gangId);

  logAction(req.user, 'create', 'category', id, `${gang.name} / ${name.trim()}`);
  const updated = getFullGang(gangId);
  emitUpdate(req, 'gang:updated', updated);
  res.status(201).json(updated);
});

// PUT /api/gangs/:gangId/categories/:catId (admin + staff)
router.put('/:gangId/categories/:catId', requireAuth, requireRole('admin', 'staff'), (req, res) => {
  const { gangId, catId } = req.params;
  const { name } = req.body || {};

  const cat = db.prepare('SELECT * FROM categories WHERE id = ? AND gang_id = ?').get(catId, gangId);
  if (!cat) return res.status(404).json({ error: 'Categorie introuvable.' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Le nom de la categorie est requis.' });

  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name.trim(), catId);
  touchGang(gangId);

  logAction(req.user, 'update', 'category', catId, name.trim());
  const updated = getFullGang(gangId);
  emitUpdate(req, 'gang:updated', updated);
  res.json(updated);
});

// DELETE /api/gangs/:gangId/categories/:catId (admin + staff)
router.delete('/:gangId/categories/:catId', requireAuth, requireRole('admin', 'staff'), (req, res) => {
  const { gangId, catId } = req.params;
  const cat = db.prepare('SELECT * FROM categories WHERE id = ? AND gang_id = ?').get(catId, gangId);
  if (!cat) return res.status(404).json({ error: 'Categorie introuvable.' });

  db.prepare('DELETE FROM categories WHERE id = ?').run(catId); // cascade items
  touchGang(gangId);

  logAction(req.user, 'delete', 'category', catId, cat.name);
  const updated = getFullGang(gangId);
  emitUpdate(req, 'gang:updated', updated);
  res.json(updated);
});

// ================= ITEMS =================

// POST /api/gangs/:gangId/categories/:catId/items (admin + staff)
router.post(
  '/:gangId/categories/:catId/items',
  requireAuth,
  requireRole('admin', 'staff'),
  (req, res) => {
    const { gangId, catId } = req.params;
    const { name, price, description } = req.body || {};

    const cat = db.prepare('SELECT * FROM categories WHERE id = ? AND gang_id = ?').get(catId, gangId);
    if (!cat) return res.status(404).json({ error: 'Categorie introuvable.' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'Le nom de l\'item est requis.' });
    if (price === undefined || isNaN(Number(price)) || Number(price) < 0) {
      return res.status(400).json({ error: 'Le prix doit etre un nombre positif.' });
    }

    const id = uuid();
    db.prepare(
      'INSERT INTO items (id, category_id, name, price, description) VALUES (?, ?, ?, ?, ?)'
    ).run(id, catId, name.trim(), Number(price), (description || '').trim());
    touchGang(gangId);

    logAction(req.user, 'create', 'item', id, name.trim(), { price: Number(price) });
    const updated = getFullGang(gangId);
    emitUpdate(req, 'gang:updated', updated);
    res.status(201).json(updated);
  }
);

// PUT /api/gangs/:gangId/categories/:catId/items/:itemId (admin + staff)
router.put(
  '/:gangId/categories/:catId/items/:itemId',
  requireAuth,
  requireRole('admin', 'staff'),
  (req, res) => {
    const { gangId, catId, itemId } = req.params;
    const { name, price, description } = req.body || {};

    const item = db.prepare('SELECT * FROM items WHERE id = ? AND category_id = ?').get(itemId, catId);
    if (!item) return res.status(404).json({ error: 'Item introuvable.' });

    const newName = name && name.trim() ? name.trim() : item.name;
    const newPrice = price !== undefined && !isNaN(Number(price)) ? Number(price) : item.price;
    const newDesc = description !== undefined ? description.trim() : item.description;

    db.prepare(
      "UPDATE items SET name = ?, price = ?, description = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(newName, newPrice, newDesc, itemId);
    touchGang(gangId);

    logAction(req.user, 'update', 'item', itemId, newName, {
      before: { name: item.name, price: item.price },
      after: { name: newName, price: newPrice },
    });
    const updated = getFullGang(gangId);
    emitUpdate(req, 'gang:updated', updated);
    res.json(updated);
  }
);

// DELETE /api/gangs/:gangId/categories/:catId/items/:itemId (admin + staff)
router.delete(
  '/:gangId/categories/:catId/items/:itemId',
  requireAuth,
  requireRole('admin', 'staff'),
  (req, res) => {
    const { gangId, catId, itemId } = req.params;
    const item = db.prepare('SELECT * FROM items WHERE id = ? AND category_id = ?').get(itemId, catId);
    if (!item) return res.status(404).json({ error: 'Item introuvable.' });

    db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
    touchGang(gangId);

    logAction(req.user, 'delete', 'item', itemId, item.name);
    const updated = getFullGang(gangId);
    emitUpdate(req, 'gang:updated', updated);
    res.json(updated);
  }
);

module.exports = { router, getAllGangsFull, getFullGang };
