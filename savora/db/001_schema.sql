-- =====================================================================
-- Savora — schéma PostgreSQL (standard, sans dépendance Supabase)
-- Compatible PostgreSQL 14+  (local, Docker, Neon, Railway, Render…)
-- L'authentification est gérée par l'API FastAPI (table `users`).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- recherche floue
CREATE EXTENSION IF NOT EXISTS unaccent;   -- "tomate" = "Tômâte"

-- ---------------------------------------------------------------------
-- Types énumérés
-- ---------------------------------------------------------------------
CREATE TYPE sex_t            AS ENUM ('female', 'male');
CREATE TYPE activity_t       AS ENUM ('sedentary', 'light', 'moderate', 'active', 'very_active');
CREATE TYPE goal_t           AS ENUM ('lose', 'maintain', 'gain');
CREATE TYPE unit_kind_t      AS ENUM ('mass', 'volume', 'count');
CREATE TYPE aisle_t          AS ENUM (
    'fruits_legumes', 'boucherie', 'poissonnerie', 'charcuterie_traiteur',
    'cremerie', 'boulangerie', 'epicerie_salee', 'epicerie_sucree',
    'condiments_epices', 'boissons', 'surgele', 'frais_libre_service',
    'hygiene_entretien', 'autre'
);
CREATE TYPE storage_t        AS ENUM ('fridge', 'freezer', 'pantry');
CREATE TYPE meal_slot_t      AS ENUM ('breakfast', 'lunch', 'snack', 'dinner');
CREATE TYPE list_status_t    AS ENUM ('draft', 'active', 'ordered', 'done');
CREATE TYPE cuisine_t        AS ENUM ('reunionnaise', 'creole', 'francaise', 'asiatique', 'indienne', 'mediterraneenne', 'autre');

-- ---------------------------------------------------------------------
-- Trigger générique updated_at
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

-- unaccent() n'est pas IMMUTABLE : on l'encapsule pour pouvoir l'indexer
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT public.unaccent('public.unaccent', $1) $$;

