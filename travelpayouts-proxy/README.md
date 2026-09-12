# Serveur relais Travelpayouts

Ce petit serveur protège ton token Travelpayouts : le navigateur de
l'utilisateur appelle ce serveur, et c'est ce serveur — pas le
navigateur — qui appelle l'API Travelpayouts avec ton token secret.

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

Le serveur démarre sur `http://localhost:3001`. Teste-le dans ton
navigateur :

```
http://localhost:3001/api/hotels?location=Rome
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
- Les hôtels viennent de Hotellook : mêmes disponibilités que sur
  Aviasales/Hotellook, pas une recherche multi-plateformes en direct.
- Le plan gratuit de Render/Railway peut mettre le serveur "en
  veille" après une période d'inactivité ; le premier appel après une
  pause peut prendre quelques secondes de plus.
