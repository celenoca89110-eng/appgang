const fs = require('fs');
const path = require('path');

const KNOWN_TABLES = ['users', 'gangs', 'categories', 'items', 'audit_log', 'schema_migrations'];

/**
 * Exporte toutes les tables connues de la base vers un fichier JSON
 * horodaté dans data/backups/. Ne modifie jamais la base (lecture seule).
 *
 * A la difference de l'ancienne version SQLite (simple copie de fichier),
 * PostgreSQL n'a pas de "fichier unique" a copier : on fait donc un export
 * applicatif de chaque table. C'est suffisant pour restaurer manuellement
 * les données en cas de besoin (voir server/db/importFromSqlite.js pour un
 * exemple de logique de reinjection, transposable a un JSON).
 *
 * Sur Render, ce script peut être lancé depuis le "Shell" du service, ou en
 * local si vous avez la chaîne de connexion PostgreSQL (variable
 * DATABASE_URL). Pensez aussi aux sauvegardes automatiques natives de
 * Render (voir le README, section Render) qui restent la protection
 * principale en production.
 *
 * @param {import('pg').Pool} pool
 * @param {string} reason - court libelle pour le nom du fichier
 * @returns {Promise<string>} chemin du fichier de sauvegarde créé
 */
async function backupToJson(pool, reason = 'manuel') {
  const backupsDir = path.join(process.cwd(), 'data', 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const dump = { exported_at: new Date().toISOString(), tables: {} };

  for (const table of KNOWN_TABLES) {
    try {
      const { rows } = await pool.query(`SELECT * FROM ${table}`);
      dump.tables[table] = rows;
    } catch (err) {
      // La table n'existe pas encore (ex: tout premier demarrage avant
      // migrations) - on l'ignore simplement plutot que de faire echouer
      // toute la sauvegarde.
      dump.tables[table] = { error: `table indisponible: ${err.message}` };
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destPath = path.join(backupsDir, `gangapp_${timestamp}_${reason}.json`);
  fs.writeFileSync(destPath, JSON.stringify(dump, null, 2));

  return destPath;
}

// Utilisable directement: `npm run backup` (equivaut a `node server/db/backup.js`)
if (require.main === module) {
  require('dotenv').config();
  const { pool } = require('./pool');
  backupToJson(pool, 'manuel')
    .then((dest) => {
      console.log(`[backup] Sauvegarde JSON créée : ${dest}`);
      return pool.end();
    })
    .catch((err) => {
      console.error('[backup] Échec de la sauvegarde :', err.message);
      process.exit(1);
    });
}

module.exports = { backupToJson };
