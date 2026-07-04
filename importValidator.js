const VALID_ROLES = ['admin', 'staff', 'viewer'];
const MAX_ERRORS = 200; // evite un rapport d'erreur illisible sur un fichier tres malforme

/**
 * Valide entierement la structure d'un fichier d'import AVANT toute ecriture
 * en base. Ne fait aucun acces base de donnees : c'est une validation pure,
 * synchrone, sur la forme des donnees.
 *
 * Format attendu (identique a celui produit par GET /api/export) :
 * {
 *   gangs: [
 *     { name, color?, categories: [
 *         { name, items: [ { name, price, description? } ] }
 *     ]}
 *   ],
 *   users?: [ { username, role?, password_hash? , password? } ]
 * }
 *
 * @param {*} payload - contenu JSON deja parse (JSON.parse), pas une chaine
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateImportPayload(payload) {
  const errors = [];
  const pushError = (msg) => {
    if (errors.length < MAX_ERRORS) errors.push(msg);
  };

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      valid: false,
      errors: ['Le fichier doit contenir un objet JSON racine (pas un tableau ni une valeur simple).'],
    };
  }

  // ---------- GANGS ----------
  const gangs = payload.gangs;
  if (gangs === undefined) {
    pushError('La clé "gangs" est requise (tableau, peut être vide si vous n\'importez que des utilisateurs).');
  } else if (!Array.isArray(gangs)) {
    pushError('La clé "gangs" doit être un tableau.');
  } else {
    const seenGangNames = new Set();
    gangs.forEach((g, gi) => {
      const prefix = `gangs[${gi}]`;
      if (!g || typeof g !== 'object' || Array.isArray(g)) {
        pushError(`${prefix} doit être un objet.`);
        return;
      }
      if (!g.name || typeof g.name !== 'string' || !g.name.trim()) {
        pushError(`${prefix}.name est requis et doit être une chaîne non vide.`);
      } else {
        const key = g.name.trim().toLowerCase();
        if (seenGangNames.has(key)) pushError(`${prefix}.name "${g.name}" est en double dans le fichier.`);
        seenGangNames.add(key);
      }
      if (g.color !== undefined && typeof g.color !== 'string') {
        pushError(`${prefix}.color doit être une chaîne si présente.`);
      }

      const categories = g.categories;
      if (categories !== undefined && !Array.isArray(categories)) {
        pushError(`${prefix}.categories doit être un tableau si présent.`);
        return;
      }
      if (Array.isArray(categories)) {
        const seenCatNames = new Set();
        categories.forEach((c, ci) => {
          const cprefix = `${prefix}.categories[${ci}]`;
          if (!c || typeof c !== 'object' || Array.isArray(c)) {
            pushError(`${cprefix} doit être un objet.`);
            return;
          }
          if (!c.name || typeof c.name !== 'string' || !c.name.trim()) {
            pushError(`${cprefix}.name est requis et doit être une chaîne non vide.`);
          } else {
            const ckey = c.name.trim().toLowerCase();
            if (seenCatNames.has(ckey)) pushError(`${cprefix}.name "${c.name}" est en double pour ce gang.`);
            seenCatNames.add(ckey);
          }

          const items = c.items;
          if (items !== undefined && !Array.isArray(items)) {
            pushError(`${cprefix}.items doit être un tableau si présent.`);
            return;
          }
          if (Array.isArray(items)) {
            items.forEach((it, ii) => {
              const iprefix = `${cprefix}.items[${ii}]`;
              if (!it || typeof it !== 'object' || Array.isArray(it)) {
                pushError(`${iprefix} doit être un objet.`);
                return;
              }
              if (!it.name || typeof it.name !== 'string' || !it.name.trim()) {
                pushError(`${iprefix}.name est requis et doit être une chaîne non vide.`);
              }
              if (it.price === undefined || isNaN(Number(it.price)) || Number(it.price) < 0) {
                pushError(`${iprefix}.price est requis et doit être un nombre positif ou nul.`);
              }
              if (it.description !== undefined && typeof it.description !== 'string') {
                pushError(`${iprefix}.description doit être une chaîne si présente.`);
              }
            });
          }
        });
      }
    });
  }

  // ---------- USERS (facultatif) ----------
  if (payload.users !== undefined) {
    if (!Array.isArray(payload.users)) {
      pushError('La clé "users" doit être un tableau si présente.');
    } else {
      const seenUsernames = new Set();
      payload.users.forEach((u, ui) => {
        const prefix = `users[${ui}]`;
        if (!u || typeof u !== 'object' || Array.isArray(u)) {
          pushError(`${prefix} doit être un objet.`);
          return;
        }
        if (!u.username || typeof u.username !== 'string' || !u.username.trim()) {
          pushError(`${prefix}.username est requis et doit être une chaîne non vide.`);
        } else {
          const key = u.username.trim().toLowerCase();
          if (seenUsernames.has(key)) pushError(`${prefix}.username "${u.username}" est en double dans le fichier.`);
          seenUsernames.add(key);
        }
        if (u.role !== undefined && !VALID_ROLES.includes(u.role)) {
          pushError(`${prefix}.role invalide ("${u.role}"). Valeurs possibles : ${VALID_ROLES.join(', ')}.`);
        }
        if (!u.password_hash && !u.password) {
          pushError(
            `${prefix} doit fournir soit "password_hash" (hash bcrypt d'un export existant), soit "password" (nouveau mot de passe en clair, min. 6 caractères).`
          );
        }
        if (u.password !== undefined && (typeof u.password !== 'string' || u.password.length < 6)) {
          pushError(`${prefix}.password doit être une chaîne d'au moins 6 caractères.`);
        }
        if (u.password_hash !== undefined && (typeof u.password_hash !== 'string' || !/^\$2[aby]\$/.test(u.password_hash))) {
          pushError(`${prefix}.password_hash ne ressemble pas à un hash bcrypt valide.`);
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateImportPayload, VALID_ROLES };
