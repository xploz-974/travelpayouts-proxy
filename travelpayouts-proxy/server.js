// Serveur relais Travelpayouts
// ------------------------------------------------------------
// Pourquoi ce serveur existe :
// L'API Travelpayouts exige ton token dans chaque requête. Si le
// navigateur de l'utilisateur appelait l'API directement, n'importe
// qui pourrait lire ce token dans l'onglet réseau et l'utiliser à ta
// place. Ce petit serveur garde le token côté serveur (variable
// d'environnement) et expose à la place deux routes "propres" que
// ton front peut appeler sans rien connaître du token.
// ------------------------------------------------------------

import express from 'express';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors()); // en production, remplace cors() par cors({origin:'https://ton-domaine.com'})

const TOKEN = process.env.TRAVELPAYOUTS_TOKEN;
const PORT = process.env.PORT || 3001;

if (!TOKEN) {
  console.warn('⚠️  TRAVELPAYOUTS_TOKEN manquant dans .env — les appels échoueront.');
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Serveur relais Travelpayouts actif' });
});

/**
 * GET /api/hotels?location=Rome&currency=eur&limit=8
 * 1) Cherche l'identifiant de la ville via l'endpoint "lookup"
 * 2) Récupère les prix moyens observés récemment via l'endpoint "cache"
 */
app.get('/api/hotels', async (req, res) => {
  const { location, currency = 'eur', limit = 8 } = req.query;
  if (!location) return res.status(400).json({ error: 'Paramètre "location" requis (ex: Rome).' });

  // Certaines API (dont Hotellook) bloquent ou répondent différemment aux requêtes
  // sans en-tête User-Agent "normal", en les traitant comme du trafic robot.
  const commonHeaders = { 'User-Agent': 'Mozilla/5.0 (compatible; VoyageurApp/1.0)' };

  try {
    const lookupUrl = `https://engine.hotellook.com/api/v2/lookup.json?query=${encodeURIComponent(location)}&lang=fr&lookFor=city&limit=1`;
    const lookupRes = await fetch(lookupUrl, { headers: commonHeaders });
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

    const cacheUrl = `https://engine.hotellook.com/api/v2/cache.json?location=${encodeURIComponent(city.id)}&currency=${currency}&limit=${limit}&token=${TOKEN}`;
    const cacheRes = await fetch(cacheUrl, { headers: commonHeaders });
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

/**
 * GET /api/flights?origin=PAR&destination=FCO&currency=eur
 * Renvoie les tarifs les moins chers vus récemment sur ce trajet
 * (données Aviasales, pas une recherche en direct seconde par seconde).
 */
app.get('/api/flights', async (req, res) => {
  const { origin, destination, currency = 'eur' } = req.query;
  if (!origin || !destination) {
    return res.status(400).json({ error: 'Paramètres "origin" et "destination" requis (codes IATA, ex: PAR, FCO).' });
  }

  try {
    const url = `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=${origin}&destination=${destination}&currency=${currency}&sorting=price&limit=5&token=${TOKEN}`;
    const apiRes = await fetch(url);
    const data = await apiRes.json();

    const normalized = (data?.data || []).map(f => ({
      price: f.price,
      airline: f.airline,
      departDate: f.departure_at,
      returnDate: f.return_at || null,
      transfers: f.transfers,
      link: `https://www.aviasales.com${f.link}`,
    }));

    res.json({ origin, destination, results: normalized });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des vols.' });
  }
});

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
const DUFFEL_TOKEN = process.env.DUFFEL_API_KEY;
const DUFFEL_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Duffel-Version': 'v2',
  'Authorization': `Bearer ${DUFFEL_TOKEN}`,
};

/**
 * GET /api/duffel-flights?origin=PAR&destination=BKK&date=2027-06-04
 * Vraie recherche de vols (offer request) — plus proche d'un moteur de
 * réservation réel que Travelpayouts, mais nécessite un compte Duffel.
 */
app.get('/api/duffel-flights', async (req, res) => {
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
app.get('/api/duffel-hotels', async (req, res) => {
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
const BOOKING_AFFILIATE_ID = process.env.BOOKING_AFFILIATE_ID;
const BOOKING_API_TOKEN = process.env.BOOKING_API_TOKEN;
const BOOKING_ENV = process.env.BOOKING_ENV === 'production' ? 'production' : 'sandbox';
const BOOKING_BASE_URL = BOOKING_ENV === 'production'
  ? 'https://demandapi.booking.com/3.2'
  : 'https://demandapi-sandbox.booking.com/3.2';

/**
 * GET /api/booking-hotels?lat=41.90&lon=12.49&checkin=2027-06-04&checkout=2027-06-07&adults=2&rooms=1
 */
app.get('/api/booking-hotels', async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`Serveur relais Travelpayouts démarré sur http://localhost:${PORT}`);
});
