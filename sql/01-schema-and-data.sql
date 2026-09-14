-- Kerbside finance: the RDS side of the demo. PostgreSQL.
--
-- Run against your RDS Postgres instance, before taking the Clumio backup.
-- Paste into a pgAdmin query window, or:
--
--   psql -h <endpoint> -U <user> -d <database> -f sql/01-schema-and-data.sql
--
-- Everything lives in its own schema, so it cannot collide with anything else
-- already on the instance and is trivial to remove afterwards.
--
-- Generates the settlement ledger for 250 restaurants from January 2025 to
-- September 2026: roughly 900,000 orders, 2,000,000 order lines and 23,000
-- weekly payouts. Settlements are derived from the orders and the contract
-- rate rather than written independently, so the payouts reconcile to the
-- transactions behind them exactly. That reconciliation is the first thing an
-- auditor checks, so it has to hold.
--
-- Takes a couple of minutes. The checks at the end must all report zero.

DROP SCHEMA IF EXISTS kerbside_finance CASCADE;
CREATE SCHEMA kerbside_finance;
SET search_path TO kerbside_finance;

-- Deterministic pseudo-random in [0,1) from a text key. Same key, same value,
-- every run and every engine, so the figures in the docs stay true.
CREATE FUNCTION rnd(k text) RETURNS double precision
LANGUAGE sql IMMUTABLE AS $$
  SELECT (abs((('x' || substr(md5(k), 1, 8))::bit(32)::int)::bigint) % 1000000) / 1000000.0
$$;

CREATE TABLE tenants (
  tenant_slug   VARCHAR(64)  PRIMARY KEY,
  trading_name  VARCHAR(128) NOT NULL,
  cuisine       VARCHAR(32)  NOT NULL,
  city          VARCHAR(64)  NOT NULL,
  onboarded_on  DATE         NOT NULL
);

CREATE TABLE contracts (
  tenant_slug    VARCHAR(64) PRIMARY KEY REFERENCES tenants (tenant_slug),
  commission_bps INTEGER     NOT NULL,
  effective_from DATE        NOT NULL
);

CREATE TABLE dishes (
  cuisine          VARCHAR(32) NOT NULL,
  idx              SMALLINT    NOT NULL,
  dish_name        VARCHAR(64) NOT NULL,
  base_price_pence INTEGER     NOT NULL,
  PRIMARY KEY (cuisine, idx)
);

CREATE TABLE orders (
  order_id           BIGINT      PRIMARY KEY,
  tenant_slug        VARCHAR(64) NOT NULL REFERENCES tenants (tenant_slug),
  placed_at          TIMESTAMP   NOT NULL,
  channel            VARCHAR(16) NOT NULL,
  payment_method     VARCHAR(16) NOT NULL,
  card_last4         CHAR(4),
  items_pence        INTEGER     NOT NULL,
  delivery_fee_pence INTEGER     NOT NULL,
  tip_pence          INTEGER     NOT NULL,
  gross_pence        INTEGER     NOT NULL,
  vat_pence          INTEGER     NOT NULL,
  refund_pence       INTEGER     NOT NULL DEFAULT 0,
  refund_reason      VARCHAR(32)
);

-- The order_id foreign key is added after loading. Line totals are what the
-- order header is built from, so the lines have to exist first.
CREATE TABLE order_items (
  order_item_id    BIGINT   GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id         BIGINT   NOT NULL,
  dish_name        VARCHAR(64) NOT NULL,
  quantity         SMALLINT NOT NULL,
  unit_price_pence INTEGER  NOT NULL,
  line_total_pence INTEGER  NOT NULL
);

