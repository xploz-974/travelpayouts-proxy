import { Router } from 'express';
import { GEMINI_API_KEY } from '../config.js';

/* ============================ ASSISTANT IA (Gemini) ============================
   Avant cette route, le front appelait https://api.anthropic.com directement
   depuis le navigateur — ça ne marche que dans le bac à sable d'un artefact
   Claude (qui intercepte l'appel), jamais une fois l'app déployée seule (ici,
   sur Render) : pas de clé, et l'API Anthropic n'autorise de toute façon pas
   les appels directs depuis un navigateur. On passe donc par ce serveur relais,
   avec Gemini (clé côté serveur uniquement, jamais exposée au navigateur).
================================================================================== */

export const aiRouter = Router();

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function callGemini({ parts, useSearch }) {
  if (!GEMINI_API_KEY) {
    const err = new Error('GEMINI_API_KEY manquant dans la config du serveur relais.');
    err.status = 500;
    throw err;
  }
  const body = { contents: [{ role: 'user', parts }] };
  if (useSearch) body.tools = [{ googleSearch: {} }];

  const apiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await apiRes.json();
  if (!apiRes.ok) {
    const err = new Error(data?.error?.message || `Erreur Gemini (code ${apiRes.status}).`);
    err.status = apiRes.status;
    throw err;
  }
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map(p => p.text || '')
    .join('')
    .trim();
  if (!text) {
    const err = new Error('Réponse Gemini vide — le contenu a peut-être été filtré.');
    err.status = 502;
    throw err;
  }
  return text;
}

/**
 * POST /api/ai/vision  { imageBase64, mimeType, prompt }
 * Lecture d'une image (passeport, reçu...) — pas de recherche web ici.
 */
aiRouter.post('/api/ai/vision', async (req, res) => {
  const { imageBase64, mimeType, prompt } = req.body || {};
  if (!imageBase64 || !mimeType || !prompt) {
    return res.status(400).json({ error: 'imageBase64, mimeType et prompt sont requis.' });
  }
  try {
    const text = await callGemini({
      parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: prompt }],
    });
    res.json({ text });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /api/ai/ask  { prompt, useSearch }
 * Question libre ou génération de conseils — useSearch active la recherche
 * Google intégrée à Gemini pour les infos qui changent dans le temps.
 */
aiRouter.post('/api/ai/ask', async (req, res) => {
  const { prompt, useSearch } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt est requis.' });
  try {
    const text = await callGemini({ parts: [{ text: prompt }], useSearch: !!useSearch });
    res.json({ text });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
});
