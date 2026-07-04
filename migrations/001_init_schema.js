/**
 * Migration 001 — Schéma initial (PostgreSQL).
 *
 * REGLE D'OR pour toute migration future dans ce dossier :
 *   - Uniquement des opérations ADDITIVES : CREATE TABLE IF NOT EXISTS,
 *     ALTER TABLE ... ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
 *   - JAMAIS de DROP TABLE, DROP COLUMN, DELETE FROM sans WHERE precis, ni de
 *     recreation de table qui ferait perdre des lignes existantes.
 *   - Une migration déjà appliquée sur la base de production ne doit JAMAIS
 *     être modifiée après coup : pour un correctif, on écrit une NOUVELLE
 *     migration (002, 003, ...).
 *   - Chaque migration doit pouvoir être rejouée sans erreur sur une base qui
 *     a déjà toutes ses tables (d'où "IF NOT EXISTS" partout).
 *
 * `up(client)` reçoit un client pg déjà positionné dans une transaction
 * (BEGIN a été appelé par le runner) : on peut faire plusieurs client.query()
 * en confiance, tout est annulé automatiquement en cas d'erreur.
 */
module.exports = {
  id: '001_init_schema',
  description: 'Création des tables users, gangs, categories, items, audit_log',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','staff','viewer')) DEFAULT 'viewer',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS gangs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT DEFAULT '#D9A63E',
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        gang_id TEXT NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(gang_id, name)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        description TEXT DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        entity_label TEXT,
        details TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_categories_gang ON categories(gang_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);`);
  },
};