CREATE TABLE settlements (
  settlement_id    BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_slug      VARCHAR(64) NOT NULL REFERENCES tenants (tenant_slug),
  period_start     DATE        NOT NULL,
  period_end       DATE        NOT NULL,
  order_count      INTEGER     NOT NULL,
  gross_pence      INTEGER     NOT NULL,
  refunds_pence    INTEGER     NOT NULL,
  commission_bps   INTEGER     NOT NULL,
  commission_pence INTEGER     NOT NULL,
  net_paid_pence   INTEGER     NOT NULL,
  paid_at          TIMESTAMP   NOT NULL,
  payout_ref       VARCHAR(32) NOT NULL,
  UNIQUE (tenant_slug, period_start)
);

-- ---------------------------------------------------------------------------
-- Generation knobs. Reduce TENANT_COUNT or narrow the dates for a quick local
-- run; the figures quoted in docs/rds-audit-scenario.md assume these values.
-- ---------------------------------------------------------------------------
CREATE TABLE gen_params (
  tenant_count INTEGER NOT NULL,
  start_date   DATE    NOT NULL,
  end_date     DATE    NOT NULL
);
INSERT INTO gen_params VALUES (250, DATE '2025-01-01', DATE '2026-09-30');

-- Four dishes per cuisine. The first three mirror the menus the storefront
-- actually publishes to S3, so finance and the app agree on what is sold.
INSERT INTO dishes (cuisine, idx, dish_name, base_price_pence) VALUES
  ('Japanese', 1, 'Katsu curry',        1250),
  ('Japanese', 2, 'Bao set',             900),
  ('Japanese', 3, 'Gyoza',               650),
  ('Japanese', 4, 'Tonkotsu ramen',     1300),
  ('Turkish',  1, 'Adana kebab',        1100),
  ('Turkish',  2, 'Lahmacun',            750),
  ('Turkish',  3, 'Cheese pide',         950),
  ('Turkish',  4, 'Baklava',             400),
  ('Cafe',     1, 'Flat white',          340),
  ('Cafe',     2, 'Sourdough toastie',   700),
  ('Cafe',     3, 'Granola bowl',        600),
  ('Cafe',     4, 'Salted brownie',      380),
  ('Seafood',  1, 'Beer-battered cod',  1180),
  ('Seafood',  2, 'Crab roll',          1090),
  ('Seafood',  3, 'Salt and pepper squid', 780),
  ('Seafood',  4, 'Chowder',             690),
  ('Thai',     1, 'Pad thai',            980),
  ('Thai',     2, 'Green curry',        1080),
  ('Thai',     3, 'Som tam',             620),
  ('Thai',     4, 'Mango sticky rice',   540),
  ('Italian',  1, 'Margherita',          890),
  ('Italian',  2, 'Nduja calzone',      1240),
  ('Italian',  3, 'Arancini',            620),
  ('Italian',  4, 'Tiramisu',            520),
  ('Deli',     1, 'Reuben',              890),
  ('Deli',     2, 'Mortadella focaccia', 760),
  ('Deli',     3, 'Soup and bread',      580),
  ('Deli',     4, 'Cannoli',             420),
  ('Spanish',  1, 'Patatas bravas',      620),
  ('Spanish',  2, 'Gambas pil pil',     1140),
  ('Spanish',  3, 'Jamon plate',        1080),
  ('Spanish',  4, 'Churros',             480),
  ('Indian',   1, 'Chicken tikka',      1090),
  ('Indian',   2, 'Dal makhani',         820),
  ('Indian',   3, 'Lamb biryani',       1280),
  ('Indian',   4, 'Garlic naan',         340),
  ('Chinese',  1, 'Char siu rice',      1020),
  ('Chinese',  2, 'Salt chilli tofu',    880),
  ('Chinese',  3, 'Pork dumplings',      720),
  ('Chinese',  4, 'Egg fried rice',      460),
  ('Mexican',  1, 'Al pastor tacos',     940),
  ('Mexican',  2, 'Birria quesadilla',  1160),
  ('Mexican',  3, 'Loaded nachos',       780),
  ('Mexican',  4, 'Horchata',            390),
  ('British',  1, 'Steak pie',          1140),
  ('British',  2, 'Fish finger bap',     760),
  ('British',  3, 'Sunday roast',       1420),
  ('British',  4, 'Sticky toffee',       560),
  ('Vegan',    1, 'Jackfruit burger',    980),
  ('Vegan',    2, 'Buddha bowl',         920),
  ('Vegan',    3, 'Seitan wings',        740),
  ('Vegan',    4, 'Oat shake',           450),
  ('Bakery',   1, 'Sausage roll',        420),
  ('Bakery',   2, 'Cheese twist',        360),
  ('Bakery',   3, 'Cinnamon bun',        390),
  ('Bakery',   4, 'Cardamom loaf',       620),
  ('Pizza',    1, 'Pepperoni 12"',      1180),
  ('Pizza',    2, 'Garlic bread',        520),
  ('Pizza',    3, 'Hot honey 12"',      1290),
  ('Pizza',    4, 'House salad',         440);