-- ---------------------------------------------------------------------
-- 1. users : compte du foyer (auth gérée par l'API)
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email          text NOT NULL,
    password_hash  text NOT NULL,                       -- argon2/bcrypt
    household_name text NOT NULL DEFAULT 'Ma famille',
    preferred_store_id integer,                         -- FK ajoutée après `stores`
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_email_format CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
CREATE UNIQUE INDEX users_email_uidx ON users (lower(email));
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 2. users_profile : un profil par membre du foyer (IMC, besoins kcal)
-- ---------------------------------------------------------------------
CREATE TABLE users_profile (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_name     text NOT NULL,
    birth_date     date NOT NULL,
    sex            sex_t NOT NULL,
    height_cm      numeric(5,1) NOT NULL CHECK (height_cm BETWEEN 40 AND 250),
    weight_kg      numeric(5,1) NOT NULL CHECK (weight_kg BETWEEN 2 AND 400),
    activity_level activity_t NOT NULL DEFAULT 'light',
    goal           goal_t NOT NULL DEFAULT 'maintain',
    portion_factor numeric(3,2) NOT NULL DEFAULT 1.00   -- 1 adulte, 0.5 jeune enfant…
                   CHECK (portion_factor BETWEEN 0.1 AND 3),
    allergies      text[] NOT NULL DEFAULT '{}',
    diet_tags      text[] NOT NULL DEFAULT '{}',        -- {'halal','vegetarien',…}
    is_eating      boolean NOT NULL DEFAULT true,       -- compté dans les portions
    -- IMC calculé automatiquement
    bmi            numeric(4,1) GENERATED ALWAYS AS
                   (round(weight_kg / ((height_cm / 100) * (height_cm / 100)), 1)) STORED,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_profile_user_idx ON users_profile (user_id);
CREATE TRIGGER trg_profile_updated BEFORE UPDATE ON users_profile
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Besoin calorique journalier (Mifflin-St Jeor × coefficient d'activité, ± objectif)
CREATE OR REPLACE VIEW v_profile_energy AS
SELECT
    p.*,
    date_part('year', age(p.birth_date))::int AS age_years,
    round(
        (10 * p.weight_kg + 6.25 * p.height_cm
         - 5 * date_part('year', age(p.birth_date))
         + CASE p.sex WHEN 'male' THEN 5 ELSE -161 END)
        * CASE p.activity_level
              WHEN 'sedentary'   THEN 1.2
              WHEN 'light'       THEN 1.375
              WHEN 'moderate'    THEN 1.55
              WHEN 'active'      THEN 1.725
              WHEN 'very_active' THEN 1.9 END
        + CASE p.goal WHEN 'lose' THEN -400 WHEN 'gain' THEN 300 ELSE 0 END
    )::int AS daily_kcal_target
FROM users_profile p;

-- ---------------------------------------------------------------------
-- Unités (normalisation cuillères / pincées / pièces → g ou ml)
-- ---------------------------------------------------------------------
CREATE TABLE units (
    code         text PRIMARY KEY,                      -- 'g','kg','ml','cl','l','cs','cc','pincee','piece'
    label        text NOT NULL,
    aliases      text[] NOT NULL DEFAULT '{}',          -- pour le parser
    kind         unit_kind_t NOT NULL,
    to_base      numeric(12,4),                         -- facteur vers g (mass) ou ml (volume) ; NULL pour 'count'
    CONSTRAINT units_base_chk CHECK ((kind = 'count') = (to_base IS NULL))
);

-- ---------------------------------------------------------------------
-- Ingrédients génériques (référentiel central)
-- ---------------------------------------------------------------------
CREATE TABLE ingredients (
    id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name             text NOT NULL,                     -- 'Tomate'
    aliases          text[] NOT NULL DEFAULT '{}',      -- {'tomates','tomate grappe'}
    aisle            aisle_t NOT NULL DEFAULT 'autre',
    base_unit        text NOT NULL DEFAULT 'g' REFERENCES units(code),
    density_g_per_ml numeric(6,3),                      -- cuillère/volume → grammes
    grams_per_piece  numeric(8,2),                      -- 1 oignon ≈ 110 g
    kcal_per_100g    numeric(6,1),
    is_staple        boolean NOT NULL DEFAULT false,    -- sel, huile : jamais dans la liste
    search_text      text GENERATED ALWAYS AS (lower(f_unaccent(name))) STORED,
    search_tsv       tsvector GENERATED ALWAYS AS
                     (to_tsvector('simple', lower(f_unaccent(name)))) STORED,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ingredients_name_uk UNIQUE (name)
);
-- Index de recherche d'ingrédients (exact préfixe + flou + plein texte)
CREATE INDEX ingredients_trgm_idx   ON ingredients USING gin (search_text gin_trgm_ops);
CREATE INDEX ingredients_tsv_idx    ON ingredients USING gin (search_tsv);
CREATE INDEX ingredients_alias_idx  ON ingredients USING gin (aliases);
CREATE INDEX ingredients_aisle_idx  ON ingredients (aisle);

-- ---------------------------------------------------------------------
-- 3. recipes
-- ---------------------------------------------------------------------
CREATE TABLE recipes (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid REFERENCES users(id) ON DELETE CASCADE,  -- NULL = recette de la bibliothèque commune
    title          text NOT NULL,
    description    text,
    cuisine        cuisine_t NOT NULL DEFAULT 'autre',
    source_url     text,
    source_name    text,
    image_url      text,
    base_servings  smallint NOT NULL DEFAULT 4 CHECK (base_servings BETWEEN 1 AND 100),
    prep_minutes   smallint CHECK (prep_minutes >= 0),
    cook_minutes   smallint CHECK (cook_minutes >= 0),
    instructions   text[] NOT NULL DEFAULT '{}',        -- étapes ordonnées
    tags           text[] NOT NULL DEFAULT '{}',
    kcal_per_serving integer CHECK (kcal_per_serving >= 0),
    is_favorite    boolean NOT NULL DEFAULT false,
    search_tsv     tsvector GENERATED ALWAYS AS
                   (to_tsvector('simple', lower(f_unaccent(title)))) STORED,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recipes_user_idx    ON recipes (user_id);
CREATE INDEX recipes_cuisine_idx ON recipes (cuisine);
CREATE INDEX recipes_tags_idx    ON recipes USING gin (tags);
CREATE INDEX recipes_tsv_idx     ON recipes USING gin (search_tsv);
CREATE UNIQUE INDEX recipes_user_source_uidx ON recipes (user_id, source_url) WHERE source_url IS NOT NULL;
CREATE TRIGGER trg_recipes_updated BEFORE UPDATE ON recipes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 4. recipe_ingredients (quantités pour `base_servings` personnes)
-- ---------------------------------------------------------------------
CREATE TABLE recipe_ingredients (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id      uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    ingredient_id  integer REFERENCES ingredients(id) ON DELETE SET NULL,  -- NULL = non reconnu
    position       smallint NOT NULL DEFAULT 0,
    raw_text       text NOT NULL,                       -- ligne d'origine ("2 c. à soupe d'huile")
    quantity       numeric(10,3) CHECK (quantity >= 0), -- tel qu'écrit
    unit           text REFERENCES units(code),
    quantity_base  numeric(12,3) CHECK (quantity_base >= 0), -- normalisé en g / ml / pièces
    base_unit      text REFERENCES units(code),
    note           text,                                -- "haché", "en dés"
    is_optional    boolean NOT NULL DEFAULT false
);
CREATE INDEX recipe_ingredients_recipe_idx ON recipe_ingredients (recipe_id, position);
CREATE INDEX recipe_ingredients_ing_idx    ON recipe_ingredients (ingredient_id);

-- ---------------------------------------------------------------------
-- 5. pantry_stock : frigo / congélateur / placards
-- ---------------------------------------------------------------------
CREATE TABLE pantry_stock (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ingredient_id  integer NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    quantity       numeric(12,3) NOT NULL CHECK (quantity >= 0),   -- en base_unit de l'ingrédient
    unit           text NOT NULL REFERENCES units(code),
    storage        storage_t NOT NULL DEFAULT 'fridge',
    expires_on     date,
    opened_on      date,
    note           text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pantry_user_ing_idx ON pantry_stock (user_id, ingredient_id);
CREATE INDEX pantry_expiry_idx   ON pantry_stock (user_id, expires_on) WHERE expires_on IS NOT NULL;
CREATE TRIGGER trg_pantry_updated BEFORE UPDATE ON pantry_stock
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Enseignes locales
-- ---------------------------------------------------------------------
CREATE TABLE stores (
    id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug        text NOT NULL UNIQUE,                   -- 'leclerc-re'
    name        text NOT NULL,
    kind        text NOT NULL CHECK (kind IN ('drive', 'magasin', 'marche')),
    base_url    text,
    drive_supported boolean NOT NULL DEFAULT false,     -- automation Playwright possible
    is_active   boolean NOT NULL DEFAULT true
);
ALTER TABLE users ADD CONSTRAINT users_preferred_store_fk
    FOREIGN KEY (preferred_store_id) REFERENCES stores(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- 6. store_products : correspondance ingrédient générique ↔ référence magasin
-- ---------------------------------------------------------------------
CREATE TABLE store_products (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id       integer NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    ingredient_id  integer NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    sku            text,                                -- référence/EAN côté enseigne
    name           text NOT NULL,                       -- "Tomate grappe Réunion 1kg"
    brand          text,
    pack_quantity  numeric(10,3) NOT NULL CHECK (pack_quantity > 0),  -- contenu d'1 conditionnement
    pack_unit      text NOT NULL REFERENCES units(code),               -- g / ml / piece
    price          numeric(8,2) NOT NULL CHECK (price >= 0),           -- € TTC / conditionnement
    unit_price     numeric(10,4) GENERATED ALWAYS AS (price / pack_quantity) STORED, -- € par g/ml/pièce
    is_local       boolean NOT NULL DEFAULT false,      -- produit péi
    is_available   boolean NOT NULL DEFAULT true,
    product_url    text,
    image_url      text,
    priority       smallint NOT NULL DEFAULT 0,         -- choix préféré par défaut
    last_scraped_at timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX store_products_sku_uidx ON store_products (store_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX store_products_ing_idx   ON store_products (ingredient_id, store_id) WHERE is_available;
CREATE INDEX store_products_name_trgm ON store_products USING gin (lower(f_unaccent(name)) gin_trgm_ops);
CREATE TRIGGER trg_store_products_updated BEFORE UPDATE ON store_products
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Planning des repas
-- ---------------------------------------------------------------------
CREATE TABLE meal_plan_entries (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe_id   uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    planned_for date NOT NULL,
    slot        meal_slot_t NOT NULL DEFAULT 'dinner',
    servings    numeric(5,2) NOT NULL CHECK (servings > 0),
    cooked      boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meal_plan_user_date_idx ON meal_plan_entries (user_id, planned_for);

-- ---------------------------------------------------------------------
-- 7. shopping_lists (+ lignes)
-- ---------------------------------------------------------------------
CREATE TABLE shopping_lists (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id    integer REFERENCES stores(id) ON DELETE SET NULL,   -- enseigne ciblée
    title       text NOT NULL DEFAULT 'Courses de la semaine',
    status      list_status_t NOT NULL DEFAULT 'draft',
    period_start date,
    period_end   date,
    estimated_total numeric(9,2),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shopping_lists_user_idx ON shopping_lists (user_id, created_at DESC);
CREATE TRIGGER trg_lists_updated BEFORE UPDATE ON shopping_lists
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE shopping_list_items (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id          uuid NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
    ingredient_id    integer REFERENCES ingredients(id) ON DELETE SET NULL,
    label            text NOT NULL,                     -- libellé affiché
    aisle            aisle_t NOT NULL DEFAULT 'autre',
    required_qty     numeric(12,3) NOT NULL CHECK (required_qty >= 0), -- besoin brut (base_unit)
    in_stock_qty     numeric(12,3) NOT NULL DEFAULT 0 CHECK (in_stock_qty >= 0),
    to_buy_qty       numeric(12,3) GENERATED ALWAYS AS (greatest(required_qty - in_stock_qty, 0)) STORED,
    unit             text NOT NULL REFERENCES units(code),
    store_product_id uuid REFERENCES store_products(id) ON DELETE SET NULL,
    packs            integer CHECK (packs >= 0),        -- ceil(to_buy / pack_quantity)
    line_price       numeric(9,2),
    is_checked       boolean NOT NULL DEFAULT false,    -- case cochée en magasin
    added_to_cart    boolean NOT NULL DEFAULT false,    -- injecté par Playwright
    source_recipe_ids uuid[] NOT NULL DEFAULT '{}'
);
CREATE INDEX shopping_items_list_idx ON shopping_list_items (list_id, aisle);
