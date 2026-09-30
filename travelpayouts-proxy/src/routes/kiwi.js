import { Router } from 'express';
import { KIWI_API_KEY } from '../config.js';

/* ============================ KIWI.COM (Tequila API) ============================
   Troisième source de prix de vols réels, à côté de Travelpayouts et Duffel.
   Nécessite une clé sur partners.kiwi.com (inscription plus simple qu'un
   partenariat Booking.com, pas de volume d'affaires minimum requis).
====================================================================================== */

export const kiwiRouter = Router();

function toKiwiDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * GET /api/kiwi-flights?origin=RUN&destination=BKK&date=2027-06-25
 */
kiwiRouter.get('/api/kiwi-flights', async (req, res) => {
  if (!KIWI_API_KEY) return res.status(500).json({ error: 'KIWI_API_KEY manquant sur le serveur.' });
  const { origin, destination, date } = req.query;
  if (!origin || !destination || !date) {
    return res.status(400).json({ error: 'Paramètres "origin", "destination" et "date" (AAAA-MM-JJ) requis.' });
  }
  try {
    const kiwiDate = toKiwiDate(date);
    const url = `https://api.tequila.kiwi.com/v2/search?fly_from=${origin}&fly_to=${destination}&date_from=${kiwiDate}&date_to=${kiwiDate}&curr=EUR&limit=5&sort=price`;
    const apiRes = await fetch(url, { headers: { apikey: KIWI_API_KEY } });
    const data = await apiRes.json();
    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: data?.error || `Erreur Kiwi.com (code ${apiRes.status}).` });
    }
    const results = (data?.data || []).slice(0, 5).map(f => ({
      price: f.price,
      currency: 'EUR',
      airline: (f.airlines || [])[0] || null,
      departDate: f.local_departure,
      duration: f.duration?.departure || null,
    }));
    res.json({ origin, destination, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des vols Kiwi.com.' });
  }
});
