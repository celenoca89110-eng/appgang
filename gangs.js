const express = require('express');
const { v4: uuid } = require('uuid');
const { query } = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../db/auditLog');

const router = express.Router();

// ---------- HELPERS ----------

async function getFullGang(gangId) {
  const { rows: gangRows } = await query('SELECT * FROM gangs WHERE id = $1', [gangId]);
  const gang = gangRows[0];
  if (!gang) return null;

  const { rows: categories } = await query(
    'SELECT * FROM categories WHERE gang_id = $1 ORDER BY created_at ASC',
    [gangId]
  );

  gang.categories = await Promise.all(
    categories.map(async (cat) => {
      const { rows: items } = await query(
        'SELECT * FROM items WHERE category_id = $1 ORDER BY created_at ASC',
        [cat.id]
      );
      return { ...cat, items };
    })
  );

  return gang;
}

async function getAllGangsFull() {
  const { rows: gangs } = await query('SELECT * FROM gangs ORDER BY created_at ASC');
  return Promise.all(gangs.map((g) => getFullGang(g.id)));
}

async function touchGang(gangId) {
  await query('UPDATE gangs SET updated_at = NOW() WHERE id = $1', [gangId]);
}

function emitUpdate(req, event, payload) {
  const io = req.app.get('io');
  if (io) io.emit(event, payload);
}

function logSafe(...args) {
  logAction(...args).catch((err) => console.error('[audit] échec:', err.message));
}

// ================= GANGS =================

// GET /api/gangs - liste complete (gangs + categories + items imbriques)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json(await getAllGangsFull());
  } catch (err) {
    next(err);
  }
});

// GET /api/gangs/:id
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const gang = await getFullGang(req.params.id);
    if (!gang) return res.status(404).json({ error: 'Gang introuvable.' });
    res.json(gang);
  } catch (err) {
    next(err);
  }
});

// POST /api/gangs - creer un gang (admin + staff)
router.post('/', requireAuth, requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const { name, color } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Le nom du gang est requis.' });
    }

    const existing = await query('SELECT id FROM gangs WHERE name = $1', [name.trim()]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Un gang avec ce nom existe deja.' });
    }

    const id = uuid();
    await query('INSERT INTO gangs (id, name, color, created_by) VALUES ($1, $2, $3, $4)', [
      id,
      name.trim(),
      color || '#D9A63E',
      req.user.id,
    ]);

    logSafe(req.user, 'create', 'gang', id, name.trim());
    const gang = await getFullGang(id);
    emitUpdate(req, 'gang:created', gang);
    res.status(201).json(gang);
  } catch (err) {
    next(err);
  }
});

// PUT /api/gangs/:id - renommer / changer couleur (admin + staff)
router.put('/:id', requireAuth, requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, color } = req.body || {};

    const { rows } = await query('SELECT * FROM gangs WHERE id = $1', [id]);
    const gang = rows[0];
    if (!gang) return res.status(404).json({ error: 'Gang introuvable.' });

    if (name && name.trim()) {
      const dupe = await query('SELECT id FROM gangs WHERE name = $1 AND id != $2', [name.trim(), id]);
      if (dupe.rows.length) return res.status(409).json({ error: 'Un autre gang porte deja ce nom.' });
      await query('UPDATE gangs SET name = $1 WHERE id = $2', [name.trim(), id]);
    }
    if (color) {
      await query('UPDATE gangs SET color = $1 WHERE id = $2', [color, id]);
    }
    await touchGang(id);

    logSafe(req.user, 'update', 'gang', id, name || gang.name, { name, color });
    const updated = await getFullGang(id);
    emitUpdate(req, 'gang:updated', updated);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/gangs/:id (admin uniquement)
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await query('SELECT * FROM gangs WHERE id = $1', [id]);
    const gang = rows[0];
    if (!gang) return res.status(404).json({ error: 'Gang introuvable.' });

    await query('DELETE FROM gangs WHERE id = $1', [id]); // cascade categories + items
    logSafe(req.user, 'delete', 'gang', id, gang.name);
    emitUpdate(req, 'gang:deleted', { id });
    res.json({ message: 'Gang supprime.' });
  } catch (err) {
    next(err);
  }
});

// ================= CATEGORIES =================

// POST /api/gangs/:gangId/categories (admin + staff)
router.post('/:gangId/categories', requireAuth, requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const { gangId } = req.params;
    const { name } = req.body || {};

    const { rows } = await query('SELECT * FROM gangs WHERE id = $1', [gangId]);
    const gang = rows[0];
    if (!gang) return res.status(404).json({ error: 'Gang introuvable.' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'Le nom de la categorie est requis.' });

    const dupe = await query('SELECT id FROM categories WHERE gang_id = $1 AND name = $2', [
      gangId,
      name.trim(),
    ]);
    if (dupe.rows.length) return res.status(409).json({ error: 'Cette categorie existe deja pour ce gang.' });

    const id = uuid();
    await query('INSERT INTO categories (id, gang_id, name) VALUES ($1, $2, $3)', [id, gangId, name.trim()]);
    await touchGang(gangId);

    logSafe(req.user, 'create', 'category', id, `${gang.name} / ${name.trim()}`);
    const updated = await getFullGang(gangId);
    emitUpdate(req, 'gang:updated', updated);
    res.status(201).json(updated);
  } catch (err) {
    next(err);
  }
});

