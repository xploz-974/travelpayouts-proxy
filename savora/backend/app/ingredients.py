"""Parsing et normalisation des lignes d'ingrédients (français)."""
import re
import unicodedata
from dataclasses import dataclass

# --- Unités : alias -> (unité de base, facteur) --------------------------------
UNITS: dict[str, tuple[str, float]] = {
    "g": ("g", 1), "gr": ("g", 1), "gramme": ("g", 1), "grammes": ("g", 1),
    "kg": ("g", 1000), "kilo": ("g", 1000), "kilos": ("g", 1000),
    "mg": ("g", 0.001),
    "ml": ("ml", 1), "cl": ("ml", 10), "dl": ("ml", 100),
    "l": ("ml", 1000), "litre": ("ml", 1000), "litres": ("ml", 1000),
    "cas": ("ml", 15), "cs": ("ml", 15), "c.s": ("ml", 15), "cuillere a soupe": ("ml", 15),
    "cuilleres a soupe": ("ml", 15), "c. a soupe": ("ml", 15), "c a soupe": ("ml", 15),
    "cac": ("ml", 5), "cc": ("ml", 5), "c.c": ("ml", 5), "cuillere a cafe": ("ml", 5),
    "cuilleres a cafe": ("ml", 5), "c. a cafe": ("ml", 5), "c a cafe": ("ml", 5),
    "verre": ("ml", 200), "verres": ("ml", 200), "tasse": ("ml", 240), "tasses": ("ml", 240),
    "bol": ("ml", 300), "bols": ("ml", 300),
    "pincee": ("g", 0.4), "pincees": ("g", 0.4), "noix": ("g", 15),
    # unités de comptage
    "piece": ("piece", 1), "pieces": ("piece", 1), "pc": ("piece", 1), "u": ("piece", 1),
    "gousse": ("piece", 1), "gousses": ("piece", 1), "botte": ("piece", 1), "bottes": ("piece", 1),
    "bouquet": ("piece", 1), "branche": ("piece", 1), "branches": ("piece", 1),
    "brin": ("piece", 1), "brins": ("piece", 1), "tranche": ("piece", 1), "tranches": ("piece", 1),
    "feuille": ("piece", 1), "feuilles": ("piece", 1), "sachet": ("piece", 1), "sachets": ("piece", 1),
    "boite": ("piece", 1), "boites": ("piece", 1), "pot": ("piece", 1), "pots": ("piece", 1),
    "paquet": ("piece", 1), "paquets": ("piece", 1), "tablette": ("piece", 1),
}

# poids moyen d'une pièce (g) — sert à faire le lien stock « 500 g » ↔ « 3 oignons »
PIECE_GRAMS = {
    "oignon": 110, "tomate": 120, "carotte": 80, "pomme de terre": 150, "ail": 5, "citron": 100,
    "citron vert": 60, "poivron": 180, "courgette": 250, "aubergine": 300, "oeuf": 60,
    "banane": 120, "pomme": 150, "chouchou": 300, "patate douce": 250, "concombre": 300,
    "echalote": 40, "avocat": 200, "mangue": 400, "ananas": 1200, "piment": 10, "gingembre": 30,
}

# densité g/ml (pour passer une cuillère/un volume en grammes côté stock)
DENSITY = {
    "farine": 0.55, "sucre": 0.85, "riz": 0.85, "huile": 0.92, "beurre": 0.95, "miel": 1.4,
    "lait": 1.03, "creme": 1.0, "sel": 1.2, "lentille": 0.8, "semoule": 0.7, "mais": 0.75,
}

STAPLES = {
    "sel", "poivre", "eau", "huile", "huile d olive", "huile de tournesol", "sucre", "farine",
    "sel fin", "gros sel", "poivre noir", "fleur de sel", "vinaigre",
}

UNICODE_FRACS = {"½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8"}


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


_NOISE = re.compile(
    r"\b(frais|fraiche|fraiches|fraîches|bio|gros|grosse|petit|petite|moyen|moyenne|mur|mure|"
    r"fin|fine|hache|hachee|emince|emincee|rape|rapee|coupe|coupee|en des|en rondelles|"
    r"pele|pelee|lave|lavee|environ|selon gout|au gout|a votre gout|facultatif)\b"
)


