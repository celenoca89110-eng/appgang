const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getAllGangsFull } = require('./gangs');
const { getRecentLogs } = require('../db/auditLog');

const router = express.Router();

// GET /api/search?q=terme - recherche globale server-side sur les items
router.get('/search', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);

  const like = `%${q}%`;
  const rows = db
    .prepare(
      `
    SELECT
      items.id AS item_id, items.name AS item_name, items.price, items.description,
      categories.id AS category_id, categories.name AS category_name,
      gangs.id AS gang_id, gangs.name AS gang_name
    FROM items
    JOIN categories ON categories.id = items.category_id
    JOIN gangs ON gangs.id = categories.gang_id
    WHERE items.name LIKE ? OR items.description LIKE ?
    ORDER BY gangs.name, categories.name, items.name
  `
    )
    .all(like, like);

  res.json(rows);
});

// GET /api/export - export JSON complet de la base (gangs/categories/items)
router.get('/export', requireAuth, (req, res) => {
  const data = {
    exported_at: new Date().toISOString(),
    exported_by: req.user.username,
    gangs: getAllGangsFull(),
  };
  res.setHeader('Content-Disposition', 'attachment; filename="gangs-export.json"');
  res.json(data);
});

// GET /api/audit-log - historique des modifications (admin + staff)
router.get('/audit-log', requireAuth, requireRole('admin', 'staff'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(getRecentLogs(limit));
});

module.exports = router;
