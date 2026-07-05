const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getAllGangsFull } = require('./gangs');
const { getRecentLogs } = require('../db/auditLog');

const router = express.Router();

// ================= SEARCH (FIX POSTGRES) =================
// GET /api/search?q=terme
router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);

  const like = `%${q}%`;

  try {
    const result = await db.query(
      `
      SELECT
        items.id AS item_id,
        items.name AS item_name,
        items.price,
        items.description,
        categories.id AS category_id,
        categories.name AS category_name,
        gangs.id AS gang_id,
        gangs.name AS gang_name
      FROM items
      JOIN categories ON categories.id = items.category_id
      JOIN gangs ON gangs.id = categories.gang_id
      WHERE items.name ILIKE $1
         OR items.description ILIKE $1
      ORDER BY gangs.name, categories.name, items.name
      `,
      [like]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('[SEARCH ERROR]', err);
    res.status(500).json({ error: 'Erreur recherche' });
  }
});


// ================= EXPORT JSON =================
// GET /api/export
router.get('/export', requireAuth, async (req, res) => {
  try {
    const data = {
      exported_at: new Date().toISOString(),
      exported_by: req.user.username,
      gangs: await getAllGangsFull(),
    };

    res.setHeader(
      'Content-Disposition',
      'attachment; filename="gangs-export.json"'
    );

    res.json(data);
  } catch (err) {
    console.error('[EXPORT ERROR]', err);
    res.status(500).json({ error: 'Erreur export' });
  }
});


// ================= AUDIT LOG =================
// GET /api/audit-log
router.get(
  '/audit-log',
  requireAuth,
  requireRole('admin', 'staff'),
  async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 200, 1000);
      const logs = await getRecentLogs(limit);
      res.json(logs);
    } catch (err) {
      console.error('[AUDIT ERROR]', err);
      res.status(500).json({ error: 'Erreur logs' });
    }
  }
);

module.exports = router;
