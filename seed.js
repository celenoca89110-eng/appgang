require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { query, pool } = require('./pool');

async function ensureAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'changeMoi123!';

  const { rows } = await query('SELECT id FROM users WHERE username = $1', [username]);
  if (rows.length) {
    console.log(`[seed] Le compte admin "${username}" existe déjà.`);
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  const id = uuid();
  await query('INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)', [
    id,
    username,
    hash,
    'admin',
  ]);

  console.log(`[seed] Compte admin créé : "${username}" (mot de passe défini dans .env)`);
}

// Utilisable directement: `npm run seed`
if (require.main === module) {
  ensureAdmin()
    .then(() => pool.end())
    .catch((err) => {
      console.error('[seed] Échec :', err);
      process.exit(1);
    });
}

module.exports = { ensureAdmin };
