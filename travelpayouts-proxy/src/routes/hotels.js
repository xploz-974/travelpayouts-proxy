import { Router } from 'express';
import { TRAVELPAYOUTS_TOKEN, COMMON_HEADERS } from '../config.js';

export const hotelsRouter = Router();

/**
 * GET /api/hotels?location=Rome&currency=eur&limit=8
 * 1) Cherche l'identifiant de la ville via l'endpoint "lookup"
 * 2) Récupère les prix moyens observés récemment via l'endpoint "cache"
 */
hotelsRouter.get('/api/hotels', async (req, res) => {
  const { location, currency = 'eur', limit = 8 } = req.query;
  if (!location) return res.status(400).json({ error: 'Paramètre "location" requis (ex: Rome).' });

  try {
    const lookupUrl = `https://engine.hotellook.com/api/v2/lookup.json?query=${encodeURIComponent(location)}&lang=fr&lookFor=city&limit=1`;
    const lookupRes = await fetch(lookupUrl, { headers: COMMON_HEADERS });
    const lookupText = await lookupRes.text();
    if (!lookupRes.ok) {
      console.error('Hotellook lookup a échoué :', lookupRes.status, lookupText.slice(0, 300));
      return res.status(502).json({ error: `Hotellook (lookup) a répondu avec le code ${lookupRes.status}.`, detail: lookupText.slice(0, 300) });
    }
    let lookupData;
    try { lookupData = JSON.parse(lookupText); }
    catch(e){ return res.status(502).json({ error: 'Hotellook (lookup) n\'a pas renvoyé du JSON valide — probablement bloqué ou en maintenance.', detail: lookupText.slice(0, 300) }); }

    const city = lookupData?.results?.locations?.[0];
    if (!city) return res.status(404).json({ error: `Ville "${location}" introuvable côté Hotellook.`, detail: JSON.stringify(lookupData).slice(0, 300) });

    const cacheUrl = `https://engine.hotellook.com/api/v2/cache.json?location=${encodeURIComponent(city.id)}&currency=${currency}&limit=${limit}&token=${TRAVELPAYOUTS_TOKEN}`;
    const cacheRes = await fetch(cacheUrl, { headers: COMMON_HEADERS });
    const cacheText = await cacheRes.text();
    if (!cacheRes.ok) {
      console.error('Hotellook cache a échoué :', cacheRes.status, cacheText.slice(0, 300));
      return res.status(502).json({ error: `Hotellook (prix) a répondu avec le code ${cacheRes.status}.`, detail: cacheText.slice(0, 300) });
    }
    let hotels;
    try { hotels = JSON.parse(cacheText); }
    catch(e){ return res.status(502).json({ error: 'Hotellook (prix) n\'a pas renvoyé du JSON valide.', detail: cacheText.slice(0, 300) }); }

    if (!Array.isArray(hotels)) {
      // Hotellook renvoie parfois un objet (ex: {"error":"..."}) plutôt qu'un tableau vide
      console.error('Réponse Hotellook inattendue :', JSON.stringify(hotels).slice(0, 300));
      return res.status(502).json({ error: 'Hotellook a renvoyé une réponse inattendue (pas de liste d\'hôtels).', detail: JSON.stringify(hotels).slice(0, 300) });
    }

    const normalized = hotels.map(h => ({
      name: h.hotelName,
      price: Math.round(h.priceAvg || h.priceFrom || 0),
      rating: h.stars ? h.stars.toFixed(1) : '—',
      source: 'Hotellook',
      real: true,
    }));

    res.json({ city: city.fullName, results: normalized });
  } catch (err) {
    console.error('Erreur inattendue /api/hotels :', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des hôtels.', detail: String(err.message || err) });
  }
});
