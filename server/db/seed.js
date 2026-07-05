const db = require('./database'); // pool postgres

async function ensureAdmin() {
  const username = 'admin';

  const result = await db.query(
    'SELECT id FROM users WHERE username = $1',
    [username]
  );

  if (result.rows.length === 0) {
    await db.query(
      `INSERT INTO users (id, username, password_hash, role)
       VALUES ($1, $2, $3, $4)`,
      [
        'admin-id',
        'admin',
        'admin',
        'admin'
      ]
    );
  }
}

ensureAdmin();
