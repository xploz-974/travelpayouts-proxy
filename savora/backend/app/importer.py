"""Import de recettes depuis une URL (JSON-LD schema.org, microdata, HTML) ou du texte brut."""
import html
import json
import re
from dataclasses import dataclass, field

import httpx
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


@dataclass
class RawRecipe:
    title: str
    servings: int = 4
    ingredients: list[str] = field(default_factory=list)
    instructions: list[str] = field(default_factory=list)
    image: str | None = None
    prep_minutes: int | None = None
    cook_minutes: int | None = None
    source_url: str | None = None


class ImportError_(Exception):
    pass


def _iso_minutes(v) -> int | None:
    if not isinstance(v, str):
        return None
    m = re.fullmatch(r"P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?", v.strip(), re.I)
    if not m or not (m.group(1) or m.group(2)):
        return None
    return int(m.group(1) or 0) * 60 + int(m.group(2) or 0)


def _servings(v) -> int:
    if isinstance(v, list):
        v = v[0] if v else None
    m = re.search(r"\d+", str(v or ""))
    return max(1, min(int(m.group()), 50)) if m else 4


def _image(v) -> str | None:
    if isinstance(v, list):
        v = v[0] if v else None
    if isinstance(v, dict):
        v = v.get("url")
    return v if isinstance(v, str) else None


def _steps(v) -> list[str]:
    out: list[str] = []
    if isinstance(v, str):
        parts = [p.strip() for p in re.split(r"\n+|(?<=\.)\s{2,}", v) if p.strip()]
        return [html.unescape(re.sub(r"<[^>]+>", " ", p)).strip() for p in parts]
    for it in v or []:
        if isinstance(it, str):
            out.append(html.unescape(it).strip())
        elif isinstance(it, dict):
            if it.get("itemListElement"):
                out += _steps(it["itemListElement"])
            elif it.get("text"):
                out.append(html.unescape(it["text"]).strip())
    return [s for s in out if s]


def _find_recipe_node(data):
    stack = [data]
    while stack:
        n = stack.pop()
        if isinstance(n, list):
            stack.extend(n)
        elif isinstance(n, dict):
            t = n.get("@type")
            types = t if isinstance(t, list) else [t]
            if "Recipe" in types:
                return n
            stack.extend(n.get("@graph", []) if isinstance(n.get("@graph"), list) else [])
            stack.extend(v for v in n.values() if isinstance(v, (dict, list)))
    return None


def parse_html(page: str, url: str | None = None) -> RawRecipe:
    soup = BeautifulSoup(page, "lxml")
    for tag in soup.find_all("script", type=lambda t: t and "ld+json" in t):
        try:
            data = json.loads(tag.string or tag.get_text() or "")
        except (json.JSONDecodeError, TypeError):
            continue
        node = _find_recipe_node(data)
        if node and node.get("recipeIngredient"):
            return RawRecipe(
                title=html.unescape(str(node.get("name") or "Recette sans titre")).strip(),
                servings=_servings(node.get("recipeYield")),
                ingredients=[html.unescape(str(i)).strip() for i in node["recipeIngredient"] if str(i).strip()],
                instructions=_steps(node.get("recipeInstructions")),
                image=_image(node.get("image")),
                prep_minutes=_iso_minutes(node.get("prepTime")),
                cook_minutes=_iso_minutes(node.get("cookTime")),
                source_url=url,
            )
    # Repli : microdata itemprop="recipeIngredient" / "ingredients"
    items = soup.select('[itemprop="recipeIngredient"], [itemprop="ingredients"]')
    if items:
        title = soup.find("h1")
        return RawRecipe(
            title=(title.get_text(strip=True) if title else "Recette importée"),
            ingredients=[re.sub(r"\s+", " ", i.get_text(" ", strip=True)) for i in items],
            instructions=[re.sub(r"\s+", " ", s.get_text(" ", strip=True))
                          for s in soup.select('[itemprop="recipeInstructions"] li, [itemprop="recipeInstructions"] p')],
            source_url=url,
        )
    raise ImportError_("Aucune recette structurée trouvée sur cette page. Colle le texte de la recette à la place.")


_ING_HEAD = re.compile(r"^\s*(ingr[ée]dients?|il vous faut|pour la recette)\b.*$", re.I)
_STEP_HEAD = re.compile(r"^\s*(pr[ée]paration|[ée]tapes?|recette|instructions?|d[ée]roul[ée])\b.*$", re.I)
_SERV = re.compile(r"(?:pour|(?:\bportions?|personnes?|parts?)\s*:?)\s*(\d+)|(\d+)\s*(?:personnes?|portions?|parts?|convives?)", re.I)


def parse_text(text: str) -> RawRecipe:
    lines = [l.strip() for l in text.replace("\r", "").split("\n")]
    lines = [l for l in lines if l]
    if not lines:
        raise ImportError_("Texte vide.")
    title = lines[0] if not re.match(r"^\d", lines[0]) and not _ING_HEAD.match(lines[0]) else "Recette importée"
    servings = 4
    m = _SERV.search(text)
    if m:
        servings = _servings(m.group(1) or m.group(2))
    ings: list[str] = []
    steps: list[str] = []
    mode = "ing" if not any(_ING_HEAD.match(l) for l in lines) else None
    for l in lines[1:] if title != "Recette importée" else lines:
        if _ING_HEAD.match(l):
            mode = "ing"
            continue
        if _STEP_HEAD.match(l) and len(l) < 40:
            mode = "step"
            continue
        if mode == "ing":
            if re.match(r"^[\-•*·]?\s*(\d|½|¼|¾|une? |des |quelques |sel|poivre)", l, re.I) or len(l) < 60:
                ings.append(l.lstrip("-•*· "))
            else:
                mode = "step"
                steps.append(l)
        elif mode == "step":
            steps.append(re.sub(r"^\d+[\.\)]\s*", "", l))
    if not ings:
        raise ImportError_("Impossible de repérer des ingrédients dans ce texte.")
    return RawRecipe(title=title, servings=servings, ingredients=ings, instructions=steps)


def fetch_recipe(url: str) -> RawRecipe:
    if not re.match(r"^https?://", url):
        url = "https://" + url
    try:
        r = httpx.get(url, headers={"User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9"},
                      follow_redirects=True, timeout=20)
        r.raise_for_status()
    except httpx.HTTPError as e:
        raise ImportError_(f"Impossible de charger la page ({e.__class__.__name__}).") from e
    return parse_html(r.text, url)
