-- Données de base : unités et enseignes de La Réunion
INSERT INTO units (code, label, aliases, kind, to_base) VALUES
 ('g',      'gramme',            '{g,gr,gramme,grammes}',                     'mass',   1),
 ('kg',     'kilogramme',        '{kg,kilo,kilos}',                           'mass',   1000),
 ('ml',     'millilitre',        '{ml}',                                      'volume', 1),
 ('cl',     'centilitre',        '{cl}',                                      'volume', 10),
 ('dl',     'décilitre',         '{dl}',                                      'volume', 100),
 ('l',      'litre',             '{l,litre,litres}',                          'volume', 1000),
 ('cs',     'cuillère à soupe',  '{"c. à soupe","cuillère à soupe","cuil. à soupe",cs,cas,tbsp}', 'volume', 15),
 ('cc',     'cuillère à café',   '{"c. à café","cuillère à café","cuil. à café",cc,cac,tsp}',     'volume', 5),
 ('verre',  'verre',             '{verre,verres}',                            'volume', 200),
 ('tasse',  'tasse',             '{tasse,tasses}',                            'volume', 240),
 ('pincee', 'pincée',            '{pincée,pincées}',                          'mass',   0.4),
 ('piece',  'pièce',             '{pièce,pièces,pc,unité,u}',                 'count',  NULL),
 ('gousse', 'gousse',            '{gousse,gousses}',                          'count',  NULL),
 ('botte',  'botte',             '{botte,bottes,bouquet}',                    'count',  NULL),
 ('branche','branche',           '{branche,branches,brin,brins}',             'count',  NULL);

INSERT INTO stores (slug, name, kind, base_url, drive_supported) VALUES
 ('leclerc-re',  'E.Leclerc Réunion', 'drive',   'https://www.e-leclerc.re',     true),
 ('carrefour-re','Carrefour.re',      'drive',   'https://www.carrefour.re',     true),
 ('run-market',  'Run Market',        'drive',   NULL,                           false),
 ('marche-forain','Marchés forains',  'marche',  NULL,                           false);
