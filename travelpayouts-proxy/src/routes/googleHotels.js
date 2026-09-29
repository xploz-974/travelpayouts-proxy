import { Router } from 'express';
import { SERPAPI_KEY } from '../config.js';

/* ============================ GOOGLE HOTELS (SerpApi) ============================
   SerpApi n'a pas d'API "Google Hotels" officielle gratuite illimitée : le plan
   gratuit est limité à un quota mensuel de recherches (voir compte SerpApi).
   On expose donc aussi /api/google-hotels/quota (compte SerpApi lui-même, pas un
   compteur local approximatif) pour que le front affiche un compteur discret et
   évite les mauvaises surprises en fin de mois.
======================================================================================= */

export const googleHotelsRouter = Router();

googleHotelsRouter.get('/api/google-hotels', async (req, res) => {
  const { query, checkin, checkout } = req.query;
  if (!SERPAPI_KEY) {
    return res.status(500).json({ error: 'SERPAPI_KEY manquant dans la config du serveur relais.' });
  }
  if (!query || !checkin || !checkout) {
    return res.status(400).json({ error: 'Paramètres "query", "checkin" et "checkout" requis.' });
  }
  try {
    const url = `https://serpapi.com/search.json?engine=google_hotels&q=${encodeURIComponent(query)}&check_in_date=${checkin}&check_out_date=${checkout}&currency=EUR&hl=fr&gl=fr&api_key=${SERPAPI_KEY}`;
    const apiRes = await fetch(url);
    const data = await apiRes.json();
    if (!apiRes.ok || data.error) {
      return res.status(apiRes.status || 500).json({ error: data.error || `Erreur SerpApi (code ${apiRes.status}).` });
    }
    const results = (data.properties || []).slice(0, 10).map(p => ({
      name: p.name,
      price: (p.rate_per_night?.extracted_lowest) ?? (p.total_rate?.extracted_lowest) ?? 0,
      rating: p.overall_rating || null,
      reviews: p.reviews || null,
      image: p.images?.[0]?.thumbnail || null,
      url: p.link || null,
    }));
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la recherche Google Hotels.' });
  }
});

googleHotelsRouter.get('/api/google-hotels/quota', async (req, res) => {
  if (!SERPAPI_KEY) {
    return res.status(500).json({ error: 'SERPAPI_KEY manquant dans la config du serveur relais.' });
  }
  try {
    const apiRes = await fetch(`https://serpapi.com/account.json?api_key=${SERPAPI_KEY}`);
    const data = await apiRes.json();
    if (!apiRes.ok || data.error) {
      return res.status(apiRes.status || 500).json({ error: data.error || `Erreur SerpApi (code ${apiRes.status}).` });
    }
    res.json({
      searchesPerMonth: data.plan_searches_left != null && data.searches_per_month != null
        ? data.searches_per_month
        : null,
      searchesLeft: data.plan_searches_left ?? data.total_searches_left ?? null,
      thisMonthUsage: data.this_month_usage ?? null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Impossible de récupérer le quota SerpApi.' });
  }
});
