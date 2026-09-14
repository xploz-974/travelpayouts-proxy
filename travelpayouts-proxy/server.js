// Serveur relais Travelpayouts
// ------------------------------------------------------------
// Pourquoi ce serveur existe :
// L'API Travelpayouts (et les autres API réservation) exigent des tokens
// secrets dans chaque requête. Si le navigateur de l'utilisateur appelait
// ces API directement, n'importe qui pourrait lire ces tokens dans l'onglet
// réseau et les utiliser à sa place. Ce petit serveur garde les tokens côté
// serveur (variables d'environnement) et expose à la place des routes
// "propres" que le front (public/index.html) peut appeler sans rien
// connaître des tokens.
//
// Organisation du code : chaque fournisseur (Hotellook/Travelpayouts,
// Duffel, Booking.com) a son propre routeur dans src/routes/, branché
// ci-dessous. La config (tokens, en-têtes communs) est centralisée dans
// src/config.js.
// ------------------------------------------------------------

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import 'dotenv/config';

import { PORT, warnMissingConfig } from './src/config.js';
import { hotelsRouter } from './src/routes/hotels.js';
import { flightsRouter } from './src/routes/flights.js';
import { duffelRouter } from './src/routes/duffel.js';
import { bookingRouter } from './src/routes/booking.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors()); // en production, remplace cors() par cors({origin:'https://ton-domaine.com'})

warnMissingConfig();

// Sert l'application front (public/index.html) sur "/" et ses assets.
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', message: 'Serveur relais Travelpayouts actif' });
});

app.use(hotelsRouter);
app.use(flightsRouter);
app.use(duffelRouter);
app.use(bookingRouter);

app.listen(PORT, () => {
  console.log(`Serveur relais Travelpayouts démarré sur http://localhost:${PORT}`);
});
