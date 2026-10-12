// Savora — front PWA (vanilla ES modules, aucune dépendance)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const ICONS = {
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M9 7h6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  fridge: '<rect x="5" y="2" width="14" height="20" rx="3"/><path d="M5 10h14M9 6v1M9 13v3"/>',
  cart: '<path d="M3 4h2l2.4 11h10.2L20 7H6.2"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', heart: '<path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', check: '<path d="M5 12.5l4.5 4.5L19 7"/>', spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
};
const icon = (n, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ""}</svg>`;
const hydrateIcons = (root = document) => $$("i[data-i]", root).forEach((el) => { el.innerHTML = icon(el.dataset.i); el.classList.add("ic"); el.removeAttribute("data-i"); });

// --- API -------------------------------------------------------------------
async function api(path, opts = {}) {
  const res = await fetch("/api" + path, { headers: { "Content-Type": "application/json" }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (!res.ok) {
    let msg = "Une erreur est survenue";
    try { const j = await res.json(); msg = typeof j.detail === "string" ? j.detail : msg; } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

// --- UI utils ----------------------------------------------------------------
function toast(msg, err = false) {
  const t = document.createElement("div"); t.className = "toast" + (err ? " err" : ""); t.textContent = msg;
  $("#toasts").append(t); setTimeout(() => t.remove(), 3100);
}
document.addEventListener("pointerdown", (e) => {
  const b = e.target.closest(".btn"); if (!b || reduced) return;
  const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height), s = document.createElement("span");
  s.className = "ripple"; s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  b.append(s); setTimeout(() => s.remove(), 700);
});
const HUES = [152, 14, 38, 200, 340, 100, 260];
const phStyle = (r) => r.image_url ? `background-image:url('${esc(r.image_url)}')` : `background:linear-gradient(135deg,hsl(${HUES[r.id % HUES.length]} 55% 42%),hsl(${(HUES[r.id % HUES.length] + 40) % 360} 60% 58%))`;
const phLetter = (r) => r.image_url ? "" : esc(r.title.trim()[0] || "•");
function countUp(el, to, ms = 700) {
  if (reduced) { el.textContent = to; return; }
  const t0 = performance.now(), from = Number(el.textContent) || 0;
  const tick = (t) => { const k = Math.min((t - t0) / ms, 1), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(from + (to - from) * e); if (k < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
function openSheet(html, onMount) {
  const root = $("#sheet-root");
  root.innerHTML = `<div class="scrim"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  hydrateIcons(root);
  const close = () => {
    const sc = $(".scrim", root), sh = $(".sheet", root); if (!sh) return;
    sc.classList.add("out"); sh.classList.add("out"); setTimeout(() => (root.innerHTML = ""), 280);
  };
  $(".scrim", root).onclick = close;
  onMount?.($(".sheet", root), close);
  return close;
}
const dayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
const monthFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const mondayOf = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x; };

// --- État ------------------------------------------------------------------
const S = { view: "recipes", recipes: [], filter: "all", q: "", weekStart: mondayOf(new Date()), household: 4, collapsed: new Set() };
const TABS = ["recipes", "plan", "pantry", "shop"];

// --- Navigation ---------------------------------------------------------------
async function go(view, { instant = false } = {}) {
  const el = $("#view");
  if (!instant && !reduced) { el.classList.add("leave"); await new Promise((r) => setTimeout(r, 160)); }
  S.view = view; location.hash = view;
  $$(".tab").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  $("#pill").style.transform = matchMedia("(min-width:860px)").matches ? `translateY(${TABS.indexOf(view) * 52}px)` : `translateX(${TABS.indexOf(view) * 100}%)`;
  el.innerHTML = ""; el.classList.remove("leave"); window.scrollTo({ top: 0 });
  try { await VIEWS[view](el); } catch (e) { el.innerHTML = `<div class="empty"><b>Oups</b>${esc(e.message)}</div>`; }
  hydrateIcons(el); el.focus({ preventScroll: true });
  refreshBadge();
}
async function refreshBadge() {
  try { const s = await api("/shopping"); const b = $("#cart-badge"); const left = s.total - s.done; b.hidden = left <= 0; if (left > 0 && b.textContent != left) { b.textContent = left; b.style.animation = "none"; b.offsetWidth; b.style.animation = ""; } } catch {}
}
$("#tabs").addEventListener("click", (e) => { const b = e.target.closest(".tab"); if (b && b.dataset.view !== S.view) go(b.dataset.view); });
addEventListener("resize", () => go(S.view, { instant: true }));

