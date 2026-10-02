import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY } from '../config.js';

/* ============================ ASSISTANT IA (Claude) ============================
   Avant cette route, le front appelait https://api.anthropic.com directement
   depuis le navigateur — ça ne marche que dans le bac à sable d'un artefact
   Claude (qui intercepte l'appel), jamais une fois l'app déployée seule (ici,
   sur Render) : pas de clé, et l'API Anthropic n'autorise de toute façon pas
   les appels directs depuis un navigateur. On passe donc par ce serveur relais,
   avec le SDK Anthropic officiel (clé côté serveur uniquement, jamais exposée
   au navigateur).
================================================================================== */

export const aiRouter = Router();

const MODEL = 'claude-opus-5-5';
const client = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

function extractText(content) {
  return (content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

function cleanErrorMessage(err) {
  return err?.error?.error?.message || err?.message || 'Erreur Claude.';
}

/* La recherche web peut faire tourner plusieurs requêtes côté serveur et
   s'arrêter en pause_turn avant la réponse finale — on relance tant que
   c'est le cas, sinon la réponse revient tronquée. */
async function createMessage(params, resumeOnPause) {
  let response = await client.messages.create(params);
  let messages = params.messages;
  while (resumeOnPause && response.stop_reason === 'pause_turn') {
    messages = [...messages, { role: 'assistant', content: response.content }];
    response = await client.messages.create({ ...params, messages });
  }
  return response;
}

/**
 * POST /api/ai/vision  { imageBase64, mimeType, prompt }
 * Lecture d'une image (passeport, reçu...) — pas de recherche web ici.
 */
aiRouter.post('/api/ai/vision', async (req, res) => {
  if (!client) return res.status(500).json({ error: 'ANTHROPIC_API_KEY manquant dans la config du serveur relais.' });
  const { imageBase64, mimeType, prompt } = req.body || {};
  if (!imageBase64 || !mimeType || !prompt) {
    return res.status(400).json({ error: 'imageBase64, mimeType et prompt sont requis.' });
  }
  try {
    const response = await createMessage({
      model: MODEL,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }, false);
    const text = extractText(response.content);
    if (!text) return res.status(502).json({ error: 'Réponse vide — le contenu a peut-être été filtré.' });
    res.json({ text });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: cleanErrorMessage(err) });
  }
});

/**
 * POST /api/ai/ask  { prompt, useSearch }
 * Question libre ou génération de conseils — useSearch active la recherche
 * web intégrée pour les infos qui changent dans le temps.
 */
aiRouter.post('/api/ai/ask', async (req, res) => {
  if (!client) return res.status(500).json({ error: 'ANTHROPIC_API_KEY manquant dans la config du serveur relais.' });
  const { prompt, useSearch } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt est requis.' });
  try {
    const response = await createMessage({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
      ...(useSearch ? { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }] } : {}),
    }, !!useSearch);
    const text = extractText(response.content);
    if (!text) return res.status(502).json({ error: 'Réponse vide — le contenu a peut-être été filtré.' });
    res.json({ text });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: cleanErrorMessage(err) });
  }
});
