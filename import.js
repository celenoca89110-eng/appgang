const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../db/auditLog');
const { backupToJson } = require('../db/backup');
const { validateImportPayload } = require('../services/importValidator');
const {
  importGangsData,
  importUsersData,
  wipeGangsData,
  createSummary,
} = require('../services/importService');
const { getAllGangsFull } = require('./gangs');

const router = express.Router();

const VALID_MODES = ['merge', 'replace'];

/**
 * POST /api/import
 * Body: {
 *   mode: 'merge' | 'replace',
 *   confirmReplace: boolean,   // doit etre exactement true si mode === 'replace'
 *   payload: { gangs: [...], users?: [...] }  // meme forme que GET /api/export
 * }
 *
 * Reserve aux admins : cette route peut, en mode "replace", supprimer des
 * donnees existantes (gangs/categories/items uniquement - jamais les
 * comptes utilisateurs, voir importService.wipeGangsData).
 *
 * Garanties d'integrite :
 *  - Validation complete du fichier AVANT toute ecriture (aucune ecriture
 *    partielle possible : soit le fichier est entierement valide, soit rien
 *    n'est touche).
 *  - Toute l'operation (suppression eventuelle + insertion/mise a jour) se
 *    fait dans une seule transaction PostgreSQL : en cas d'erreur en cours
 *    de route, ROLLBACK complet, aucune donnee partiellement modifiee.
 *  - Mode "replace" : necessite confirmReplace===true (verifie aussi cote
 *    frontend avec une saisie de confirmation), ET une sauvegarde JSON
 *    automatique de l'etat actuel est prise juste avant la suppression.
 */
router.post('/import', requireAuth, requireRole('admin'), async (req, res, next) => {
  const { mode, confirmReplace, payload } = req.body || {};

  if (!VALID_MODES.includes(mode)) {
    return res.status(400).json({ error: `Mode d'import invalide. Valeurs possibles : ${VALID_MODES.join(', ')}.` });
  }
  if (mode === 'replace' && confirmReplace !== true) {
    return res.status(400).json({
      error: 'Le mode "Remplacer toutes les données" nécessite une confirmation explicite (confirmReplace: true).',
    });
  }

  const { valid, errors } = validateImportPayload(payload);
  if (!valid) {
    return res.status(400).json({
      error: `Le fichier n'est pas valide (${errors.length} problème(s) détecté(s)). Aucune donnée n'a été modifiée.`,
      details: errors,
    });
  }

  let backupPath = null;
  if (mode === 'replace') {
    try {
      backupPath = await backupToJson(pool, 'pre-import-replace');
    } catch (err) {
      console.warn('[import] Sauvegarde pré-remplacement ignorée :', err.message);
    }
  }

  const client = await pool.connect();
  const summary = createSummary();

  try {
    await client.query('BEGIN');

    if (mode === 'replace') {
      await wipeGangsData(client);
    }

    const gangs = Array.isArray(payload.gangs) ? payload.gangs : [];
    await importGangsData(client, gangs, req.user, summary);

    if (Array.isArray(payload.users) && payload.users.length) {
      await importUsersData(client, payload.users, summary);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[import] Échec — transaction annulée, aucune donnée modifiée :', err);
    return res.status(500).json({
      error: "Échec de l'import — la transaction a été annulée, aucune donnée n'a été modifiée.",
      ...(backupPath ? { backupPath } : {}),
    });
  } finally {
    client.release();
  }

  logAction(req.user, 'import', 'system', null, `Import (${mode})`, {
    mode,
    ...summary,
    warnings: summary.warnings.length,
    backupPath,
  }).catch((err) => console.error('[audit] échec:', err.message));

  const freshGangs = await getAllGangsFull();
  const io = req.app.get('io');
  if (io) io.emit('gangs:bulk_update', { gangs: freshGangs, by: req.user.username, mode });

  res.json({
    message: 'Import terminé avec succès.',
    mode,
    summary,
    backupPath,
  });
});

module.exports = router;
