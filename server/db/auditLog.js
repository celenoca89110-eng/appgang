const { v4: uuid } = require('uuid');
const db = require('./database');

const insertStmt = db.prepare(`
  INSERT INTO audit_log (id, user_id, username, action, entity_type, entity_id, entity_label, details)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

/**
 * Enregistre une action dans l'historique des modifications.
 * @param {object} user - { id, username } l'utilisateur qui a fait l'action
 * @param {string} action - 'create' | 'update' | 'delete' | 'login'
 * @param {string} entityType - 'gang' | 'category' | 'item' | 'user' | 'auth'
 * @param {string} entityId
 * @param {string} entityLabel - libelle lisible (ex: nom du gang)
 * @param {object} [details] - donnees additionnelles (avant/apres, etc.)
 */
function logAction(user, action, entityType, entityId, entityLabel, details) {
  insertStmt.run(
    uuid(),
    user?.id || null,
    user?.username || 'systeme',
    action,
    entityType,
    entityId || null,
    entityLabel || null,
    details ? JSON.stringify(details) : null
  );
}

function getRecentLogs(limit = 200) {
  return db
    .prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?')
    .all(limit)
    .map((row) => ({ ...row, details: row.details ? JSON.parse(row.details) : null }));
}

module.exports = { logAction, getRecentLogs };
