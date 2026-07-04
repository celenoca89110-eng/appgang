const { v4: uuid } = require('uuid');
const bcrypt = require('bcryptjs');

/**
 * Insere ou met a jour les gangs/categories/items d'un payload d'import, en
 * utilisant le NOM comme cle de rapprochement (un gang existant du meme nom
 * est reutilise, une categorie existante du meme nom dans ce gang est
 * reutilisee, un item existant du meme nom dans cette categorie voit son
 * prix/description mis a jour). Cette logique est volontairement la meme,
 * qu'on soit en mode "fusion" ou juste apres un "remplacement" (dans ce
 * second cas, la base a deja ete videe avant l'appel, donc tout est cree).
 *
 * Doit etre appele avec un client deja dans une transaction (BEGIN fait par
 * l'appelant) : aucune ecriture partielle ne doit survivre a une erreur.
 *
 * @param {import('pg').PoolClient} client
 * @param {Array} gangs - payload.gangs valide par importValidator
 * @param {{id:string}} currentUser
 * @param {object} summary - objet de comptage mute par cette fonction
 */
async function importGangsData(client, gangs, currentUser, summary) {
  for (const g of gangs) {
    const name = g.name.trim();

    const { rows: existingGangRows } = await client.query('SELECT id FROM gangs WHERE name = $1', [name]);
    let gangId;

    if (existingGangRows.length) {
      gangId = existingGangRows[0].id;
      if (g.color) {
        await client.query('UPDATE gangs SET color = $1 WHERE id = $2', [g.color, gangId]);
      }
      summary.gangsUpdated++;
    } else {
      gangId = uuid();
      await client.query('INSERT INTO gangs (id, name, color, created_by) VALUES ($1, $2, $3, $4)', [
        gangId,
        name,
        g.color || '#D9A63E',
        currentUser.id,
      ]);
      summary.gangsCreated++;
    }

    const categories = Array.isArray(g.categories) ? g.categories : [];
    for (const c of categories) {
      const cname = c.name.trim();
      const { rows: existingCatRows } = await client.query(
        'SELECT id FROM categories WHERE gang_id = $1 AND name = $2',
        [gangId, cname]
      );
      let catId;

      if (existingCatRows.length) {
        catId = existingCatRows[0].id;
        summary.categoriesUpdated++;
      } else {
        catId = uuid();
        await client.query('INSERT INTO categories (id, gang_id, name) VALUES ($1, $2, $3)', [
          catId,
          gangId,
          cname,
        ]);
        summary.categoriesCreated++;
      }

      const items = Array.isArray(c.items) ? c.items : [];
      for (const it of items) {
        const iname = it.name.trim();
        const price = Number(it.price);
        const description = (it.description || '').toString().trim();

        const { rows: existingItemRows } = await client.query(
          'SELECT id FROM items WHERE category_id = $1 AND name = $2',
          [catId, iname]
        );

        if (existingItemRows.length) {
          await client.query(
            'UPDATE items SET price = $1, description = $2, updated_at = NOW() WHERE id = $3',
            [price, description, existingItemRows[0].id]
          );
          summary.itemsUpdated++;
        } else {
          await client.query(
            'INSERT INTO items (id, category_id, name, price, description) VALUES ($1, $2, $3, $4, $5)',
            [uuid(), catId, iname, price, description]
          );
          summary.itemsCreated++;
        }
      }
    }

    await client.query('UPDATE gangs SET updated_at = NOW() WHERE id = $1', [gangId]);
  }
}

/**
 * Cree les utilisateurs du payload qui n'existent pas encore (par username).
 * Par securite, un utilisateur existant n'est JAMAIS modifie par un import
 * (ni mot de passe, ni role) : seuls les nouveaux comptes sont crees. Ceci
 * evite qu'un fichier JSON (potentiellement partage, edite a la main, ou
 * provenant d'une sauvegarde ancienne) puisse ecraser silencieusement un mot
 * de passe ou elever un role via l'import.
 *
 * @param {import('pg').PoolClient} client
 * @param {Array} users - payload.users valide par importValidator
 * @param {object} summary
 */
async function importUsersData(client, users, summary) {
  for (const u of users) {
    const username = u.username.trim();

    const { rows: existing } = await client.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.length) {
      summary.usersSkipped++;
      summary.warnings.push(
        `Utilisateur "${username}" déjà existant : ignoré (l'import ne modifie jamais un compte existant).`
      );
      continue;
    }

    const role = u.role || 'viewer';
    let passwordHash = u.password_hash;
    if (!passwordHash && u.password) {
      passwordHash = bcrypt.hashSync(u.password, 10);
    }
    if (!passwordHash) {
      summary.usersSkipped++;
      summary.warnings.push(`Utilisateur "${username}" ignoré : aucun mot de passe exploitable fourni.`);
      continue;
    }

    await client.query('INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)', [
      uuid(),
      username,
      passwordHash,
      role,
    ]);
    summary.usersCreated++;
  }
}

/**
 * Supprime tous les gangs existants (et par cascade leurs categories/items).
 * Ne touche JAMAIS a la table users : le mode "remplacement" de l'import ne
 * remplace que les donnees economiques (gangs/categories/items), jamais les
 * comptes utilisateurs, pour ne jamais risquer de verrouiller l'admin hors
 * de sa propre application.
 *
 * @param {import('pg').PoolClient} client
 */
async function wipeGangsData(client) {
  await client.query('DELETE FROM gangs');
}

function createSummary() {
  return {
    gangsCreated: 0,
    gangsUpdated: 0,
    categoriesCreated: 0,
    categoriesUpdated: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    usersCreated: 0,
    usersSkipped: 0,
    warnings: [],
  };
}

module.exports = { importGangsData, importUsersData, wipeGangsData, createSummary };
