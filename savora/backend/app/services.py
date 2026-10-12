"""Logique métier : mise à l'échelle, déduction du stock, génération de la liste de courses."""
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .ingredients import AISLE_LABELS, AISLE_ORDER, canon, to_grams
from .models import PantryItem, PlanEntry, Recipe, ShoppingItem


def get_household_size(db: Session) -> int:
    from .models import Setting
    s = db.get(Setting, "household_size")
    return int(s.value) if s else 4


def scale(qty: float | None, base: int, target: int) -> float | None:
    return None if qty is None else qty * target / max(base, 1)


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _same_ingredient(a: str, b: str) -> bool:
    """« tomate » ~ « tomate cerise » : égalité, ou un nom d'un seul mot contenu dans l'autre."""
    wa, wb = set(a.split()), set(b.split())
    if not wa or not wb:
        return False
    return wa == wb or (len(wa) == 1 and wa <= wb) or (len(wb) == 1 and wb <= wa)


def _available_in_unit(stock: list[PantryItem], key: str, name: str, unit: str) -> tuple[float, list[PantryItem]]:
    total, used = 0.0, []
    for p in stock:
        if not _same_ingredient(key, canon(p.name)):
            continue
        if p.unit == unit:
            total += p.quantity
        else:
            g_stock = to_grams(p.name, p.quantity, p.unit)
            g_unit = to_grams(name, 1, unit)
            if g_stock is None or not g_unit:
                continue
            total += g_stock / g_unit
        used.append(p)
    return total, used


def build_requirements(db: Session, start: date, end: date) -> dict[tuple[str, str], dict]:
    """Ingrédients requis (agrégés) pour les repas planifiés entre `start` et `end`."""
    entries = db.scalars(
        select(PlanEntry).where(PlanEntry.day >= start, PlanEntry.day <= end)
    ).all()
    need: dict[tuple[str, str], dict] = {}
    for e in entries:
        r: Recipe = e.recipe
        for ing in r.ingredients:
            if ing.staple:
                continue
            key = canon(ing.name)
            k = (key, ing.unit)
            row = need.setdefault(k, {"name": ing.name, "aisle": ing.aisle, "qty": 0.0,
                                      "unknown": False, "recipes": []})
            q = scale(ing.quantity, r.base_servings, e.servings)
            if q is None:
                row["unknown"] = True
            else:
                row["qty"] += q
            if r.title not in row["recipes"]:
                row["recipes"].append(r.title)
    return need


def regenerate_list(db: Session, start: date, end: date) -> None:
    """[Requis] − [Stock] = [À acheter]. Conserve les coches et les ajouts manuels."""
    old = {(i.key, i.unit): i.checked for i in db.scalars(select(ShoppingItem).where(ShoppingItem.origin == "plan"))}
    db.query(ShoppingItem).filter(ShoppingItem.origin == "plan").delete()
    stock = db.scalars(select(PantryItem)).all()
    for (key, unit), row in build_requirements(db, start, end).items():
        have, _ = _available_in_unit(stock, key, row["name"], unit)
        if row["unknown"] and row["qty"] == 0:
            to_buy, covered = None, 0.0           # « un peu de… » : on l'affiche sans quantité
            if have > 0:
                continue
        else:
            covered = min(have, row["qty"])
            to_buy = row["qty"] - covered
            if to_buy <= 1e-6:
                continue
        db.add(ShoppingItem(
            key=key, name=row["name"], quantity=to_buy, unit=unit, aisle=row["aisle"],
            origin="plan", checked=old.get((key, unit), False), from_stock=covered,
            recipes=row["recipes"],
        ))
    db.commit()


def pretty_qty(q: float | None, unit: str) -> str:
    if q is None:
        return ""
    if unit == "g":
        return f"{q / 1000:.2g} kg".replace(".", ",") if q >= 1000 else f"{round(q / 5) * 5 if q > 20 else round(q)} g"
    if unit == "ml":
        return f"{q / 1000:.2g} L".replace(".", ",") if q >= 1000 else f"{round(q / 5) * 5 if q > 20 else round(q)} ml"
    n = round(q * 2) / 2 if q < 10 else round(q)
    return str(int(n)) if n == int(n) else str(n).replace(".", ",")


def grouped_list(db: Session) -> list[dict]:
    items = db.scalars(select(ShoppingItem)).all()
    groups: dict[str, list[dict]] = defaultdict(list)
    for i in sorted(items, key=lambda x: (x.checked, x.name.lower())):
        groups[i.aisle].append({
            "id": i.id, "name": i.name, "quantity": i.quantity, "unit": i.unit,
            "label": pretty_qty(i.quantity, i.unit), "checked": i.checked,
            "from_stock": i.from_stock, "recipes": i.recipes, "origin": i.origin,
        })
    return [{"aisle": a, "label": AISLE_LABELS[a], "items": groups[a]} for a in AISLE_ORDER if groups.get(a)]
