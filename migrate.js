const fs = require('fs');
const path = require('path');
const { backupToJson } = require('./backup');

const MIGRATIONS_DIR = __dirname + '/migrations';

/**
 * Charge tous les fichiers de migration valides, triés par ordre numérique
 * (ex: 001_..., 002_...). Les fichiers qui ne commencent pas par un chiffre
 * (comme _TEMPLATE.example.js) sont ignorés.
 */
function loadMigrationFiles() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+.*\.js$/.test(f))
    .sort();

  return files.map((f) => {
    const mod = require(path.join(MIGRATIONS_DIR, f));
    if (!mod.id || typeof mod.up !== 'function') {
      throw new Error(`Migration invalide dans ${f} : il manque "id" ou "up()".`);
    }
    return { file: f, ...mod };
  });
}

/**
 * Applique les migrations manquantes, dans l'ordre, chacune dans sa propre
 * transaction PostgreSQL (BEGIN/COMMIT, ROLLBACK automatique en cas
 * d'erreur). Ne supprime, ne recree et ne vide JAMAIS de table existante :
 * chaque migration doit être additive (voir migrations/001_init_schema.js).
 *
 * @param {import('pg').Pool} pool
 */
async function runMigrations(pool) {
  // Table de suivi des migrations deja appliquees (elle-meme creee de facon
  // idempotente, donc jamais recreee si elle existe deja).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const migrations = loadMigrationFiles();
  const { rows } = await pool.query('SELECT id FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.id));
  const pending = migrations.filter((m) => !applied.has(m.id));

  if (!pending.length) {
    console.log(`[migrations] Base à jour (${migrations.length} migration(s) déjà appliquée(s)).`);
    return;
  }

  // Sauvegarde de sécurité (export JSON de toutes les tables) avant toute
  // modification de schéma, en best-effort : un échec de sauvegarde (ex: sur
  // une base toute neuve sans aucune table encore) ne doit pas empêcher les
  // migrations elles-mêmes de s'exécuter, puisqu'elles sont de toute façon
  // protégées individuellement par une transaction.
  try {
    const backupPath = await backupToJson(pool, 'pre-migration');
    console.log(`[migrations] Sauvegarde de sécurité créée : ${backupPath}`);
  } catch (err) {
    console.warn('[migrations] Sauvegarde de sécurité ignorée :', err.message);
  }

  for (const migration of pending) {
    console.log(`[migrations] Application de "${migration.id}" — ${migration.description || ''}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await migration.up(client);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(
        `[migrations] ECHEC de la migration "${migration.id}" — transaction annulée, aucune donnée perdue.`
      );
      console.error(err);
      throw err; // on arrete le demarrage plutot que de tourner avec un schema incoherent
    } finally {
      client.release();
    }
  }

  console.log(`[migrations] ${pending.length} migration(s) appliquée(s) avec succès.`);
}

module.exports = { runMigrations, loadMigrationFiles };
