require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('./database');

function ensureAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'changeMoi123!';

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    console.log(`[seed] Le compte admin "${username}" existe deja.`);
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  const id = uuid();
  db.prepare(
    'INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(id, username, hash, 'admin');

  console.log(`[seed] Compte admin cree : "${username}" (mot de passe defini dans .env)`);
}

ensureAdmin();