-- The eight named restaurants are the same ones the storefront serves, with
-- the same slugs, so the finance ledger and the platform agree.
INSERT INTO tenants (tenant_slug, trading_name, cuisine, city, onboarded_on) VALUES
  ('alma-kitchen',     'Alma Kitchen',     'Japanese', 'Bristol',    DATE '2023-04-11'),
  ('brick-lane-grill', 'Brick Lane Grill', 'Turkish',  'London',     DATE '2022-11-02'),
  ('corner-pantry',    'Corner Pantry',    'Cafe',     'Leeds',      DATE '2024-01-15'),
  ('dockside-fish',    'Dockside Fish',    'Seafood',  'Hull',       DATE '2023-02-20'),
  ('east-street-thai', 'East Street Thai', 'Thai',     'Manchester', DATE '2023-07-04'),
  ('fenwick-pizza',    'Fenwick Pizza',    'Italian',  'Newcastle',  DATE '2022-09-19'),
  ('greenway-deli',    'Greenway Deli',    'Deli',     'Sheffield',  DATE '2024-03-06'),
  ('harbour-tapas',    'Harbour Tapas',    'Spanish',  'Brighton',   DATE '2023-10-30');

-- The rest of the ledger, named the same way the platform names its estate.
INSERT INTO tenants (tenant_slug, trading_name, cuisine, city, onboarded_on)
SELECT
  'synth-' || lpad(n::text, 5, '0'),
  (ARRAY['Riverside','Harbourside','Northgate','Kings Cross','Ashfield','Millbank',
         'Sunnyside','Cedar Grove','Lansdowne','Fenchurch','Westgate','Old Mill',
         'Stonebridge','Maple','Queensway','Abbeyfield','Brookside','Crown',
         'Eastfield','Hollow Lane'])[1 + (n % 20)]
    || ' ' ||
  (ARRAY['Kitchen','Diner','Grill','Cafe','Eatery','Canteen','Deli','Bistro',
         'Takeaway','Kitchen & Bar'])[1 + ((n / 20) % 10)]
    || ' #' || lpad(n::text, 5, '0'),
  (ARRAY['Cafe','Italian','Indian','Chinese','Mexican','Thai','British','Vegan',
         'Bakery','Pizza'])[1 + (n % 10)],
  (ARRAY['London','Manchester','Birmingham','Leeds','Glasgow','Bristol','Cardiff',
         'Liverpool','Nottingham','Sheffield','Edinburgh','Belfast'])[1 + (n % 12)],
  DATE '2022-01-01' + (floor(rnd('onb' || n) * 900))::int
FROM generate_series(1, (SELECT tenant_count FROM gen_params) - 8) AS n;

-- Commission is negotiated per restaurant, 14% to 26%. Alma Kitchen is on 18%,
-- which is what makes their settlement arithmetic work out the way it does.
INSERT INTO contracts (tenant_slug, commission_bps, effective_from)
SELECT tenant_slug,
       CASE WHEN tenant_slug = 'alma-kitchen' THEN 1800
            ELSE 1400 + 25 * (floor(rnd('bps' || tenant_slug) * 49))::int END,
       onboarded_on
