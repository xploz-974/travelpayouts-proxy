// Configuration centralisée : lit les variables d'environnement une seule
// fois et les expose au reste de l'app.

export const PORT = process.env.PORT || 3001;

export const TRAVELPAYOUTS_TOKEN = process.env.TRAVELPAYOUTS_TOKEN;

export const DUFFEL_TOKEN = process.env.DUFFEL_API_KEY;
export const DUFFEL_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Duffel-Version': 'v2',
  'Authorization': `Bearer ${DUFFEL_TOKEN}`,
};

export const BOOKING_AFFILIATE_ID = process.env.BOOKING_AFFILIATE_ID;
export const BOOKING_API_TOKEN = process.env.BOOKING_API_TOKEN;
export const BOOKING_ENV = process.env.BOOKING_ENV === 'production' ? 'production' : 'sandbox';
export const BOOKING_BASE_URL = BOOKING_ENV === 'production'
  ? 'https://demandapi.booking.com/3.2'
  : 'https://demandapi-sandbox.booking.com/3.2';

// Certaines API (dont Hotellook) bloquent ou répondent différemment aux
// requêtes sans en-tête User-Agent "normal", en les traitant comme du
// trafic robot.
export const COMMON_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; VoyageurApp/1.0)' };

export function warnMissingConfig() {
  if (!TRAVELPAYOUTS_TOKEN) {
    console.warn('⚠️  TRAVELPAYOUTS_TOKEN manquant dans .env — /api/hotels et /api/flights échoueront.');
  }
  if (!DUFFEL_TOKEN) {
    console.warn('⚠️  DUFFEL_API_KEY manquant dans .env — /api/duffel-flights et /api/duffel-hotels échoueront.');
  }
  if (!BOOKING_AFFILIATE_ID || !BOOKING_API_TOKEN) {
    console.warn('⚠️  BOOKING_AFFILIATE_ID / BOOKING_API_TOKEN manquants dans .env — /api/booking-hotels échouera.');
  }
}