// PUT /api/gangs/:gangId/categories/:catId (admin + staff)
router.put(
  '/:gangId/categories/:catId',
  requireAuth,
  requireRole('admin', 'staff'),
  async (req, res, next) => {
    try {
      const { gangId, catId } = req.params;
      const { name } = req.body || {};

      const { rows } = await query('SELECT * FROM categories WHERE id = $1 AND gang_id = $2', [
        catId,
        gangId,
      ]);
      const cat = rows[0];
      if (!cat) return res.status(404).json({ error: 'Categorie introuvable.' });
      if (!name || !name.trim()) return res.status(400).json({ error: 'Le nom de la categorie est requis.' });

      const dupe = await query('SELECT id FROM categories WHERE gang_id = $1 AND name = $2 AND id != $3', [
        gangId,
        name.trim(),
        catId,
      ]);
      if (dupe.rows.length) {
        return res.status(409).json({ error: 'Une autre catégorie de ce gang porte déjà ce nom.' });
      }

      await query('UPDATE categories SET name = $1 WHERE id = $2', [name.trim(), catId]);
      await touchGang(gangId);

      logSafe(req.user, 'update', 'category', catId, name.trim());
      const updated = await getFullGang(gangId);
      emitUpdate(req, 'gang:updated', updated);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/gangs/:gangId/categories/:catId (admin + staff)
router.delete(
  '/:gangId/categories/:catId',
  requireAuth,
  requireRole('admin', 'staff'),
  async (req, res, next) => {
    try {
      const { gangId, catId } = req.params;
      const { rows } = await query('SELECT * FROM categories WHERE id = $1 AND gang_id = $2', [
        catId,
        gangId,
      ]);
      const cat = rows[0];
      if (!cat) return res.status(404).json({ error: 'Categorie introuvable.' });

      await query('DELETE FROM categories WHERE id = $1', [catId]); // cascade items
      await touchGang(gangId);

      logSafe(req.user, 'delete', 'category', catId, cat.name);
      const updated = await getFullGang(gangId);
      emitUpdate(req, 'gang:updated', updated);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// ================= ITEMS =================

// POST /api/gangs/:gangId/categories/:catId/items (admin + staff)
router.post(
  '/:gangId/categories/:catId/items',
  requireAuth,
  requireRole('admin', 'staff'),
  async (req, res, next) => {
    try {
      const { gangId, catId } = req.params;
      const { name, price, description } = req.body || {};

      const { rows } = await query('SELECT * FROM categories WHERE id = $1 AND gang_id = $2', [
        catId,
        gangId,
      ]);
      const cat = rows[0];
      if (!cat) return res.status(404).json({ error: 'Categorie introuvable.' });
      if (!name || !name.trim()) return res.status(400).json({ error: "Le nom de l'item est requis." });
      if (price === undefined || isNaN(Number(price)) || Number(price) < 0) {
        return res.status(400).json({ error: 'Le prix doit etre un nombre positif.' });
      }

      const id = uuid();
      await query(
        'INSERT INTO items (id, category_id, name, price, description) VALUES ($1, $2, $3, $4, $5)',
        [id, catId, name.trim(), Number(price), (description || '').trim()]
      );
      await touchGang(gangId);

      logSafe(req.user, 'create', 'item', id, name.trim(), { price: Number(price) });
      const updated = await getFullGang(gangId);
      emitUpdate(req, 'gang:updated', updated);
      res.status(201).json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/gangs/:gangId/categories/:catId/items/:itemId (admin + staff)
router.put(
  '/:gangId/categories/:catId/items/:itemId',
  requireAuth,
  requireRole('admin', 'staff'),
  async (req, res, next) => {
    try {
      const { gangId, catId, itemId } = req.params;
      const { name, price, description } = req.body || {};

      const { rows } = await query('SELECT * FROM items WHERE id = $1 AND category_id = $2', [
        itemId,
        catId,
      ]);
      const item = rows[0];
      if (!item) return res.status(404).json({ error: 'Item introuvable.' });

      const newName = name && name.trim() ? name.trim() : item.name;
      const newPrice = price !== undefined && !isNaN(Number(price)) ? Number(price) : item.price;
      const newDesc = description !== undefined ? description.trim() : item.description;

      await query(
        'UPDATE items SET name = $1, price = $2, description = $3, updated_at = NOW() WHERE id = $4',
        [newName, newPrice, newDesc, itemId]
      );
      await touchGang(gangId);

      logSafe(req.user, 'update', 'item', itemId, newName, {
        before: { name: item.name, price: item.price },
        after: { name: newName, price: newPrice },
      });
      const updated = await getFullGang(gangId);
      emitUpdate(req, 'gang:updated', updated);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/gangs/:gangId/categories/:catId/items/:itemId (admin + staff)
router.delete(
  '/:gangId/categories/:catId/items/:itemId',
  requireAuth,
  requireRole('admin', 'staff'),
  async (req, res, next) => {
    try {
      const { gangId, catId, itemId } = req.params;
      const { rows } = await query('SELECT * FROM items WHERE id = $1 AND category_id = $2', [
        itemId,
        catId,
      ]);
      const item = rows[0];
      if (!item) return res.status(404).json({ error: 'Item introuvable.' });

      await query('DELETE FROM items WHERE id = $1', [itemId]);
      await touchGang(gangId);

      logSafe(req.user, 'delete', 'item', itemId, item.name);
      const updated = await getFullGang(gangId);
      emitUpdate(req, 'gang:updated', updated);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = { router, getAllGangsFull, getFullGang };
