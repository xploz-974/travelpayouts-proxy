import { Router } from 'express';
import { AMADEUS_CLIENT_ID, AMADEUS_CLIENT_SECRET, AMADEUS_BASE_URL } from '../config.js';

/* ============================ AMADEUS FOR DEVELOPERS (Hotel Search) ============================
   Contrairement à Booking.com et Agoda (partenariat à négocier, validation
   manuelle), Amadeus for Developers est en libre-service : inscription
   gratuite sur developers.amadeus.com, clé + secret disponibles
   immédiatement (environnement de test, quota limité mais suffisant pour
   comparer quelques hôtels).

   Deux appels nécessaires :
   1) OAuth2 (client credentials) pour un jeton d'accès, mis en cache ici
      (valable ~30 min) pour éviter de le redemander à chaque recherche.
   2) Liste des hôtels autour d'un point (lat/lon), puis leurs offres de prix
      pour les dates données.
====================================================================================================== */

export const amadeusRouter = Router();

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAmadeusToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: AMADEUS_CLIENT_ID,
    client_secret: AMADEUS_CLIENT_SECRET,
  });
  const res = await fetch(`${AMADEUS_BASE_URL}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error_description || 'Authentification Amadeus refusée — vérifie AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET.');
    err.status = res.status;
    throw err;
  }
  cachedToken = data.access_token;
  cachedTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

/**
 * GET /api/amadeus-hotels?lat=13.75&lon=100.5&checkin=2027-06-04&checkout=2027-06-07&adults=2
 */
amadeusRouter.get('/api/amadeus-hotels', async (req, res) => {
  if (!AMADEUS_CLIENT_ID || !AMADEUS_CLIENT_SECRET) {
    return res.status(500).json({ error: 'AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET manquants sur le serveur.' });
  }
  const { lat, lon, checkin, checkout, adults = 2 } = req.query;
  if (!lat || !lon || !checkin || !checkout) {
    return res.status(400).json({ error: 'Paramètres "lat", "lon", "checkin" et "checkout" requis.' });
  }
  try {
    const token = await getAmadeusToken();
    const headers = { Authorization: `Bearer ${token}` };

    const listUrl = `${AMADEUS_BASE_URL}/v1/reference-data/locations/hotels/by-geocode?latitude=${lat}&longitude=${lon}&radius=5&radiusUnit=KM`;
    const listRes = await fetch(listUrl, { headers });
    const listData = await listRes.json();
    if (!listRes.ok) {
      return res.status(listRes.status).json({ error: listData?.errors?.[0]?.detail || 'Erreur Amadeus (liste des hôtels).' });
    }
    const hotelIds = (listData.data || []).slice(0, 10).map(h => h.hotelId).filter(Boolean);
    if (!hotelIds.length) return res.json({ results: [] });

    const offersUrl = `${AMADEUS_BASE_URL}/v3/shopping/hotel-offers?hotelIds=${hotelIds.join(',')}&checkInDate=${checkin}&checkOutDate=${checkout}&adults=${adults}&currency=EUR&bestRateOnly=true`;
    const offersRes = await fetch(offersUrl, { headers });
    const offersData = await offersRes.json();
    if (!offersRes.ok) {
      return res.status(offersRes.status).json({ error: offersData?.errors?.[0]?.detail || 'Erreur Amadeus (offres). Aucune chambre disponible pour ces dates est une réponse fréquente en environnement de test.' });
    }

    const results = (offersData.data || []).slice(0, 10).map(o => ({
      name: o.hotel?.name,
      price: o.offers?.[0]?.price?.total,
      rating: o.hotel?.rating || null,
    }));
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur lors de la récupération des hôtels Amadeus.' });
  }
});