FROM tenants;

-- How busy each restaurant is, before day-of-week and seasonal effects.
--
-- The ordinal gives every restaurant its own order_id block, so a restaurant's
-- orders do not shift when the estate size changes. Dial tenant_count down for
-- a quick local run and Alma Kitchen's figures still come out the same.
CREATE TABLE gen_profile AS
SELECT t.tenant_slug,
       COALESCE(
         array_position(
           ARRAY['alma-kitchen','brick-lane-grill','corner-pantry','dockside-fish',
                 'east-street-thai','fenwick-pizza','greenway-deli','harbour-tapas'],
           t.tenant_slug),
         8 + substr(t.tenant_slug, 7)::int
       ) AS ordinal,
       CASE t.tenant_slug
         WHEN 'alma-kitchen' THEN 6.0
         ELSE 1.5 + rnd('vol' || t.tenant_slug) * 7.5
       END AS daily_base,
       0.90 + rnd('px' || t.tenant_slug) * 0.25 AS price_factor
FROM tenants t;

-- Orders per restaurant per day: their baseline, lifted at the weekend, drifting
-- with the season, with a December bump and daily noise on top.
CREATE TABLE gen_day AS
SELECT p.tenant_slug,
       d.day::date AS day,
       GREATEST(0, round(
         p.daily_base
         * CASE EXTRACT(dow FROM d.day)::int
             WHEN 0 THEN 1.05 WHEN 1 THEN 0.75 WHEN 2 THEN 0.80 WHEN 3 THEN 0.90
             WHEN 4 THEN 1.05 WHEN 5 THEN 1.40 ELSE 1.45 END
         * (1 + 0.15 * sin(2 * pi() * (EXTRACT(doy FROM d.day) - 100) / 365.0))
         * CASE WHEN EXTRACT(month FROM d.day) = 12 THEN 1.20 ELSE 1.0 END
         * (0.75 + 0.5 * rnd('day' || p.tenant_slug || d.day::text))
       ))::int AS order_count
FROM gen_profile p
CROSS JOIN generate_series((SELECT start_date FROM gen_params),
                           (SELECT end_date   FROM gen_params),
                           INTERVAL '1 day') AS d(day);

-- One row per order, before the basket is priced.
CREATE TABLE gen_order AS
SELECT
  pr.ordinal::bigint * 10000000
    + ROW_NUMBER() OVER (PARTITION BY g.tenant_slug ORDER BY g.day, s.slot) AS order_id,
  g.tenant_slug,
  g.day,
  s.slot,
  g.day
    + CASE WHEN rnd('band' || g.tenant_slug || g.day::text || s.slot::text) < 0.42
           THEN INTERVAL '11 hours 30 minutes'
           ELSE INTERVAL '17 hours 30 minutes' END
    + (floor(rnd('min' || g.tenant_slug || g.day::text || s.slot::text) * 150))::int * INTERVAL '1 minute'
    AS placed_at,
  CASE WHEN rnd('ch' || g.tenant_slug || g.day::text || s.slot::text) < 0.65
       THEN 'delivery' ELSE 'collection' END AS channel,
  1 + (floor(rnd('ic' || g.tenant_slug || g.day::text || s.slot::text) * 3.4))::int AS item_count
FROM gen_day g
JOIN gen_profile pr ON pr.tenant_slug = g.tenant_slug
JOIN LATERAL generate_series(1, g.order_count) AS s(slot) ON TRUE
WHERE g.order_count > 0;

CREATE INDEX idx_gen_order ON gen_order (order_id);

INSERT INTO order_items (order_id, dish_name, quantity, unit_price_pence, line_total_pence)
SELECT
  o.order_id,
  d.dish_name,
  q.quantity,
  price.unit_price,
  q.quantity * price.unit_price