const greet = () => { const h = new Date().getHours(); return h < 5 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir"; };
const emptyArt = `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="46" fill="var(--bg-2)"/><path d="M38 70c0-22 14-36 44-40-2 28-14 42-36 42" fill="var(--vanilla)"/><path d="M36 86c6-14 15-26 28-34" stroke="var(--cane)" stroke-width="5" fill="none" stroke-linecap="round"/></svg>`;

// === Recettes ================================================================
const VIEWS = {};
VIEWS.recipes = async (el) => {
  el.innerHTML = `<div class="hero in"><small>${greet()}</small><h1>Qu'est-ce qu'on <em>mange</em> cette semaine&nbsp;?</h1></div>
    <div class="row in" style="--n:1;margin-bottom:16px"><input class="input" id="q" type="search" placeholder="Chercher une recette…" value="${esc(S.q)}">
    <button class="chip ${S.filter === "all" ? "on" : ""}" data-f="all">Toutes</button><button class="chip ${S.filter === "fav" ? "on" : ""}" data-f="fav">Favoris</button></div>
    <div id="grid" class="grid">${'<div class="skel"></div>'.repeat(4)}</div>
    <button class="btn warm fab in" style="--n:3" id="import"><i data-i="plus"></i> Ajouter une recette</button>`;
  S.recipes = await api("/recipes");
  S.household = (await api("/settings")).household_size;
  drawGrid();
  $("#q").oninput = (e) => { S.q = e.target.value; drawGrid(false); };
  $$("[data-f]", el).forEach((b) => (b.onclick = () => { S.filter = b.dataset.f; $$("[data-f]", el).forEach((x) => x.classList.toggle("on", x === b)); drawGrid(); }));
  $("#import").onclick = importSheet;
};
function drawGrid(animate = true) {
  const g = $("#grid"); if (!g) return;
  const q = S.q.trim().toLowerCase();
  const list = S.recipes.filter((r) => (S.filter === "all" || r.favorite) && (!q || r.title.toLowerCase().includes(q)));
  if (!list.length) {
    g.outerHTML = `<div id="grid" class="empty in">${emptyArt}<b>${S.recipes.length ? "Rien ne correspond" : "Ta bibliothèque est vide"}</b>${S.recipes.length ? "Essaie un autre mot." : "Colle le lien d'une recette (Marmiton, 750g, ton blog préféré…) et Savora s'occupe du reste."}</div>`;
    return;
  }
  g.className = "grid";
  g.innerHTML = list.map((r, i) => `<article class="card rc ${animate ? "in" : ""}" style="--n:${i}" data-id="${r.id}" tabindex="0">
    <div class="ph-wrap"><div class="ph" style="${phStyle(r)}">${phLetter(r)}</div></div>
    <button class="heart ${r.favorite ? "on" : ""}" data-fav="${r.id}" aria-label="Favori"><i data-i="heart"></i></button>
    <div class="body"><h3>${esc(r.title)}</h3><div class="meta"><span>${r.ingredient_count} ingrédients</span>${r.prep_minutes || r.cook_minutes ? `<span>${(r.prep_minutes || 0) + (r.cook_minutes || 0)} min</span>` : ""}</div></div></article>`).join("");
  hydrateIcons(g);
  $$(".rc", g).forEach((c) => (c.onclick = (e) => {
    const f = e.target.closest("[data-fav]");
    if (f) { e.stopPropagation(); api(`/recipes/${f.dataset.fav}/favorite`, { method: "POST" }).then((r) => { f.classList.toggle("on", r.favorite); S.recipes.find((x) => x.id == f.dataset.fav).favorite = r.favorite; }); return; }
    recipeSheet(+c.dataset.id);
  }));
}
function importSheet() {
  openSheet(`<h2>Ajouter une recette</h2><p style="color:var(--ink-2);margin:6px 0 0">Un lien, ou le texte copié depuis un livre, un message, une photo…</p>
    <div class="seg"><button class="on" data-m="url">Lien</button><button data-m="text">Texte</button></div>
    <div id="m-url"><input class="input" id="url" type="url" inputmode="url" placeholder="https://www.marmiton.org/recettes/…"></div>
    <div id="m-text" hidden><textarea class="input" id="txt" rows="9" placeholder="Rougail saucisses&#10;Pour 4 personnes&#10;Ingrédients&#10;400 g de saucisses…"></textarea></div>
    <button class="btn" id="go" style="width:100%;margin-top:14px"><i data-i="spark"></i> Importer</button>`, (sh, close) => {
    let mode = "url";
    $$(".seg button", sh).forEach((b) => (b.onclick = () => { mode = b.dataset.m; $$(".seg button", sh).forEach((x) => x.classList.toggle("on", x === b)); $("#m-url", sh).hidden = mode !== "url"; $("#m-text", sh).hidden = mode !== "text"; }));
    $("#go", sh).onclick = async (e) => {
      const btn = e.currentTarget, html = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Lecture de la recette…';
      try {
        const r = await api("/recipes/import", { method: "POST", body: mode === "url" ? { url: $("#url", sh).value } : { text: $("#txt", sh).value } });
        close(); toast(`« ${r.title} » ajoutée ✨`); S.recipes = await api("/recipes"); drawGrid();
      } catch (err) { toast(err.message, true); btn.disabled = false; btn.innerHTML = html; hydrateIcons(btn); }
    };
  });
}
async function recipeSheet(id, servings) {
  const r = await api(`/recipes/${id}` + (servings ? `?servings=${servings}` : ""));
  const render = (sh, close, r) => {
    sh.innerHTML = `<div class="grab"></div><div class="rhero ${r.image_url ? "" : "ph"}" style="${phStyle(r)}">${phLetter(r)}</div>
    <div class="row" style="align-items:flex-start"><h2 class="sp" style="font-size:30px">${esc(r.title)}</h2><button class="x" id="close" aria-label="Fermer"><i data-i="x"></i></button></div>
    <div class="meta">${r.prep_minutes ? `<span>Prépa ${r.prep_minutes} min</span>` : ""}${r.cook_minutes ? `<span>Cuisson ${r.cook_minutes} min</span>` : ""}${r.source_url ? `<a href="${esc(r.source_url)}" target="_blank" rel="noopener" style="color:var(--cane)">Source ↗</a>` : ""}</div>
    <div class="row" style="margin:18px 0 6px"><h3>Ingrédients</h3><span class="sp"></span><div class="stepper"><button data-d="-1" aria-label="Moins">−</button><output><span class="num" id="sv">${r.servings}</span> pers.</output><button data-d="1" aria-label="Plus">+</button></div></div>
    <div>${r.ingredients.map((i) => `<div class="ing ${i.staple ? "staple" : ""}"><b>${esc(i.label || "")}</b><span>${esc(i.name)}</span></div>`).join("")}</div>
    ${r.instructions.length ? `<h3 style="margin:24px 0 12px">Préparation</h3><ol class="steps">${r.instructions.map((s) => `<li><span>${esc(s)}</span></li>`).join("")}</ol>` : ""}
    <div class="row" style="margin-top:26px"><button class="btn ghost sm" id="del"><i data-i="trash"></i></button><span class="sp"></span><button class="btn" id="plan"><i data-i="calendar"></i> Planifier</button></div>`;
    hydrateIcons(sh);
    $("#close", sh).onclick = close;
    $$(".stepper button", sh).forEach((b) => (b.onclick = async () => {
      const n = Math.max(1, Math.min(50, r.servings + +b.dataset.d)); if (n === r.servings) return;
      const nr = await api(`/recipes/${id}?servings=${n}`); const old = $$(".ing b", sh).map((x) => x.textContent);
      render(sh, close, nr); $$(".ing b", sh).forEach((x, i) => { if (x.textContent !== old[i]) { x.animate([{ transform: "translateY(-8px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 350, easing: "cubic-bezier(.34,1.56,.64,1)" }); } });
    }));
    $("#del", sh).onclick = async () => { if (confirm("Supprimer cette recette ?")) { await api(`/recipes/${id}`, { method: "DELETE" }); close(); S.recipes = S.recipes.filter((x) => x.id !== id); drawGrid(); } };
    $("#plan", sh).onclick = () => { close(); setTimeout(() => planSheet(r), 300); };
  };
  openSheet("", (sh, close) => render(sh, close, r));
}
function planSheet(r) {
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; });
  openSheet(`<h2>Planifier « ${esc(r.title)} »</h2><div class="seg" id="slot"><button data-s="lunch">Midi</button><button class="on" data-s="dinner">Soir</button></div>
    <div style="display:grid;gap:8px">${days.map((d, i) => `<button class="pick card" data-d="${iso(d)}"><b style="min-width:90px;text-transform:capitalize">${i === 0 ? "Aujourd'hui" : i === 1 ? "Demain" : dayFmt.format(d)}</b><span style="color:var(--ink-2)">${monthFmt.format(d)}</span></button>`).join("")}</div>`, (sh, close) => {
    let slot = "dinner";
    $$("#slot button", sh).forEach((b) => (b.onclick = () => { slot = b.dataset.s; $$("#slot button", sh).forEach((x) => x.classList.toggle("on", x === b)); }));
    $$(".pick", sh).forEach((b) => (b.onclick = async () => { await api("/plan", { method: "POST", body: { recipe_id: r.id, day: b.dataset.d, slot } }); close(); toast("Ajoutée à ta semaine 🗓️"); }));
  });
}

// === Semaine =================================================================
VIEWS.plan = async (el) => {
  const start = S.weekStart, end = new Date(start); end.setDate(end.getDate() + 6);
  const [plan, st] = await Promise.all([api(`/plan?start=${iso(start)}`), api("/settings")]);
  S.household = st.household_size;
  const by = {}; plan.entries.forEach((e) => ((by[e.day + e.slot] ||= []).push(e)));
  const today = iso(new Date());
  el.innerHTML = `<div class="hero in"><small>${monthFmt.format(start)} — ${monthFmt.format(end)}</small><h1>Ma <em>semaine</em></h1></div>
    <div class="row in" style="--n:1;margin-bottom:16px"><button class="btn ghost sm" id="prev">←</button><button class="btn ghost sm" id="next">→</button><span class="sp"></span>
      <div class="stepper" title="Taille du foyer"><button data-h="-1">−</button><output><i data-i="users" style="vertical-align:-5px;width:18px;height:18px"></i> <span class="num" id="hh">${S.household}</span></output><button data-h="1">+</button></div></div>
    <div class="week">${Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start); d.setDate(d.getDate() + i); const k = iso(d);
      const slot = (s, label) => (by[k + s] || []).map((e) => `<div class="slot"><div class="th" style="${phStyle(e.recipe)}">${phLetter(e.recipe)}</div><div class="sp"><b>${esc(e.recipe.title)}</b><small>${label} · ${e.servings} pers.</small></div><button class="x" data-del="${e.id}" aria-label="Retirer"><i data-i="x"></i></button></div>`).join("")
        || `<button class="slot empty-s" data-add="${k}|${s}"><i data-i="plus" style="width:18px;height:18px"></i> ${label}</button>`;
      return `<div class="card day in ${k === today ? "today" : ""}" style="--n:${i + 2}"><div><div class="dname">${dayFmt.format(d)}</div><div class="dnum">${d.getDate()}</div></div><div class="slots">${slot("lunch", "Midi")}${slot("dinner", "Soir")}</div></div>`;
    }).join("")}</div>
    <div style="text-align:center;margin-top:24px" class="in" ><button class="btn warm" id="gen"><i data-i="cart"></i> Générer ma liste de courses</button></div>`;
  $("#prev").onclick = () => { S.weekStart = new Date(start.getTime() - 7 * 864e5); go("plan", { instant: true }); };
  $("#next").onclick = () => { S.weekStart = new Date(start.getTime() + 7 * 864e5); go("plan", { instant: true }); };
  $$("[data-h]", el).forEach((b) => (b.onclick = async () => { const n = Math.max(1, Math.min(20, S.household + +b.dataset.h)); S.household = n; $("#hh").textContent = n; await api("/settings", { method: "PUT", body: { household_size: n } }); }));
  $$("[data-del]", el).forEach((b) => (b.onclick = async () => { b.closest(".slot").style.cssText = "opacity:0;transform:scale(.9);transition:.3s"; await api(`/plan/${b.dataset.del}`, { method: "DELETE" }); setTimeout(() => go("plan", { instant: true }), 250); }));
  $$("[data-add]", el).forEach((b) => (b.onclick = async () => {
    const [day, slot] = b.dataset.add.split("|"); const rs = S.recipes.length ? S.recipes : (S.recipes = await api("/recipes"));
    if (!rs.length) { toast("Ajoute d'abord une recette", true); return go("recipes"); }
    openSheet(`<h2>Choisir une recette</h2><div style="margin-top:10px">${rs.map((r) => `<button class="pick" data-r="${r.id}"><div class="th slot" style="${phStyle(r)};width:48px;height:48px;padding:0;color:#fff;justify-content:center;font:700 20px var(--serif)">${phLetter(r)}</div><b>${esc(r.title)}</b></button>`).join("")}</div>`, (sh, close) => {
      $$("[data-r]", sh).forEach((p) => (p.onclick = async () => { await api("/plan", { method: "POST", body: { recipe_id: +p.dataset.r, day, slot } }); close(); setTimeout(() => go("plan", { instant: true }), 300); }));
    });
  }));
  $("#gen").onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span> Calcul…';
    await api(`/shopping/generate?start=${iso(start)}`, { method: "POST" }); toast("Liste prête — ton frigo a été déduit ✓"); go("shop");
  };
};

// === Frigo ===================================================================
const STORAGE = { fridge: "Frigo", freezer: "Congélateur", pantry: "Placards" };
VIEWS.pantry = async (el) => {
  const [items, sugg] = await Promise.all([api("/pantry"), api("/pantry/suggestions")]);
  const exp = (p) => p.days_left == null ? "" : p.days_left < 0 ? `<span class="pill warn">expiré</span>` : p.days_left <= 3 ? `<span class="pill warn">${p.days_left === 0 ? "aujourd'hui" : `J-${p.days_left}`}</span>` : `<span class="pill ok">J-${p.days_left}</span>`;
  el.innerHTML = `<div class="hero in"><small>Ce que tu as déjà</small><h1>Mon <em>frigo</em> & placards</h1></div>
    ${sugg.length ? `<div class="card gaspi in" style="--n:1"><h2>À cuisiner en priorité</h2>${sugg.slice(0, 3).map((s) => `<button class="pick" data-r="${s.recipe.id}"><div class="th slot" style="${phStyle(s.recipe)};width:44px;height:44px;padding:0;color:#fff;justify-content:center;font:700 18px var(--serif)">${phLetter(s.recipe)}</div><span class="sp"><b>${esc(s.recipe.title)}</b><small style="display:block;color:var(--ink-2)">${s.covered}/${s.total} ingrédients déjà là${s.urgent.length ? ` · ${esc(s.urgent.join(", "))} bientôt périmé` : ""}</small></span></button>`).join("")}</div>` : ""}
    <form class="card in" style="--n:2;padding:16px;margin-bottom:8px" id="add"><div class="addrow"><input class="input full" name="name" placeholder="Ajouter : tomates, riz, lait de coco…" required>
      <input class="input" name="quantity" type="number" step="any" min="0" value="1" aria-label="Quantité"><select class="input" name="unit"><option value="piece">pièce</option><option value="g">g</option><option value="ml">ml</option></select>
      <select class="input" name="storage"><option value="fridge">Frigo</option><option value="pantry">Placard</option><option value="freezer">Congél.</option></select>
      <input class="input full" name="expires_on" type="date" aria-label="Date de péremption"><button class="btn full">Ajouter</button></div></form>
    ${Object.keys(STORAGE).map((k) => { const l = items.filter((p) => p.storage === k); return l.length ? `<div class="h-sec">${STORAGE[k]}</div><div class="card in">${l.map((p) => `<div class="pantry-row"><div class="sp"><b>${esc(p.name)}</b></div>${exp(p)}<span class="pill">${esc(p.label)}</span><button class="x" data-del="${p.id}" aria-label="Retirer"><i data-i="x"></i></button></div>`).join("")}</div>` : ""; }).join("")}
    ${items.length ? "" : `<div class="empty in">${emptyArt}<b>Frigo vide ?</b>Ajoute ce que tu as : il sera déduit de tes courses.</div>`}`;
  $("#add").onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.quantity = +f.quantity; if (!f.expires_on) delete f.expires_on;
    try { await api("/pantry", { method: "POST", body: f }); go("pantry", { instant: true }); } catch (err) { toast(err.message, true); }
  };
  $$("[data-del]", el).forEach((b) => (b.onclick = async () => { b.closest(".pantry-row").style.cssText = "opacity:0;transform:translateX(30px);transition:.3s"; await api(`/pantry/${b.dataset.del}`, { method: "DELETE" }); setTimeout(() => go("pantry", { instant: true }), 250); }));
  $$("[data-r]", el).forEach((b) => (b.onclick = () => recipeSheet(+b.dataset.r)));
};

// === Courses =================================================================
VIEWS.shop = async (el) => {
  const s = await api("/shopping");
  const pct = s.total ? s.done / s.total : 0;
  el.innerHTML = `<div class="hero in"><small>Par rayon, dans l'ordre du magasin</small><h1>Mes <em>courses</em></h1></div>
    <div class="card prog in" style="--n:1"><div class="ring"><svg viewBox="0 0 84 84" width="84" height="84"><circle class="bg" cx="42" cy="42" r="36"/><circle class="fg" id="fg" cx="42" cy="42" r="36"/></svg><b><span id="pc">0</span>%</b></div>
      <div class="sp"><b style="font:700 20px var(--serif)"><span id="left">${s.total - s.done}</span> article${s.total - s.done > 1 ? "s" : ""} à prendre</b><div style="color:var(--ink-2)">${s.done} dans le panier</div></div>
      ${s.done ? `<button class="btn sm" id="finish">Terminé</button>` : ""}</div>
    <form class="row in" style="--n:2;margin-bottom:16px" id="man"><input class="input" name="text" placeholder="Ajouter : 2 kg de riz, papier toilette…" required><button class="btn" aria-label="Ajouter"><i data-i="plus"></i></button></form>
    <div id="groups">${s.groups.map((g, gi) => `<section class="card aisle in ${S.collapsed.has(g.aisle) ? "closed" : ""}" style="--n:${gi + 3}" data-a="${g.aisle}"><button><span>${esc(g.label)}</span><small>${g.items.length}</small><i data-i="chevron"></i></button>
      <div class="alist"><div>${g.items.map((i) => `<button class="li ${i.checked ? "done" : ""}" data-id="${i.id}"><span class="cb"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span>
        <span class="t"><b>${esc(i.name)}</b>${i.from_stock ? `<small>déjà ${esc(String(Math.round(i.from_stock)))} en stock</small>` : i.recipes.length ? `<small>${esc(i.recipes.slice(0, 2).join(", "))}</small>` : ""}</span><span class="q">${esc(i.label)}</span></button>`).join("")}</div></div></section>`).join("")}</div>
    ${s.total ? "" : `<div class="empty in">${emptyArt}<b>Liste vide</b>Planifie des repas, puis génère ta liste : le frigo est déjà déduit.</div>`}`;
  const setProg = (done, total) => {
    const p = total ? done / total : 0; $("#fg").style.strokeDashoffset = 226 * (1 - p);
    countUp($("#pc"), Math.round(p * 100)); $("#left").textContent = total - done;
  };
  requestAnimationFrame(() => setProg(s.done, s.total));
  let done = s.done;
  $$(".aisle > button", el).forEach((b) => (b.onclick = () => { const a = b.parentElement; a.classList.toggle("closed"); const k = a.dataset.a; a.classList.contains("closed") ? S.collapsed.add(k) : S.collapsed.delete(k); }));
  $$(".li", el).forEach((li) => (li.onclick = async () => {
    const on = !li.classList.contains("done"); li.classList.toggle("done", on); done += on ? 1 : -1; setProg(done, s.total);
    if (on) burst(li.querySelector(".cb")); navigator.vibrate?.(on ? 12 : 4);
    api(`/shopping/${li.dataset.id}`, { method: "PATCH", body: { checked: on } }).then(refreshBadge).catch(() => { li.classList.toggle("done"); toast("Hors ligne", true); });
  }));
  $("#man").onsubmit = async (e) => { e.preventDefault(); await api("/shopping/manual", { method: "POST", body: { text: new FormData(e.target).get("text") } }); go("shop", { instant: true }); };
  $("#finish")?.addEventListener("click", async () => { await api("/shopping/finish", { method: "POST" }); toast("Courses rangées dans ton frigo 🎉"); go("shop", { instant: true }); });
};
function burst(host) {
  if (reduced) return;
  for (let i = 0; i < 8; i++) {
    const d = document.createElement("i"); d.className = "burst"; const a = (Math.PI * 2 * i) / 8, r = 26 + Math.random() * 10;
    d.style.cssText = `left:11px;top:11px;background:${["var(--vanilla)", "var(--pepper)", "var(--cane-2)"][i % 3]};--dx:${Math.cos(a) * r}px;--dy:${Math.sin(a) * r}px`;
    host.append(d); setTimeout(() => d.remove(), 700);
  }
}

// --- Démarrage ---------------------------------------------------------------
hydrateIcons();
const start = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "recipes";
go(start, { instant: true });
setTimeout(() => $("#splash").classList.add("out"), reduced ? 0 : 1500);
setTimeout(() => $("#splash").remove(), 2300);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