def canon(name: str) -> str:
    """Nom canonique pour comparer 'Tomates fraîches' et 'tomate'."""
    s = strip_accents(name.lower())
    s = re.sub(r"\(.*?\)", " ", s)
    s = s.replace("’", "'").replace("œ", "oe")
    s = re.sub(r"[^a-z0-9' ]", " ", s)
    s = _NOISE.sub(" ", s)
    s = re.sub(r"\b(d|de|du|des|la|le|les|l|un|une)\b'?", " ", s)
    words = []
    for w in s.replace("'", " ").split():
        if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        elif len(w) > 3 and w.endswith("x") and w not in ("noix",):
            w = w[:-1]
        words.append(w)
    return " ".join(words).strip()


# --- Rayons ------------------------------------------------------------------
AISLES: list[tuple[str, tuple[str, ...]]] = [
    ("fruits_legumes", (
        "tomate", "oignon", "carotte", "pomme de terre", "ail", "citron", "poivron", "courgette",
        "aubergine", "salade", "laitue", "concombre", "chou", "brede", "chouchou", "patate douce",
        "manioc", "songe", "giraumon", "potiron", "citrouille", "banane", "pomme", "mangue",
        "ananas", "litchi", "avocat", "gingembre", "piment", "persil", "coriandre", "basilic",
        "menthe", "thym", "ciboulette", "echalote", "champignon", "haricot vert", "epinard",
        "poireau", "celeri", "radis", "betterave", "fruit de la passion", "papaye", "goyave",
        "orange", "mandarine", "fraise", "framboise", "cive", "cebette", "brocoli", "chou fleur",
        "petit pois", "mais", "navet", "fenouil", "curcuma frais", "combava", "vanille", "bringelle",
    )),
    ("boucherie", ("poulet", "boeuf", "porc", "veau", "agneau", "viande", "saucisse", "steak",
                   "cuisse", "blanc de poulet", "escalope", "roti", "cote", "lardon", "canard",
                   "dinde", "boudin", "carbonara", "hache", "lard", "jambon cru")),
    ("poissonnerie", ("poisson", "thon", "saumon", "cabillaud", "crevette", "morue", "espadon",
                      "dorade", "langoustine", "moule", "calamar", "encornet", "bichique", "capitaine")),
    ("charcuterie_traiteur", ("jambon", "saucisson", "chorizo", "pate", "tofu", "tempeh")),
    ("cremerie", ("lait", "beurre", "creme", "yaourt", "fromage", "mozzarella", "emmental",
                  "parmesan", "oeuf", "gruyere", "ricotta", "feta", "mascarpone", "chevre", "comte")),
    ("boulangerie", ("pain", "baguette", "brioche", "tortilla", "wrap", "pate feuilletee",
                     "pate brisee", "pate a pizza")),
    ("epicerie_salee", ("riz", "pate", "spaghetti", "tagliatelle", "semoule", "lentille", "haricot rouge",
                        "haricot blanc", "pois chiche", "quinoa", "boulgour", "conserve", "coulis",
                        "concentre", "bouillon", "thon en boite", "sardine", "lait de coco",
                        "mais en boite", "nouille", "vermicelle", "cacahuete", "pois du cap", "grains")),
    ("epicerie_sucree", ("sucre", "farine", "chocolat", "miel", "confiture", "levure", "cacao",
                         "biscuit", "amande", "noisette", "maizena", "fecule", "sirop", "vanille liquide")),
    ("condiments_epices", ("sel", "poivre", "epice", "curcuma", "safran", "massale", "cumin",
                           "paprika", "cannelle", "curry", "vinaigre", "moutarde", "sauce soja",
                           "huile", "ketchup", "mayonnaise", "cardamome", "girofle", "muscade",
                           "origan", "herbes de provence", "piment en poudre", "rougail", "colombo",
                           "quatre epices", "sauce")),
    ("boissons", ("eau", "jus", "vin", "biere", "rhum", "cafe", "the", "soda", "lait de coco boisson")),
    ("surgele", ("surgele", "glace", "congele")),
]