FROM gen_order o
JOIN tenants t     ON t.tenant_slug = o.tenant_slug
JOIN gen_profile p ON p.tenant_slug = o.tenant_slug
JOIN LATERAL generate_series(1, o.item_count) AS li(n) ON TRUE
-- Offset from a per-order starting dish rather than drawing each line
-- independently, so a basket never lists the same dish as two separate lines.
JOIN dishes d
  ON d.cuisine = t.cuisine
 AND d.idx = 1 + (((floor(rnd('dish' || o.order_id::text) * 4))::int + li.n - 1) % 4)
CROSS JOIN LATERAL (
  SELECT CASE WHEN rnd('qty' || o.order_id::text || li.n::text) < 0.78 THEN 1
              WHEN rnd('qty' || o.order_id::text || li.n::text) < 0.95 THEN 2
              ELSE 3 END AS quantity
) q
CROSS JOIN LATERAL (
  SELECT GREATEST(100, round(d.base_price_pence * p.price_factor / 5.0) * 5)::int AS unit_price
) price;

-- Now the order totals, built from the lines so the two can never disagree.
-- VAT is the 20% element already inside the food and delivery charge; tips are
-- outside the scope of VAT. It is recorded for audit and does not enter the
-- settlement, which is gross less refunds less commission.
INSERT INTO orders (order_id, tenant_slug, placed_at, channel, payment_method, card_last4,
                    items_pence, delivery_fee_pence, tip_pence, gross_pence, vat_pence)
SELECT
  o.order_id,
  o.tenant_slug,
  o.placed_at,
  o.channel,
  pay.method,
  CASE WHEN pay.method = 'cash' THEN NULL
       ELSE lpad(((abs((('x' || substr(md5('card' || o.order_id::text), 1, 8))::bit(32)::int)::bigint)) % 10000)::text, 4, '0')
  END,
  li.items_pence,
  fee.delivery_fee,
  tip.tip,
  li.items_pence + fee.delivery_fee + tip.tip,
  round((li.items_pence + fee.delivery_fee) * 20.0 / 120.0)::int
FROM gen_order o
JOIN (
  SELECT order_id, SUM(line_total_pence)::int AS items_pence
  FROM order_items GROUP BY order_id
) li ON li.order_id = o.order_id
CROSS JOIN LATERAL (
  SELECT CASE WHEN o.channel = 'collection' THEN 0
              ELSE 199 + 50 * (floor(rnd('fee' || o.order_id::text) * 5))::int END AS delivery_fee
) fee
CROSS JOIN LATERAL (
  SELECT CASE WHEN rnd('pm' || o.order_id::text) < 0.55 THEN 'card'
              WHEN rnd('pm' || o.order_id::text) < 0.75 THEN 'apple-pay'
              WHEN rnd('pm' || o.order_id::text) < 0.85 THEN 'google-pay'
              ELSE 'cash' END AS method
) pay
CROSS JOIN LATERAL (
  SELECT CASE WHEN rnd('tip' || o.order_id::text) < 0.62 THEN 0
              ELSE round(li.items_pence * (0.05 + 0.07 * rnd('tipv' || o.order_id::text)))::int
         END AS tip
) tip;

ALTER TABLE order_items
  ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders (order_id);

CREATE INDEX idx_orders_tenant_date ON orders (tenant_slug, placed_at);
CREATE INDEX idx_order_items_order  ON order_items (order_id);

-- Ordinary trading noise: the occasional missing item, the occasional complaint.
UPDATE orders o
SET refund_pence = LEAST(o.gross_pence, (
      SELECT MAX(oi.line_total_pence) FROM order_items oi WHERE oi.order_id = o.order_id
    )),
    refund_reason = 'item-unavailable'
WHERE rnd('ref' || o.order_id::text) < 0.012;

UPDATE orders o
SET refund_pence = o.gross_pence,
    refund_reason = 'customer-complaint'
WHERE o.refund_reason IS NULL
  AND rnd('cmp' || o.order_id::text) < 0.004;

