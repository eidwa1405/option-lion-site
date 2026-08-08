// يهيّئ الجداول تلقائياً أول مرة تُستدعى فيها أي دالة
const { neon } = require('@netlify/neon');

let sql;
function getSql() {
  if (!sql) sql = neon(); // يقرأ NETLIFY_DATABASE_URL تلقائياً من بيئة Netlify
  return sql;
}

async function ensureTables() {
  const sql = getSql();
  await sql`CREATE TABLE IF NOT EXISTS prices (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    paddle_price_id TEXT
  )`;
  await sql`CREATE TABLE IF NOT EXISTS ref_codes (
    code TEXT PRIMARY KEY,
    owner_name TEXT,
    uses INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS affiliates (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    legal_name TEXT,
    country TEXT,
    city TEXT,
    email TEXT,
    age INTEGER,
    phone TEXT,
    telegram TEXT,
    bank_account TEXT,
    commission_per_renewal NUMERIC NOT NULL DEFAULT 4,
    agreement_accepted_at TIMESTAMPTZ,
    signature_data TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS login_username TEXT`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS password TEXT`;
  await sql`CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    customer_name TEXT NOT NULL,
    ref_code TEXT,
    status TEXT NOT NULL DEFAULT 'trial',
    expires_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS phone TEXT`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS telegram TEXT`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tradingview TEXT`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan TEXT`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS notified_48h BOOLEAN DEFAULT FALSE`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS email TEXT`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS customer_id TEXT`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS reminder_stage INTEGER DEFAULT 0`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS welcome_sent BOOLEAN DEFAULT FALSE`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS lang TEXT DEFAULT 'ar'`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS aff_reminder_48h_sent BOOLEAN DEFAULT FALSE`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS aff_reminder_12h_sent BOOLEAN DEFAULT FALSE`;
  const counterRow = await sql`SELECT value FROM admin_settings WHERE key = 'customer_id_counter'`;
  if (counterRow.length === 0) {
    await sql`INSERT INTO admin_settings (key, value) VALUES ('customer_id_counter', '620')`;
  }
  await sql`CREATE TABLE IF NOT EXISTS commission_log (
    id SERIAL PRIMARY KEY,
    ref_code TEXT NOT NULL,
    customer_name TEXT,
    plan TEXT,
    amount NUMERIC NOT NULL DEFAULT 4,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS revenue_log (
    id SERIAL PRIMARY KEY,
    customer_name TEXT,
    plan TEXT,
    amount NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS check_attempts (
    id SERIAL PRIMARY KEY,
    ip TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS pending_reviews (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    nationality TEXT,
    city TEXT,
    review_text TEXT NOT NULL,
    lang TEXT NOT NULL DEFAULT 'ar',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL,
    page TEXT,
    lang TEXT,
    meta JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS admin_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`;
  const passRow = await sql`SELECT value FROM admin_settings WHERE key = 'admin_password'`;
  if (passRow.length === 0) {
    await sql`INSERT INTO admin_settings (key, value) VALUES ('admin_password', 'A.e.e.s1405@')`;
  }
  const userRow = await sql`SELECT value FROM admin_settings WHERE key = 'admin_username'`;
  if (userRow.length === 0) {
    await sql`INSERT INTO admin_settings (key, value) VALUES ('admin_username', 'admin')`;
  }
  const priceCount = await sql`SELECT COUNT(*)::int AS c FROM prices`;
  if (priceCount[0].c === 0) {
    await sql`INSERT INTO prices (id,label,amount,paddle_price_id) VALUES
      ('monthly','شهري',39,'pri_01kyhe6m178pfmv5p755mkhpf0'),
      ('3months','3 أشهر',99,'pri_01kyheh9wpxzfvv1b452h176y3'),
      ('6months','6 أشهر',179,'pri_01kyhen533mmstsyr1gf81qb94'),
      ('yearly','سنوي',299,'pri_01kyherxxbtt9kvb0hgevs3h3n')`;
  }
}

module.exports = { getSql, ensureTables };
