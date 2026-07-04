/**
 * MODELE — copiez ce fichier en le renommant "00X_description_courte.js"
 * (X = prochain numéro disponible) pour toute future évolution du schéma.
 *
 * Ce fichier n'est pas chargé par le runner (il ne commence pas par un
 * chiffre), il sert uniquement de modèle a copier-coller.
 *
 * RAPPEL DES REGLES (voir aussi 001_init_schema.js) :
 *   - Additif uniquement. Jamais de DROP / DELETE / recreation de table.
 *   - Idempotent : PostgreSQL ne supporte pas "ADD COLUMN IF NOT EXISTS" sur
 *     toutes les versions anciennes, donc on verifie explicitement via
 *     information_schema avant d'ajouter une colonne (voir exemple ci-dessous).
 *     (Sur PostgreSQL 9.6+, "ALTER TABLE ... ADD COLUMN IF NOT EXISTS" existe
 *     nativement et peut etre utilise directement si vous ciblez une version
 *     recente, ce qui est le cas sur Render.)
 *   - Le runner execute up(client) dans une transaction : toute erreur annule
 *     automatiquement les changements, aucune perte de donnees possible.
 *
 * Exemple : ajouter une colonne "stock" (facultative) a la table items.
 */
module.exports = {
  id: '000_exemple_ajout_colonne', // <-- renommez avec le bon numero
  description: 'Exemple: ajoute une colonne stock (nullable) a items',
  async up(client) {
    // Forme recommandee sur PostgreSQL recent (Render) : idempotente nativement
    await client.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT NULL;`);
  },
};
