# Savora

Recettes → semaine → frigo → liste de courses par rayon. PWA mobile-first, API FastAPI.

## Lancer
```bash
python -m venv .venv && . .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --app-dir backend --reload   # http://localhost:8000
pytest -q tests
```
Base : SQLite par défaut ; PostgreSQL via `DATABASE_URL=postgresql+psycopg://…`.

## État
- Fait : import de recettes (URL JSON-LD / texte), mise à l'échelle, normalisation des unités,
  planning, frigo + suggestions anti-gaspi, liste de courses (requis − stock) par rayon.
- À faire : comparateur de prix (tables `stores` / `store_products` prêtes), promos des prospectus
  numériques (dealrun.re), automation Playwright des Drive, comptes utilisateurs.
