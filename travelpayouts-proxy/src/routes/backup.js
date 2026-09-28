import { Router } from 'express';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } from '../config.js';

/* ============================ SAUVEGARDE CLOUD (Cloudflare R2) ============================
   Stocke le dossier de voyage complet (state) dans un bucket R2 — compatible S3 — pour
   pouvoir le récupérer depuis n'importe quel appareil, en plus de la sauvegarde locale
   (localStorage / window.storage) qui reste propre à CET appareil/navigateur.

   Chaque sauvegarde est un objet JSON { label, date, data }, rangé sous la clé
   "backups/<date ISO>__<label nettoyé>.json" — label et date sont encodés dans le nom
   pour pouvoir lister l'historique sans télécharger chaque fichier un par un.
================================================================================================ */

const r2Configured = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME);

const s3 = r2Configured ? new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
}) : null;

function slugify(s) {
  return (s || 'sauvegarde')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'sauvegarde';
}

function notConfigured(res) {
  return res.status(500).json({ error: 'Sauvegarde cloud non configurée — variables R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME manquantes côté serveur relais.' });
}

export const backupRouter = Router();

/**
 * POST /api/backup  { label?: string, data: object }
 * Envoie une nouvelle sauvegarde vers R2.
 */
backupRouter.post('/api/backup', async (req, res) => {
  if (!r2Configured) return notConfigured(res);
  const { label, data } = req.body || {};
  if (!data) return res.status(400).json({ error: 'Corps de requête invalide : "data" (le dossier de voyage) est requis.' });
  const date = new Date().toISOString();
  const key = `backups/${date}__${slugify(label)}.json`;
  try {
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: JSON.stringify({ label: label || 'Sauvegarde', date, data }),
      ContentType: 'application/json',
    }));
    res.json({ ok: true, key, date });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'envoi vers Cloudflare R2 — vérifie les identifiants et le nom du bucket." });
  }
});

/**
 * GET /api/backup/list
 * Liste les sauvegardes disponibles (les plus récentes en premier), sans leur contenu.
 */
backupRouter.get('/api/backup/list', async (req, res) => {
  if (!r2Configured) return notConfigured(res);
  try {
    const out = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET_NAME, Prefix: 'backups/' }));
    const items = (out.Contents || []).map(o => {
      const m = o.Key.match(/^backups\/(.+?)__(.+)\.json$/);
      return {
        key: o.Key,
        date: m ? m[1] : (o.LastModified ? new Date(o.LastModified).toISOString() : ''),
        label: m ? m[2].replace(/-/g, ' ') : o.Key,
      };
    }).sort((a, b) => b.date.localeCompare(a.date));
    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la liste des sauvegardes Cloudflare R2 — vérifie les identifiants et le nom du bucket.' });
  }
});

/**
 * GET /api/backup/get?key=backups/...json
 * Récupère le contenu complet d'une sauvegarde précise.
 */
backupRouter.get('/api/backup/get', async (req, res) => {
  if (!r2Configured) return notConfigured(res);
  const { key } = req.query;
  if (!key || !key.startsWith('backups/')) return res.status(400).json({ error: 'Paramètre "key" invalide.' });
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    const text = await out.Body.transformToString();
    res.type('application/json').send(text);
  } catch (err) {
    console.error(err);
    res.status(404).json({ error: 'Sauvegarde introuvable sur Cloudflare R2.' });
  }
});
