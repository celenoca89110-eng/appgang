const { v4: uuid } = require('uuid');
const { query } = require('./pool');

/**
 * Enregistre une action dans l'historique des modifications.
 * @param {object} user - { id, username } l'utilisateur qui a fait l'action
 * @param {string} action - 'create' | 'update' | 'delete' | 'login'
 * @param {string} entityType - 'gang' | 'category' | 'item' | 'user' | 'auth'
 * @param {string} entityId
 * @param {string} entityLabel - libelle lisible (ex: nom du gang)
 * @param {object} [details] - donnees additionnelles (avant/apres, etc.)
 */
async function logAction(user, action, entityType, entityId, entityLabel, details) {
  await query(
    `INSERT INTO audit_log (id, user_id, username, action, entity_type, entity_id, entity_label, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      uuid(),
      user?.id || null,
      user?.username || 'systeme',
      action,
      entityType,
      entityId || null,
      entityLabel || null,
      details ? JSON.stringify(details) : null,
    ]
  );
}

async function getRecentLogs(limit = 200) {
  const { rows } = await query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows.map((row) => ({ ...row, details: row.details ? JSON.parse(row.details) : null }));
}

module.exports = { logAction, getRecentLogs };
