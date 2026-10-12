import os, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/t.db"

from datetime import date
from fastapi.testclient import TestClient

from app.importer import parse_html, parse_text
from app.ingredients import parse_ingredient
from app.main import app

HTML = """<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@graph":[{"@type":"Recipe","name":"Rougail saucisses","recipeYield":"4 personnes",
"prepTime":"PT20M","cookTime":"PT45M","image":["http://x/y.jpg"],
"recipeIngredient":["400 g de saucisses fumées","3 tomates","2 oignons","1 c. à soupe d'huile","2 gousses d'ail","Sel"],
"recipeInstructions":[{"@type":"HowToStep","text":"Faire revenir."},{"@type":"HowToStep","text":"Mijoter."}]}]}
</script></head></html>"""


def test_parse_quantities():
    p = parse_ingredient("1 c. à soupe d'huile")
    assert (p.quantity, p.unit, p.staple) == (15, "ml", True)
    p = parse_ingredient("½ citron")
    assert p.quantity == 0.5 and p.unit == "piece"
    assert parse_ingredient("200g de riz").quantity == 200


def test_jsonld_and_text():
    r = parse_html(HTML, "http://x")
    assert r.title == "Rougail saucisses" and r.servings == 4 and r.cook_minutes == 45 and len(r.ingredients) == 6
    t = parse_text("Gratin\nPour 2 personnes\nIngrédients\n200 g de pâtes\n1 oignon\nPréparation\n1. Cuire.")
    assert t.servings == 2 and len(t.ingredients) == 2 and t.instructions == ["Cuire."]


def test_full_flow():
    with TestClient(app) as c:
        rid = c.post("/api/recipes/import", json={"text": "Rougail\nPour 4 personnes\nIngrédients\n400 g de saucisses\n3 tomates\n2 oignons\nSel\nPréparation\nCuire."}).json()["id"]
        assert c.get(f"/api/recipes/{rid}?servings=8").json()["ingredients"][0]["quantity"] == 800
        c.post("/api/plan", json={"recipe_id": rid, "day": date.today().isoformat(), "servings": 4})
        c.post("/api/pantry", json={"name": "Tomates", "quantity": 1, "unit": "piece"})
        c.post("/api/pantry", json={"name": "Oignon", "quantity": 500, "unit": "g"})
        s = c.post("/api/shopping/generate").json()
        items = {i["name"]: i for g in s["groups"] for i in g["items"]}
        assert items["Tomates"]["quantity"] == 2          # 3 requis - 1 en stock
        assert "Oignons" not in items                      # 2 oignons (220 g) couverts par 500 g
        assert "Sel" not in items                          # produit de base ignoré
        assert c.get("/api/pantry/suggestions").json()[0]["covered"] == 2
