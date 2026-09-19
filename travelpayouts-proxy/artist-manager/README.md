# StageManager — gestion de rendez-vous pour manager d'artiste

Application web mono-fichier (`index.html`), sans backend ni installation,
pour gérer les prestations d'un ou plusieurs artistes : concerts,
showcases, sessions studio, interviews, etc.

## Utilisation

Ouvre simplement `artist-manager/index.html` dans un navigateur (double-clic,
ou `python3 -m http.server` puis `http://localhost:8000`). Aucune
dépendance, aucun compte : toutes les données sont stockées dans le
`localStorage` du navigateur utilisé.

## Fonctionnalités

- **Tableau de bord** : prestations à venir, relances en attente,
  revenus du mois, nombre d'artistes/clients.
- **Rendez-vous** : création, modification, suppression ; filtres par
  artiste, statut (proposé / confirmé / annulé / terminé) et recherche
  texte ; titre, type de prestation, lieu, horaires, cachet, notes.
- **Calendrier** : vue mensuelle, clic sur un jour pour créer un
  rendez-vous à cette date.
- **Artistes** : fiche par artiste géré (genre, contact, notes).
- **Clients / bookers** : fiche par organisateur/salle/contact.
- **Données** : export/import JSON pour sauvegarder ou transférer les
  données, et réinitialisation complète.

## Limites à connaître

- Les données sont locales au navigateur (pas de synchronisation entre
  appareils) : utilise l'export/import JSON pour transférer ou
  sauvegarder.
- Pas d'authentification : à réserver à un usage personnel ou en local.
