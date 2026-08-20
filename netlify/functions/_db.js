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
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS bank_name text`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS bank_iban text`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS bank_swift text`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS bank_address text`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS login_username TEXT`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS password TEXT`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS last_tier_notified INTEGER`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS lang TEXT DEFAULT 'ar'`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS affiliate_id TEXT UNIQUE`;
  await sql`CREATE TABLE IF NOT EXISTS payout_runs (
    id SERIAL PRIMARY KEY,
    month TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS payout_items (
    id SERIAL PRIMARY KEY,
    run_id INTEGER REFERENCES payout_runs(id),
    ref_code TEXT,
    name TEXT,
    legal_name TEXT,
    bank_account TEXT,
    amount NUMERIC,
    floor_amount NUMERIC DEFAULT 0,
    bonus_amount NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`ALTER TABLE payout_items ADD COLUMN IF NOT EXISTS floor_amount NUMERIC DEFAULT 0`;
  await sql`ALTER TABLE payout_items ADD COLUMN IF NOT EXISTS bonus_amount NUMERIC DEFAULT 0`;
  await sql`CREATE TABLE IF NOT EXISTS boost_campaigns (
    id SERIAL PRIMARY KEY,
    name TEXT,
    boost_amount INTEGER NOT NULL,
    cap_override INTEGER,
    target TEXT DEFAULT 'all',
    target_codes TEXT[],
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
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
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paddle_transaction_id TEXT`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS paddle_amount NUMERIC`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_status_source TEXT DEFAULT 'manual'`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS self_ref_flagged BOOLEAN DEFAULT FALSE`;
  await sql`CREATE TABLE IF NOT EXISTS paddle_unmatched (
    id SERIAL PRIMARY KEY,
    event_type TEXT,
    customer_email TEXT,
    customer_name TEXT,
    raw_payload JSONB,
    resolved BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
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
    floor_amount NUMERIC NOT NULL DEFAULT 4,
    bonus_amount NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`ALTER TABLE commission_log ADD COLUMN IF NOT EXISTS floor_amount NUMERIC NOT NULL DEFAULT 4`;
  await sql`ALTER TABLE commission_log ADD COLUMN IF NOT EXISTS paddle_transaction_id TEXT`;
  await sql`ALTER TABLE commission_log ADD COLUMN IF NOT EXISTS bonus_amount NUMERIC NOT NULL DEFAULT 0`;
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
    kind TEXT DEFAULT 'customer-status',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`ALTER TABLE check_attempts ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'customer-status'`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS verify_token TEXT`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS verify_token_created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS verify_token TEXT`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS verify_token_created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS agreement_ip TEXT`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS terms_accepted_ip TEXT`;
  await sql`CREATE TABLE IF NOT EXISTS support_tickets (
    id SERIAL PRIMARY KEY,
    ref_number TEXT UNIQUE NOT NULL,
    ticket_type TEXT,
    linked_id TEXT,
    name TEXT,
    email TEXT NOT NULL,
    message TEXT,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'pending',
    admin_reply TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS email_verifications (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
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
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'affiliate'`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS leader_code TEXT`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS leader_since TIMESTAMPTZ`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS leader_until TIMESTAMPTZ`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS recruited_by TEXT`;
  await sql`CREATE TABLE IF NOT EXISTS team_messages (
    id SERIAL PRIMARY KEY,
    from_code TEXT NOT NULL,
    to_code TEXT NOT NULL,
    body TEXT NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS leader_requests (
    id SERIAL PRIMARY KEY,
    leader_code TEXT NOT NULL,
    type TEXT NOT NULL,
    payload JSONB,
    status TEXT NOT NULL DEFAULT 'pending',
    decision_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at TIMESTAMPTZ
  )`;
  await sql`CREATE TABLE IF NOT EXISTS tweet_log (
    id SERIAL PRIMARY KEY,
    bank_id TEXT,
    body TEXT,
    slot_date DATE,
    slot_hour INT,
    tweet_id TEXT,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS tweet_queue (
    id SERIAL PRIMARY KEY,
    body TEXT NOT NULL,
    posted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS ad_spend (
    id SERIAL PRIMARY KEY,
    platform TEXT,
    label TEXT,
    amount NUMERIC NOT NULL,
    spent_at DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  const passRow = await sql`SELECT value FROM admin_settings WHERE key = 'admin_password'`;
  if (passRow.length === 0) {
    const { hashPassword } = require('./_auth');
    await sql`INSERT INTO admin_settings (key, value) VALUES ('admin_password', ${hashPassword('A.e.e.s1405@')})`;
  }
  const userRow = await sql`SELECT value FROM admin_settings WHERE key = 'admin_username'`;
  if (userRow.length === 0) {
    await sql`INSERT INTO admin_settings (key, value) VALUES ('admin_username', 'admin')`;
  }
  await sql`CREATE TABLE IF NOT EXISTS academy_students (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    agreed_terms_at TIMESTAMPTZ,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    lang TEXT DEFAULT 'ar',
    points INTEGER NOT NULL DEFAULT 0,
    current_level INTEGER NOT NULL DEFAULT 1,
    rank TEXT NOT NULL DEFAULT 'مبتدئ',
    graduated_at TIMESTAMPTZ,
    discount_code TEXT,
    referred_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
  )`;
  await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS verify_token TEXT`;
  await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS verify_token_created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE academy_students ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false`;
  await sql`CREATE TABLE IF NOT EXISTS tv_alerts (
    id SERIAL PRIMARY KEY,
    symbol TEXT,
    timeframe TEXT,
    script_name TEXT,
    direction TEXT,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS academy_progress (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES academy_students(id),
    level_num INTEGER NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT false,
    score INTEGER,
    completed_at TIMESTAMPTZ,
    UNIQUE(student_id, level_num)
  )`;

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
