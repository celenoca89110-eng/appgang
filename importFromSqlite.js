/**
 * Script d'IMPORT UNIQUE — a lancer manuellement une seule fois si vous avez
 * deja des donnees dans l'ancienne base SQLite (gangapp.db) et que vous
 * voulez les recuperer dans PostgreSQL. Ce n'est PAS une migration
 * automatique du systeme de migrations (elle ne s'execute jamais toute
 * seule au demarrage), justement pour eviter tout risque de double-import
 * ou d'ecrasement accidentel.
 *
 * Utilisation :
 *   1. npm install better-sqlite3 --no-save   (dependance temporaire, non
 *      requise pour faire tourner l'application normalement)
 *   2. OLD_SQLITE_PATH=./data/gangapp.db node server/db/importFromSqlite.js
 *   3. Verifiez les donnees dans PostgreSQL, puis vous pouvez supprimer
 *      better-sqlite3 (`npm uninstall better-sqlite3`) et l'ancien fichier .db.
 *
 * Le script est idempotent : chaque insertion utilise
 * "ON CONFLICT (id) DO NOTHING", donc le relancer plusieurs fois par erreur
 * ne duplique jamais rien et n'ecrase aucune ligne deja presente en base
 * PostgreSQL (que ce soit issue d'un import precedent ou saisie depuis
 * l'application).
 */
require('dotenv').config();
const path = require('path');
const { pool } = require('./pool');

async function main() {
  const oldPath = process.env.OLD_SQLITE_PATH || './data/gangapp.db';

  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (e) {
    console.error(
      '[import] Le module "better-sqlite3" n\'est pas installe. ' +
        'Lancez d\'abord: npm install better-sqlite3 --no-save'
    );
    process.exit(1);
  }

  const fs = require('fs');
  if (!fs.existsSync(oldPath)) {
    console.error(`[import] Fichier SQLite introuvable : ${path.resolve(oldPath)}`);
    console.error('[import] Definissez OLD_SQLITE_PATH si le fichier est ailleurs.');
    process.exit(1);
  }

  const sqlite = new Database(oldPath, { readonly: true });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const users = sqlite.prepare('SELECT * FROM users').all();
    for (const u of users) {
      await client.query(
        `INSERT INTO users (id, username, password_hash, role, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [u.id, u.username, u.password_hash, u.role, u.created_at]
      );
    }
    console.log(`[import] Utilisateurs : ${users.length} ligne(s) traitée(s).`);

    const gangs = sqlite.prepare('SELECT * FROM gangs').all();
    for (const g of gangs) {
      await client.query(
        `INSERT INTO gangs (id, name, color, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [g.id, g.name, g.color, g.created_by, g.created_at, g.updated_at]
      );
    }
    console.log(`[import] Gangs : ${gangs.length} ligne(s) traitée(s).`);

    const categories = sqlite.prepare('SELECT * FROM categories').all();
    for (const c of categories) {
      await client.query(
        `INSERT INTO categories (id, gang_id, name, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [c.id, c.gang_id, c.name, c.created_at]
      );
    }
    console.log(`[import] Catégories : ${categories.length} ligne(s) traitée(s).`);

    const items = sqlite.prepare('SELECT * FROM items').all();
    for (const it of items) {
      await client.query(
        `INSERT INTO items (id, category_id, name, price, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [it.id, it.category_id, it.name, it.price, it.description, it.created_at, it.updated_at]
      );
    }
    console.log(`[import] Items : ${items.length} ligne(s) traitée(s).`);

    const logs = sqlite.prepare('SELECT * FROM audit_log').all();
    for (const l of logs) {
      await client.query(
        `INSERT INTO audit_log (id, user_id, username, action, entity_type, entity_id, entity_label, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [l.id, l.user_id, l.username, l.action, l.entity_type, l.entity_id, l.entity_label, l.details, l.created_at]
      );
    }
    console.log(`[import] Historique : ${logs.length} ligne(s) traitée(s).`);

    await client.query('COMMIT');
    console.log('[import] Import terminé avec succès (transaction validée).');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[import] Échec — transaction annulée, aucune donnée partielle insérée.');
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    sqlite.close();
    await pool.end();
  }
}

main();
