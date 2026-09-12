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

  try {
    const lookupUrl = `https://engine.hotellook.com/api/v2/lookup.json?query=${encodeURIComponent(location)}&lang=fr&lookFor=city&limit=1`;
    const lookupRes = await fetch(lookupUrl);
    const lookupData = await lookupRes.json();
    const city = lookupData?.results?.locations?.[0];

    if (!city) return res.status(404).json({ error: `Ville "${location}" introuvable côté Hotellook.` });

    const cacheUrl = `https://engine.hotellook.com/api/v2/cache.json?location=${encodeURIComponent(city.id)}&currency=${currency}&limit=${limit}&token=${TOKEN}`;
    const cacheRes = await fetch(cacheUrl);
    const hotels = await cacheRes.json();

    const normalized = (Array.isArray(hotels) ? hotels : []).map(h => ({
      name: h.hotelName,
      price: Math.round(h.priceAvg || h.priceFrom || 0),
      rating: h.stars ? h.stars.toFixed(1) : '—',
      source: 'Hotellook',
      real: true,
    }));

    res.json({ city: city.fullName, results: normalized });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération des hôtels.' });
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

app.listen(PORT, () => {
  console.log(`Serveur relais Travelpayouts démarré sur http://localhost:${PORT}`);
});
