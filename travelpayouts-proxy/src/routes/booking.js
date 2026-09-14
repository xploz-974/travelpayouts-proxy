import { Router } from 'express';
import { BOOKING_AFFILIATE_ID, BOOKING_API_TOKEN, BOOKING_ENV, BOOKING_BASE_URL } from '../config.js';

/* ============================ BOOKING.COM DEMAND API ============================
   ⚠️ NE FONCTIONNERA PAS tant que tu n'as pas un accès partenaire Booking.com
   ("Managed Affiliate Partner", contrat signé, identifiants fournis par un
   Account Manager — voir partnerships.booking.com). Ce code est prêt à
   utiliser LE JOUR OÙ tu obtiens BOOKING_AFFILIATE_ID et BOOKING_API_TOKEN,
   construit à partir du vrai schéma officiel (OpenAPI 3.2) fourni par
   l'utilisateur — pas deviné. En attendant, cet endpoint renverra une erreur
   d'authentification, ce qui est normal et attendu.

   Recherche par coordonnées (lat/lon) plutôt que par identifiant de ville
   Booking.com — plus simple, car on a déjà les coordonnées de chaque
   destination dans l'app (pas besoin de résoudre un ID de ville au préalable).
====================================================================================== */

export const bookingRouter = Router();

/**
 * GET /api/booking-hotels?lat=41.90&lon=12.49&checkin=2027-06-04&checkout=2027-06-07&adults=2&rooms=1
 */
bookingRouter.get('/api/booking-hotels', async (req, res) => {
  if (!BOOKING_AFFILIATE_ID || !BOOKING_API_TOKEN) {
    return res.status(500).json({ error: "BOOKING_AFFILIATE_ID / BOOKING_API_TOKEN manquants — nécessite un accès partenaire Booking.com approuvé (voir partnerships.booking.com), pas juste une inscription." });
  }
  const { lat, lon, checkin, checkout, adults = 2, rooms = 1 } = req.query;
  if (!lat || !lon || !checkin || !checkout) {
    return res.status(400).json({ error: 'Paramètres "lat", "lon", "checkin" et "checkout" requis.' });
  }
  try {
    const body = {
      booker: { country: 'fr', platform: 'desktop' },
      checkin,
      checkout,
      coordinates: { latitude: parseFloat(lat), longitude: parseFloat(lon), radius: 5 },
      guests: { number_of_adults: parseInt(adults), number_of_rooms: parseInt(rooms) },
      extras: ['products'],
    };
    const apiRes = await fetch(`${BOOKING_BASE_URL}/accommodations/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BOOKING_API_TOKEN}`,
        'X-Affiliate-Id': BOOKING_AFFILIATE_ID,
      },
      body: JSON.stringify(body),
    });
    const data = await apiRes.json();
    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: data?.message || data?.errors?.[0]?.message || `Erreur Booking.com (${BOOKING_ENV}) — vérifie tes identifiants partenaire.` });
    }
    const results = (data?.data || []).slice(0, 10).map(h => ({
      name: h.name || `Hébergement #${h.id}`,
      price: h.price?.total?.booker_currency,
      currency: h.currency?.booker,
      rating: h.review_score || '—',
      source: 'Booking.com',
      real: true,
    }));
    res.json({ results, environment: BOOKING_ENV });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des hôtels Booking.com.' });
  }
});
