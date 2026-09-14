# Voyageur — app + serveur relais

Ce dépôt contient deux choses :

- **`public/index.html`** : l'application de planification de voyage
  (front-end, une seule page HTML/CSS/JS).
- **`server.js` + `src/`** : le serveur relais qui protège tes tokens
  d'API (Travelpayouts, Duffel, Booking.com). Le navigateur de
  l'utilisateur appelle ce serveur, et c'est ce serveur — pas le
  navigateur — qui appelle les API externes avec les tokens secrets.

Le serveur sert aussi l'application : une fois lancé, ouvre simplement
`http://localhost:3001` pour l'utiliser.

## Structure du code serveur

```
server.js            point d'entrée : branche les routeurs, sert public/
src/config.js         lecture centralisée des variables d'environnement
src/routes/hotels.js  GET /api/hotels        (Hotellook — voir note ci-dessous)
src/routes/flights.js GET /api/flights       (Travelpayouts/Aviasales)
src/routes/duffel.js  GET /api/duffel-flights, /api/duffel-hotels
src/routes/booking.js GET /api/booking-hotels
```

> ⚠️ **Hotellook a fermé le 20 octobre 2025** (confirmé par
> Travelpayouts) : la route `/api/hotels` répondra donc en erreur. Le
> front-end n'appelle déjà plus cette route — utilise
> `/api/duffel-hotels` ou `/api/booking-hotels` à la place.

## 1. Récupérer ton token

Sur https://app.travelpayouts.com/dashboard → section **Outils > API**
(ou **Développeurs**), copie ton token.

## 2. Installer et lancer en local (pour tester)

```bash
cd travelpayouts-proxy
npm install
cp .env.example .env
# ouvre .env et colle ton token à la place de "colle_ton_token_ici"
npm start
```

Le serveur démarre sur `http://localhost:3001` et sert directement
l'application. Teste aussi les routes d'API dans ton navigateur :

```
http://localhost:3001/api/status
http://localhost:3001/api/flights?origin=PAR&destination=FCO
```

## 3. Le rendre accessible depuis le prototype (déploiement gratuit)

Tant que le serveur tourne uniquement sur `localhost`, seul ton propre
ordinateur peut l'appeler. Pour que le prototype (ouvert dans un
navigateur, potentiellement sur un autre appareil) puisse l'utiliser,
déploie-le gratuitement sur une des plateformes suivantes :

- **Render.com** (plan gratuit) : crée un "Web Service", connecte ce
  dossier (ou un dépôt GitHub qui le contient), ajoute
  `TRAVELPAYOUTS_TOKEN` dans l'onglet Environment, et Render te donne
  une URL du type `https://ton-service.onrender.com`.
- **Railway.app** : fonctionnement similaire, plan gratuit avec
  quelques heures d'exécution par mois.
- **Vercel** (via une fonction serverless) : demande d'adapter
  légèrement le code (une fonction par route plutôt qu'un serveur
  Express classique), mais reste gratuit pour un usage personnel.

## 4. Brancher l'URL dans le prototype

Une fois le serveur en ligne, copie son URL (ex.
`https://ton-service.onrender.com`) dans le prototype de
planification de voyage, via le bouton **⚙ Paramètres** en haut de
l'écran, champ "Adresse du serveur relais".

## Limites à connaître

- Les prix de vols viennent de `prices_for_dates` : ce sont les
  tarifs les moins chers **vus récemment** sur ce trajet, pas une
  recherche en direct seconde par seconde.
- Hotellook (`/api/hotels`) a fermé le 20 octobre 2025 : cette route
  est conservée pour compatibilité mais renverra une erreur. Utilise
  Duffel Stays ou Booking.com pour les hôtels.
- Duffel Stays nécessite une autorisation spécifique
  (stays@duffel.com) et Booking.com un accès partenaire approuvé
  (partnerships.booking.com) — sans ces accès, ces routes renvoient
  une erreur claire plutôt qu'un plantage.
- Le plan gratuit de Render/Railway peut mettre le serveur "en
  veille" après une période d'inactivité ; le premier appel après une
  pause peut prendre quelques secondes de plus.
