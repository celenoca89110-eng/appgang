const { pool, query, getClient } = require('./pool');
const { runMigrations } = require('./migrate');

/**
 * Initialise la base de données : applique les migrations en attente
 * (créant les tables au tout premier démarrage, sans jamais toucher aux
 * données déjà présentes lors des démarrages suivants). A appeler une seule
 * fois, avant que le serveur HTTP ne commence à accepter des requêtes.
 */
async function init() {
  await runMigrations(pool);
}

module.exports = { pool, query, getClient, init };
