import { Router } from 'express';
import { TRAVELPAYOUTS_TOKEN } from '../config.js';

export const flightsRouter = Router();

/**
 * GET /api/flights?origin=PAR&destination=FCO&currency=eur
 * Renvoie les tarifs les moins chers vus récemment sur ce trajet
 * (données Aviasales, pas une recherche en direct seconde par seconde).
 */
flightsRouter.get('/api/flights', async (req, res) => {
  const { origin, destination, currency = 'eur' } = req.query;
  if (!origin || !destination) {
    return res.status(400).json({ error: 'Paramètres "origin" et "destination" requis (codes IATA, ex: PAR, FCO).' });
  }

  try {
    const url = `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=${origin}&destination=${destination}&currency=${currency}&sorting=price&limit=5&token=${TRAVELPAYOUTS_TOKEN}`;
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
