from contextlib import asynccontextmanager
from datetime import date, timedelta
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import services
from .db import Base, engine, get_db
from .importer import ImportError_, RawRecipe, fetch_recipe, parse_text
from .ingredients import AISLE_LABELS, AISLE_ORDER, canon, guess_aisle, parse_ingredient
from .models import PantryItem, PlanEntry, Recipe, RecipeIngredient, Setting, ShoppingItem

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="Savora", lifespan=lifespan)


# ---------- schémas ---------------------------------------------------------------
class ImportIn(BaseModel):
    url: str | None = None
    text: str | None = None


class SettingsIn(BaseModel):
    household_size: int = Field(ge=1, le=20)


class PlanIn(BaseModel):
    recipe_id: int
    day: date
    slot: str = Field("dinner", pattern="^(lunch|dinner)$")
    servings: int | None = Field(None, ge=1, le=50)


class PantryIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    quantity: float = Field(1, ge=0)
    unit: str = Field("piece", pattern="^(g|ml|piece)$")
    storage: str = Field("fridge", pattern="^(fridge|freezer|pantry)$")
    expires_on: date | None = None


class ManualItemIn(BaseModel):
    text: str = Field(min_length=1, max_length=200)


class CheckIn(BaseModel):
    checked: bool


# ---------- helpers ---------------------------------------------------------------
def recipe_out(r: Recipe, servings: int | None = None, full: bool = True) -> dict:
    target = servings or r.base_servings
    out = {
        "id": r.id, "title": r.title, "image_url": r.image_url, "source_url": r.source_url,
        "base_servings": r.base_servings, "servings": target, "favorite": r.favorite,
        "prep_minutes": r.prep_minutes, "cook_minutes": r.cook_minutes, "tags": r.tags,
        "ingredient_count": len(r.ingredients),
    }
    if full:
        out["instructions"] = r.instructions
        out["ingredients"] = [{
            "id": i.id, "name": i.name, "raw": i.raw, "aisle": i.aisle, "staple": i.staple,
            "unit": i.unit, "quantity": (q := services.scale(i.quantity, r.base_servings, target)),
            "label": services.pretty_qty(q, i.unit),
        } for i in r.ingredients]
    return out


def save_recipe(db: Session, raw: RawRecipe) -> Recipe:
    r = Recipe(
        title=raw.title[:200], source_url=raw.source_url, image_url=raw.image,
        base_servings=raw.servings, prep_minutes=raw.prep_minutes, cook_minutes=raw.cook_minutes,
        instructions=raw.instructions,
    )
    for pos, line in enumerate(raw.ingredients):
        p = parse_ingredient(line)
        r.ingredients.append(RecipeIngredient(
            position=pos, raw=p.raw[:300], name=p.name[:150], quantity=p.quantity,
            unit=p.unit, aisle=p.aisle, staple=p.staple,
        ))
    db.add(r)
    db.commit()
    return r


def _get_recipe(db: Session, rid: int) -> Recipe:
    r = db.get(Recipe, rid)
    if not r:
        raise HTTPException(404, "Recette introuvable")
    return r


# ---------- foyer ----------------------------------------------------------------
@app.get("/api/settings")
def get_settings(db: Session = Depends(get_db)):
    return {"household_size": services.get_household_size(db)}


@app.put("/api/settings")
def put_settings(body: SettingsIn, db: Session = Depends(get_db)):
    s = db.get(Setting, "household_size") or Setting(key="household_size", value="4")
    s.value = str(body.household_size)
    db.add(s)
    db.commit()
    return {"household_size": body.household_size}


# ---------- recettes -------------------------------------------------------------
@app.post("/api/recipes/import", status_code=201)
def import_recipe(body: ImportIn, db: Session = Depends(get_db)):
    try:
        if body.url and body.url.strip():
            raw = fetch_recipe(body.url.strip())
        elif body.text and body.text.strip():
            raw = parse_text(body.text)
        else:
            raise ImportError_("Colle un lien ou le texte d'une recette.")
    except ImportError_ as e:
        raise HTTPException(422, str(e)) from e
    return recipe_out(save_recipe(db, raw))


