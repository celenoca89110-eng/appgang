const db = require('./database');

async function logAction({
  user_id,
  username,
  action,
  entity_type,
  entity_id,
  entity_label,
  details
}) {
  await db.query(
    `INSERT INTO audit_log
     (id, user_id, username, action, entity_type, entity_id, entity_label, details, created_at)
     VALUES
     (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      user_id,
      username,
      action,
      entity_type,
      entity_id,
      entity_label,
      details
    ]
  );
}

module.exports = { logAction };
