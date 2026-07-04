const express = require('express');
const { query } = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getAllGangsFull } = require('./gangs');
const { getRecentLogs } = require('../db/auditLog');

const router = express.Router();

// GET /api/search?q=terme - recherche globale server-side sur les items
router.get('/search', requireAuth, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);

    const like = `%${q}%`;
    const { rows } = await query(
      `
      SELECT
        items.id AS item_id, items.name AS item_name, items.price, items.description,
        categories.id AS category_id, categories.name AS category_name,
        gangs.id AS gang_id, gangs.name AS gang_name
      FROM items
      JOIN categories ON categories.id = items.category_id
      JOIN gangs ON gangs.id = categories.gang_id
      WHERE items.name ILIKE $1 OR items.description ILIKE $1
      ORDER BY gangs.name, categories.name, items.name
      `,
      [like]
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/export - export JSON complet de la base (gangs/categories/items)
router.get('/export', requireAuth, async (req, res, next) => {
  try {
    const data = {
      exported_at: new Date().toISOString(),
      exported_by: req.user.username,
      gangs: await getAllGangsFull(),
    };
    res.setHeader('Content-Disposition', 'attachment; filename="gangs-export.json"');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/audit-log - historique des modifications (admin + staff)
router.get('/audit-log', requireAuth, requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    res.json(await getRecentLogs(limit));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