-- The incident behind the dispute. Alma Kitchen lost refrigeration on the
-- Wednesday and did not trade again until the Sunday, losing the Friday and
-- Saturday that carry the week. Nobody marked the storefront closed, so orders
-- kept arriving and were cancelled on receipt and refunded in full.
--
-- That is why the week reads the way it does: a normal order count, and a payout
-- a third the size. They took the orders. They could not fulfil any of them from
-- the Wednesday on.
UPDATE orders
SET refund_pence  = gross_pence,
    refund_reason = 'restaurant-cancelled'
WHERE tenant_slug = 'alma-kitchen'
  AND placed_at::date BETWEEN DATE '2025-02-12' AND DATE '2025-02-15';

-- Weekly settlements, derived from the orders and the contract rate so gross,
-- refunds, commission and net always agree with the transactions behind them.
INSERT INTO settlements
  (tenant_slug, period_start, period_end, order_count, gross_pence, refunds_pence,
   commission_bps, commission_pence, net_paid_pence, paid_at, payout_ref)
SELECT
  w.tenant_slug,
  w.wk_start,
  w.wk_start + 6,
  w.order_count,
  w.gross,
  w.refunds,
  c.commission_bps,
  round((w.gross - w.refunds) * c.commission_bps / 10000.0)::int,
  (w.gross - w.refunds) - round((w.gross - w.refunds) * c.commission_bps / 10000.0)::int,
  (w.wk_start + 9)::timestamp + INTERVAL '10 hours',
  'KB-' || to_char(w.wk_start, 'IYYY"W"IW') || '-' || upper(substr(md5(w.tenant_slug), 1, 6))
FROM (
  SELECT tenant_slug,
         date_trunc('week', placed_at)::date AS wk_start,
         COUNT(*)::int          AS order_count,
         SUM(gross_pence)::int  AS gross,
         SUM(refund_pence)::int AS refunds
  FROM orders
  GROUP BY tenant_slug, date_trunc('week', placed_at)::date
) w
JOIN contracts c ON c.tenant_slug = w.tenant_slug;

DROP TABLE gen_order;
DROP TABLE gen_day;
DROP TABLE gen_profile;
DROP TABLE gen_params;

-- ---------------------------------------------------------------------------
-- Every one of these must report zero failures. If any does not, stop: do not
-- take a backup of numbers that do not reconcile.
-- ---------------------------------------------------------------------------
SELECT 'settlement internal maths' AS check_name, COUNT(*) AS failures
  FROM settlements
 WHERE net_paid_pence <> gross_pence - refunds_pence - commission_pence
UNION ALL
SELECT 'settlement totals vs orders', COUNT(*)
  FROM settlements s
  JOIN (SELECT tenant_slug,
               date_trunc('week', placed_at)::date AS wk,
               SUM(gross_pence)::int  AS gross,
               SUM(refund_pence)::int AS refunds,
               COUNT(*)::int          AS orders
          FROM orders
         GROUP BY 1, 2) o
    ON o.tenant_slug = s.tenant_slug AND o.wk = s.period_start
 WHERE o.gross <> s.gross_pence
    OR o.refunds <> s.refunds_pence
    OR o.orders <> s.order_count
UNION ALL
SELECT 'order header vs its lines', COUNT(*)
  FROM orders o
  JOIN (SELECT order_id, SUM(line_total_pence)::int AS lines_total
          FROM order_items GROUP BY 1) l
    ON l.order_id = o.order_id
 WHERE o.items_pence <> l.lines_total
UNION ALL
SELECT 'gross vs its components', COUNT(*)
  FROM orders
 WHERE gross_pence <> items_pence + delivery_fee_pence + tip_pence
UNION ALL
SELECT 'refund larger than the order', COUNT(*)
  FROM orders WHERE refund_pence > gross_pence
UNION ALL
SELECT 'commission rate vs contract', COUNT(*)
  FROM settlements s JOIN contracts c USING (tenant_slug)
 WHERE s.commission_bps <> c.commission_bps;