@app.get("/api/recipes")
def list_recipes(db: Session = Depends(get_db)):
    rows = db.scalars(select(Recipe).order_by(Recipe.created_at.desc())).all()
    return [recipe_out(r, full=False) for r in rows]


@app.get("/api/recipes/{rid}")
def get_recipe(rid: int, servings: int | None = None, db: Session = Depends(get_db)):
    return recipe_out(_get_recipe(db, rid), servings or services.get_household_size(db))


@app.post("/api/recipes/{rid}/favorite")
def toggle_favorite(rid: int, db: Session = Depends(get_db)):
    r = _get_recipe(db, rid)
    r.favorite = not r.favorite
    db.commit()
    return {"favorite": r.favorite}


@app.delete("/api/recipes/{rid}", status_code=204)
def delete_recipe(rid: int, db: Session = Depends(get_db)):
    db.delete(_get_recipe(db, rid))
    db.commit()


# ---------- planning -------------------------------------------------------------
@app.get("/api/plan")
def get_plan(start: date | None = None, db: Session = Depends(get_db)):
    start = services.week_start(start or date.today())
    end = start + timedelta(days=6)
    rows = db.scalars(select(PlanEntry).where(PlanEntry.day >= start, PlanEntry.day <= end)
                      .order_by(PlanEntry.day, PlanEntry.slot)).all()
    return {"start": start, "end": end, "entries": [{
        "id": e.id, "day": e.day, "slot": e.slot, "servings": e.servings,
        "recipe": recipe_out(e.recipe, full=False),
    } for e in rows]}


@app.post("/api/plan", status_code=201)
def add_plan(body: PlanIn, db: Session = Depends(get_db)):
    r = _get_recipe(db, body.recipe_id)
    e = PlanEntry(recipe_id=r.id, day=body.day, slot=body.slot,
                  servings=body.servings or services.get_household_size(db))
    db.add(e)
    db.commit()
    return {"id": e.id}


@app.delete("/api/plan/{eid}", status_code=204)
def del_plan(eid: int, db: Session = Depends(get_db)):
    e = db.get(PlanEntry, eid)
    if e:
        db.delete(e)
        db.commit()


# ---------- frigo / placards -----------------------------------------------------
def pantry_out(p: PantryItem) -> dict:
    days = (p.expires_on - date.today()).days if p.expires_on else None
    return {"id": p.id, "name": p.name, "quantity": p.quantity, "unit": p.unit,
            "label": services.pretty_qty(p.quantity, p.unit), "storage": p.storage,
            "aisle": p.aisle, "expires_on": p.expires_on, "days_left": days}


@app.get("/api/pantry")
def list_pantry(db: Session = Depends(get_db)):
    rows = db.scalars(select(PantryItem)).all()
    rows.sort(key=lambda p: (p.expires_on is None, p.expires_on or date.max, p.name.lower()))
    return [pantry_out(p) for p in rows]


@app.post("/api/pantry", status_code=201)
def add_pantry(body: PantryIn, db: Session = Depends(get_db)):
    p = PantryItem(name=body.name.strip().capitalize(), quantity=body.quantity, unit=body.unit,
                   storage=body.storage, expires_on=body.expires_on, aisle=guess_aisle(body.name))
    db.add(p)
    db.commit()
    return pantry_out(p)


@app.delete("/api/pantry/{pid}", status_code=204)
def del_pantry(pid: int, db: Session = Depends(get_db)):
    p = db.get(PantryItem, pid)
    if p:
        db.delete(p)
        db.commit()


