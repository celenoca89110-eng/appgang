const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    '[fatal] DATABASE_URL manquant. Copiez .env.example vers .env et renseignez la ' +
      'chaine de connexion PostgreSQL (locale, ou "Internal Database URL" fournie par Render).'
  );
  process.exit(1);
}

// Render (comme la plupart des hebergeurs Postgres manages) exige TLS pour les
// connexions, sauf en local. On desactive donc le TLS uniquement si la chaine
// de connexion pointe vers localhost/127.0.0.1, et on l'active sinon avec
// rejectUnauthorized:false (le certificat manage de Render n'est pas dans la
// chaine de confiance par defaut de Node, c'est une configuration standard et
// recommandee par Render pour ce cas).
const isLocalDb = /localhost|127\.0\.0\.1/.test(connectionString);
const ssl = isLocalDb ? false : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString,
  ssl,
  max: Number(process.env.PG_POOL_MAX) || 10,
});

pool.on('error', (err) => {
  // Erreur sur une connexion inactive du pool (ex: coupure reseau) - ne doit
  // pas faire planter le process, juste etre loguee.
  console.error('[pg] Erreur inattendue sur une connexion inactive du pool :', err.message);
});

/**
 * Execute une requete SQL parametree via le pool.
 * @param {string} text - requete SQL avec placeholders $1, $2, ...
 * @param {Array} params
 * @returns {Promise<import('pg').QueryResult>}
 */
function query(text, params) {
  return pool.query(text, params);
}

/**
 * Recupere un client dedie du pool, pour executer plusieurs requetes dans
 * une meme transaction (BEGIN/COMMIT/ROLLBACK). Ne pas oublier client.release().
 */
async function getClient() {
  return pool.connect();
}

module.exports = { pool, query, getClient };
