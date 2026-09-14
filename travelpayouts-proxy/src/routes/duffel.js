import { Router } from 'express';
import { DUFFEL_TOKEN, DUFFEL_HEADERS } from '../config.js';

/* ============================ DUFFEL (vols + hôtels) ============================
   Duffel demande un compte (gratuit pour tester) sur duffel.com. Une fois inscrit,
   Dashboard → "Access tokens" → copie le token de TEST (il commence par
   "duffel_test_..."). Aucune carte bancaire requise pour tester.

   IMPORTANT — deux limites à connaître avant de t'appuyer dessus :
   1) Les VOLS fonctionnent en test dès l'inscription (résultats de démonstration
      réalistes, pas les vrais prix du jour tant que le compte n'est pas validé
      en production par Duffel).
   2) Les HÔTELS (Stays) sont en accès restreint chez Duffel : au moment de
      l'écriture de ce code, il faut leur écrire à stays@duffel.com pour obtenir
      l'autorisation, même avec un token de test. Sans cette autorisation,
      /api/duffel-hotels renverra probablement une erreur d'accès refusé — ce
      n'est pas un bug de ce serveur, c'est une restriction du côté de Duffel.
====================================================================================== */

export const duffelRouter = Router();

/**
 * GET /api/duffel-flights?origin=PAR&destination=BKK&date=2027-06-04
 * Vraie recherche de vols (offer request) — plus proche d'un moteur de
 * réservation réel que Travelpayouts, mais nécessite un compte Duffel.
 */
duffelRouter.get('/api/duffel-flights', async (req, res) => {
  if (!DUFFEL_TOKEN) return res.status(500).json({ error: 'DUFFEL_API_KEY manquant sur le serveur.' });
  const { origin, destination, date } = req.query;
  if (!origin || !destination || !date) {
    return res.status(400).json({ error: 'Paramètres "origin", "destination" et "date" (AAAA-MM-JJ) requis.' });
  }
  try {
    const body = {
      data: {
        slices: [{ origin, destination, departure_date: date }],
        passengers: [{ type: 'adult' }],
        cabin_class: 'economy',
      },
    };
    const apiRes = await fetch('https://api.duffel.com/air/offer_requests?return_offers=true', {
      method: 'POST',
      headers: DUFFEL_HEADERS,
      body: JSON.stringify(body),
    });
    const data = await apiRes.json();
    if (!apiRes.ok) return res.status(apiRes.status).json({ error: data?.errors?.[0]?.message || 'Erreur Duffel.' });

    const offers = (data?.data?.offers || []).slice(0, 5).map(o => ({
      price: o.total_amount,
      currency: o.total_currency,
      airline: o.owner?.name,
      departDate: o.slices?.[0]?.segments?.[0]?.departing_at,
      duration: o.slices?.[0]?.duration,
    }));
    res.json({ origin, destination, results: offers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des vols Duffel.' });
  }
});

/**
 * GET /api/duffel-hotels?lat=13.75&lon=100.5&checkin=2027-06-04&checkout=2027-06-07
 * Voir l'avertissement en haut de section : nécessite l'autorisation Duffel Stays.
 */
duffelRouter.get('/api/duffel-hotels', async (req, res) => {
  if (!DUFFEL_TOKEN) return res.status(500).json({ error: 'DUFFEL_API_KEY manquant sur le serveur.' });
  const { lat, lon, checkin, checkout } = req.query;
  if (!lat || !lon || !checkin || !checkout) {
    return res.status(400).json({ error: 'Paramètres "lat", "lon", "checkin" et "checkout" requis.' });
  }
  try {
    const body = {
      data: {
        rooms: 1,
        guests: [{ type: 'adult' }],
        location: { radius: 5, geographic_coordinates: { latitude: parseFloat(lat), longitude: parseFloat(lon) } },
        check_in_date: checkin,
        check_out_date: checkout,
      },
    };
    const apiRes = await fetch('https://api.duffel.com/stays/search', {
      method: 'POST',
      headers: DUFFEL_HEADERS,
      body: JSON.stringify(body),
    });
    const data = await apiRes.json();
    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: data?.errors?.[0]?.message || "Erreur Duffel Stays (accès probablement restreint — voir stays@duffel.com)." });
    }
    const results = (data?.data?.results || []).slice(0, 10).map(r => ({
      name: r.accommodation?.name,
      price: r.cheapest_rate_total_amount,
      currency: r.cheapest_rate_currency,
      rating: r.accommodation?.rating || '—',
      source: 'Duffel Stays',
      real: true,
    }));
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des hôtels Duffel.' });
  }
});