@app.get("/api/pantry/suggestions")
def anti_waste(db: Session = Depends(get_db)):
    """Recettes classées selon la part d'ingrédients du frigo, en priorité ceux qui expirent bientôt."""
    soon = date.today() + timedelta(days=4)
    stock = db.scalars(select(PantryItem)).all()
    stock_keys = {canon(p.name): p for p in stock}
    out = []
    for r in db.scalars(select(Recipe)).all():
        real = [i for i in r.ingredients if not i.staple]
        if not real:
            continue
        hits, urgent = [], []
        for i in real:
            k = canon(i.name)
            for sk, p in stock_keys.items():
                if services._same_ingredient(k, sk):
                    hits.append(i.name)
                    if p.expires_on and p.expires_on <= soon:
                        urgent.append(p.name)
                    break
        if hits:
            out.append({"recipe": recipe_out(r, full=False), "covered": len(hits), "total": len(real),
                        "urgent": sorted(set(urgent)), "score": len(urgent) * 3 + len(hits) / len(real)})
    out.sort(key=lambda x: -x["score"])
    return out[:6]


# ---------- liste de courses -----------------------------------------------------
@app.post("/api/shopping/generate")
def generate(start: date | None = None, db: Session = Depends(get_db)):
    s = services.week_start(start or date.today())
    services.regenerate_list(db, s, s + timedelta(days=6))
    return shopping(db)


@app.get("/api/shopping")
def shopping(db: Session = Depends(get_db)):
    groups = services.grouped_list(db)
    total = sum(len(g["items"]) for g in groups)
    done = sum(1 for g in groups for i in g["items"] if i["checked"])
    return {"groups": groups, "total": total, "done": done}


@app.post("/api/shopping/manual", status_code=201)
def add_manual(body: ManualItemIn, db: Session = Depends(get_db)):
    p = parse_ingredient(body.text)
    key = canon(p.name)
    existing = db.scalar(select(ShoppingItem).where(
        ShoppingItem.key == key, ShoppingItem.unit == p.unit, ShoppingItem.origin == "manual"))
    if existing and p.quantity is not None and existing.quantity is not None:
        existing.quantity += p.quantity
    else:
        db.add(ShoppingItem(key=key, name=p.name, quantity=p.quantity, unit=p.unit,
                            aisle=p.aisle, origin="manual"))
    db.commit()
    return shopping(db)


@app.patch("/api/shopping/{iid}")
def check_item(iid: int, body: CheckIn, db: Session = Depends(get_db)):
    i = db.get(ShoppingItem, iid)
    if not i:
        raise HTTPException(404)
    i.checked = body.checked
    db.commit()
    return {"ok": True}


@app.delete("/api/shopping/{iid}", status_code=204)
def del_item(iid: int, db: Session = Depends(get_db)):
    i = db.get(ShoppingItem, iid)
    if i:
        db.delete(i)
        db.commit()


@app.post("/api/shopping/finish")
def finish_shopping(db: Session = Depends(get_db)):
    """Courses terminées : les articles cochés rejoignent le frigo, la liste est vidée."""
    for i in db.scalars(select(ShoppingItem).where(ShoppingItem.checked)).all():
        if i.quantity:
            db.add(PantryItem(name=i.name, quantity=i.quantity, unit=i.unit, aisle=i.aisle,
                              storage="pantry" if i.aisle.startswith("epicerie") or i.aisle == "condiments_epices" else "fridge"))
        db.delete(i)
    db.commit()
    return shopping(db)


@app.get("/api/aisles")
def aisles():
    return [{"id": a, "label": AISLE_LABELS[a]} for a in AISLE_ORDER]


# ---------- frontend (PWA) -------------------------------------------------------
if FRONTEND.exists():
    app.mount("/css", StaticFiles(directory=FRONTEND / "css"), name="css")
    app.mount("/js", StaticFiles(directory=FRONTEND / "js"), name="js")
    app.mount("/icons", StaticFiles(directory=FRONTEND / "icons"), name="icons")

    @app.get("/manifest.webmanifest")
    def manifest():
        return FileResponse(FRONTEND / "manifest.webmanifest", media_type="application/manifest+json")

    @app.get("/sw.js")
    def sw():
        return FileResponse(FRONTEND / "sw.js", media_type="application/javascript")

    @app.get("/{path:path}")
    def index(path: str = ""):
        if path.startswith("api/"):
            raise HTTPException(404)
        return FileResponse(FRONTEND / "index.html")