AISLE_LABELS = {
    "fruits_legumes": "Fruits & légumes", "boucherie": "Boucherie", "poissonnerie": "Poissonnerie",
    "charcuterie_traiteur": "Charcuterie & traiteur", "cremerie": "Crèmerie & œufs",
    "boulangerie": "Boulangerie", "epicerie_salee": "Épicerie salée", "epicerie_sucree": "Épicerie sucrée",
    "condiments_epices": "Condiments & épices", "boissons": "Boissons", "surgele": "Surgelés",
    "autre": "Autres",
}
AISLE_ORDER = list(AISLE_LABELS)


def guess_aisle(name: str) -> str:
    c = canon(name)
    words = set(c.split())
    best, best_len = "autre", 0
    for aisle, keys in AISLES:
        for k in keys:
            ck = canon(k)
            if not ck:
                continue
            hit = ck in c if " " in ck else (ck in words or any(w.startswith(ck) and len(ck) >= 5 for w in words))
            if hit and len(ck) > best_len:
                best, best_len = aisle, len(ck)
    return best


def to_grams(name: str, qty: float, unit: str) -> float | None:
    """Convertit une quantité en grammes si possible (stock ↔ recette)."""
    if unit == "g":
        return qty
    c = canon(name)
    if unit == "ml":
        for k, d in DENSITY.items():
            if k in c.split() or c.startswith(k):
                return qty * d
        return qty  # ~1 g/ml
    if unit == "piece":
        for k, g in sorted(PIECE_GRAMS.items(), key=lambda kv: -len(kv[0])):
            if canon(k) in c:
                return qty * g
    return None


# --- Parsing d'une ligne -------------------------------------------------------
@dataclass
class ParsedIngredient:
    raw: str
    name: str
    quantity: float | None
    unit: str  # g | ml | piece
    aisle: str
    staple: bool


_NUM = r"(?:\d+/\d+|\d+\s+\d+/\d+|\d+(?:[.,]\d+)?)"
_QTY_RE = re.compile(rf"^\s*(?P<q>{_NUM})(?:\s*(?:-|à|a|ou)\s*(?P<q2>{_NUM}))?\s*(?P<rest>.*)$", re.I)
_UNIT_WORDS = sorted(UNITS, key=len, reverse=True)


def _num(s: str) -> float:
    s = s.replace(",", ".").strip()
    total = 0.0
    for part in s.split():
        if "/" in part:
            a, b = part.split("/")
            total += float(a) / float(b)
        else:
            total += float(part)
    return total


def parse_ingredient(line: str) -> ParsedIngredient:
    raw = re.sub(r"\s+", " ", line.replace("\xa0", " ")).strip(" -•*·\t")
    text = raw
    for f, r in UNICODE_FRACS.items():
        text = re.sub(rf"(\d)\s*{f}", rf"\1 {r}", text).replace(f, r)
    text = text.replace("’", "'")

    qty: float | None = None
    unit = "piece"
    m = _QTY_RE.match(text)
    rest = text
    if m:
        qty = _num(m.group("q"))
        if m.group("q2") and m.group("q2") != m.group("q"):
            qty = (qty + _num(m.group("q2"))) / 2
        rest = m.group("rest")
        # collé : « 200g », « 50cl »
        folded = strip_accents(rest.lower())
        matched_unit = None
        for u in _UNIT_WORDS:
            pat = re.compile(rf"^{re.escape(u)}(?![a-z])\.?\s*", re.I)
            mm = pat.match(folded)
            if mm and not (len(u) == 1 and u not in ("g", "l") and folded[1:2].isalpha()):
                matched_unit = u
                rest = rest[mm.end():]
                break
        if matched_unit:
            base, factor = UNITS[matched_unit]
            unit, qty = base, qty * factor
        rest = re.sub(r"^(?:d'|de |du |des |de la |d’)\s*", "", rest.strip(), flags=re.I)
    name = re.sub(r"\s*\(.*?\)", "", rest).strip(" ,.;:")
    name = re.split(r",| - ", name)[0].strip()
    if not name:
        name = raw
    name = name[:1].upper() + name[1:] if name else name
    c = canon(name)
    return ParsedIngredient(
        raw=raw, name=name, quantity=qty, unit=unit, aisle=guess_aisle(name),
        staple=c in {canon(s) for s in STAPLES},
    )
