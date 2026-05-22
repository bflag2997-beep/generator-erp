const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const ExcelJS = require("exceljs");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const BACKUP_DIR = path.join(ROOT, "backups");
const LOG_DIR = path.join(ROOT, "logs");
loadEnv(path.join(ROOT, ".env"));
const PORT = Number(process.env.PORT || 8090);
const DATABASE_URL = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/generator_erp";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();

const permissionCatalog = [
  ["users.manage", "إدارة المستخدمين والصلاحيات"],
  ["accounting.view", "عرض المحاسبة"],
  ["accounting.post", "ترحيل القيود"],
  ["accounting.export", "تصدير التقارير المالية"],
  ["inventory.view", "عرض المخزون"],
  ["inventory.post", "ترحيل حركات المخزون"],
  ["sales.manage", "إدارة المبيعات والتحصيل"],
  ["purchasing.manage", "إدارة المشتريات"],
  ["maintenance.manage", "إدارة الصيانة"],
  ["hr.manage", "إدارة الرواتب والأجور"],
  ["settings.manage", "إعدادات النظام"]
];

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function log(level, message, meta = {}) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const entry = { at: new Date().toISOString(), level, message, ...meta };
  fs.appendFileSync(path.join(LOG_DIR, "app.log"), JSON.stringify(entry) + "\n", "utf8");
  const line = `[${entry.at}] ${level.toUpperCase()} ${message}`;
  if (level === "error") console.error(line);
  else console.log(line);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000
});

const defaultAccounts = [
  ["1", "الموجودات", "موجودات", "إجمالي"],
  ["11", "الموجودات الثابتة", "موجودات", "رئيسي"],
  ["111", "الأراضي", "موجودات", "فرعي"],
  ["112", "المباني", "موجودات", "فرعي"],
  ["113", "المكائن والمعدات", "موجودات", "فرعي"],
  ["114", "وسائط النقل", "موجودات", "فرعي"],
  ["115", "الأثاث", "موجودات", "فرعي"],
  ["116", "أجهزة الحاسوب", "موجودات", "فرعي"],
  ["117", "مجمع الاندثار", "موجودات", "فرعي"],
  ["12", "الموجودات المتداولة", "موجودات", "رئيسي"],
  ["121", "المخزون", "موجودات", "فرعي"],
  ["1211", "مخزون مولدات", "موجودات", "تحليلي"],
  ["1212", "مخزون قطع غيار", "موجودات", "تحليلي"],
  ["1213", "مخزون زيوت", "موجودات", "تحليلي"],
  ["122", "بضاعة بالطريق", "موجودات", "فرعي"],
  ["123", "اعتمادات مستندية", "موجودات", "فرعي"],
  ["124", "دفعات مقدمة للموردين", "موجودات", "فرعي"],
  ["13", "المشاريع تحت التنفيذ", "موجودات", "رئيسي"],
  ["14", "الاستثمارات", "موجودات", "رئيسي"],
  ["15", "الحسابات المدينة", "موجودات", "رئيسي"],
  ["151", "العملاء", "موجودات", "فرعي"],
  ["152", "أوراق القبض", "موجودات", "فرعي"],
  ["153", "سلف الموظفين", "موجودات", "فرعي"],
  ["154", "التأمينات", "موجودات", "فرعي"],
  ["155", "ذمم أخرى", "موجودات", "فرعي"],
  ["16", "النقدية", "موجودات", "رئيسي"],
  ["161", "الصندوق", "موجودات", "فرعي"],
  ["1611", "صندوق دينار", "موجودات", "تحليلي"],
  ["1612", "صندوق دولار", "موجودات", "تحليلي"],
  ["162", "المصارف", "موجودات", "فرعي"],
  ["1621", "مصرف المنصور", "موجودات", "تحليلي"],
  ["1622", "حساب التحويل الخارجي", "موجودات", "تحليلي"],
  ["17", "المصروفات الإيرادية المؤجلة", "موجودات", "رئيسي"],
  ["18", "حسابات داخلية", "موجودات", "رئيسي"],
  ["2", "المطلوبات", "مطلوبات", "إجمالي"],
  ["21", "المطلوبات طويلة الأجل", "مطلوبات", "رئيسي"],
  ["22", "المطلوبات قصيرة الأجل", "مطلوبات", "رئيسي"],
  ["221", "الموردون", "مطلوبات", "فرعي"],
  ["222", "أوراق الدفع", "مطلوبات", "فرعي"],
  ["223", "مصاريف مستحقة", "مطلوبات", "فرعي"],
  ["224", "رواتب مستحقة", "مطلوبات", "فرعي"],
  ["225", "ضرائب", "مطلوبات", "فرعي"],
  ["226", "أمانات الغير", "مطلوبات", "فرعي"],
  ["23", "المخصصات", "مطلوبات", "رئيسي"],
  ["3", "حقوق الملكية", "حقوق ملكية", "إجمالي"],
  ["31", "رأس المال", "حقوق ملكية", "رئيسي"],
  ["32", "الاحتياطيات", "حقوق ملكية", "رئيسي"],
  ["33", "الأرباح والخسائر المتراكمة", "حقوق ملكية", "رئيسي"],
  ["34", "نتيجة النشاط الجاري", "حقوق ملكية", "رئيسي"],
  ["4", "الإيرادات", "إيرادات", "إجمالي"],
  ["41", "إيرادات النشاط السلعي", "إيرادات", "رئيسي"],
  ["411", "مبيعات المولدات", "إيرادات", "فرعي"],
  ["412", "مبيعات قطع الغيار", "إيرادات", "فرعي"],
  ["42", "إيرادات النشاط الخدمي", "إيرادات", "رئيسي"],
  ["421", "صيانة المولدات", "إيرادات", "فرعي"],
  ["422", "عقود الصيانة", "إيرادات", "فرعي"],
  ["423", "أجور النقل", "إيرادات", "فرعي"],
  ["43", "إيرادات أخرى", "إيرادات", "رئيسي"],
  ["5", "المصروفات", "مصروفات", "إجمالي"],
  ["51", "تكلفة النشاط", "مصروفات", "رئيسي"],
  ["511", "تكلفة المولدات المباعة", "مصروفات", "فرعي"],
  ["512", "تكلفة قطع الغيار", "مصروفات", "فرعي"],
  ["513", "مواد الصيانة", "مصروفات", "فرعي"],
  ["514", "أجور الفنيين", "مصروفات", "فرعي"],
  ["52", "المصروفات التشغيلية", "مصروفات", "رئيسي"],
  ["53", "المصروفات الإدارية", "مصروفات", "رئيسي"],
  ["531", "الرواتب", "مصروفات", "فرعي"],
  ["532", "الإيجار", "مصروفات", "فرعي"],
  ["533", "الكهرباء", "مصروفات", "فرعي"],
  ["534", "الإنترنت", "مصروفات", "فرعي"],
  ["535", "الوقود", "مصروفات", "فرعي"],
  ["536", "الضيافة", "مصروفات", "فرعي"],
  ["537", "القرطاسية", "مصروفات", "فرعي"],
  ["54", "المصروفات التسويقية", "مصروفات", "رئيسي"],
  ["55", "المصروفات التمويلية", "مصروفات", "رئيسي"],
  ["6", "الحسابات النظامية والإحصائية", "نظامية", "إجمالي"],
  ["61", "مراكز الكلفة", "نظامية", "رئيسي"],
  ["62", "حسابات رقابية", "نظامية", "رئيسي"],
  ["63", "التزامات محتملة", "نظامية", "رئيسي"]
];

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, 210000, 32, "sha256").toString("hex");
}

function verifyPassword(user, password) {
  const hash = hashPassword(password, user.password_salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.password_hash, "hex"));
}

function createPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: hashPassword(password, salt) };
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function initDb() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS meta (
      key text PRIMARY KEY,
      value jsonb NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id bigserial PRIMARY KEY,
      name text NOT NULL,
      username text NOT NULL UNIQUE,
      role text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      password_salt text NOT NULL,
      password_hash text NOT NULL,
      failed_attempts integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS accounts (
      code text PRIMARY KEY,
      name text NOT NULL,
      type text NOT NULL,
      level text NOT NULL,
      balance numeric(18,2) NOT NULL DEFAULT 0,
      parent_code text REFERENCES accounts(code),
      currency text NOT NULL DEFAULT 'IQD',
      nature text NOT NULL DEFAULT '',
      classification text NOT NULL DEFAULT '',
      level_no integer NOT NULL DEFAULT 1,
      active boolean NOT NULL DEFAULT true,
      is_system boolean NOT NULL DEFAULT false,
      posting_mode text NOT NULL DEFAULT 'transaction',
      account_id bigserial UNIQUE,
      parent_id bigint
    );

    CREATE TABLE IF NOT EXISTS customers (
      id bigserial PRIMARY KEY,
      name text NOT NULL,
      phone text,
      address text,
      type text,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id bigserial PRIMARY KEY,
      name text NOT NULL,
      phone text,
      address text,
      type text,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS items (
      id bigserial PRIMARY KEY,
      sku text NOT NULL UNIQUE,
      name text NOT NULL,
      category text,
      brand text,
      spec text,
      qty numeric(18,3) NOT NULL DEFAULT 0,
      cost numeric(18,2) NOT NULL DEFAULT 0,
      sale_price numeric(18,2) NOT NULL DEFAULT 0,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS app_records (
      id bigserial PRIMARY KEY,
      collection text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS app_records_collection_idx ON app_records(collection);

    CREATE TABLE IF NOT EXISTS invoice_templates (
      id bigserial PRIMARY KEY,
      name text NOT NULL,
      original_filename text NOT NULL,
      mime_type text NOT NULL,
      content_base64 text NOT NULL,
      fields jsonb NOT NULL DEFAULT '{}'::jsonb,
      active boolean NOT NULL DEFAULT true,
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id bigserial PRIMARY KEY,
      at timestamptz NOT NULL DEFAULT now(),
      username text NOT NULL,
      action text NOT NULL,
      detail text
    );

    CREATE TABLE IF NOT EXISTS fiscal_periods (
      id bigserial PRIMARY KEY,
      name text NOT NULL,
      starts_on date NOT NULL,
      ends_on date NOT NULL,
      status text NOT NULL DEFAULT 'OPEN',
      closed_by text,
      closed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (starts_on <= ends_on),
      CHECK (status IN ('OPEN','CLOSED'))
    );

    CREATE TABLE IF NOT EXISTS cost_centers (
      id bigserial PRIMARY KEY,
      code text NOT NULL UNIQUE,
      name text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS analytic_accounts (
      id bigserial PRIMARY KEY,
      code text NOT NULL UNIQUE,
      name text NOT NULL,
      cost_center_id bigint REFERENCES cost_centers(id),
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id bigserial PRIMARY KEY,
      app_record_id bigint UNIQUE REFERENCES app_records(id) ON DELETE RESTRICT,
      entry_date date NOT NULL,
      source text NOT NULL,
      memo text NOT NULL DEFAULT '',
      currency text NOT NULL DEFAULT 'IQD',
      exchange_rate numeric(18,6) NOT NULL DEFAULT 1,
      status text NOT NULL DEFAULT 'POSTED',
      reversal_of bigint REFERENCES journal_entries(id),
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (exchange_rate > 0),
      CHECK (status IN ('DRAFT','POSTED','CANCELLED','REVERSED'))
    );

    CREATE TABLE IF NOT EXISTS journal_lines (
      id bigserial PRIMARY KEY,
      journal_entry_id bigint NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
      account_code text NOT NULL REFERENCES accounts(code) ON DELETE RESTRICT,
      debit numeric(18,2) NOT NULL DEFAULT 0,
      credit numeric(18,2) NOT NULL DEFAULT 0,
      debit_base numeric(18,2) NOT NULL DEFAULT 0,
      credit_base numeric(18,2) NOT NULL DEFAULT 0,
      cost_center_id bigint REFERENCES cost_centers(id),
      analytic_account_id bigint REFERENCES analytic_accounts(id),
      note text NOT NULL DEFAULT '',
      CHECK (debit >= 0),
      CHECK (credit >= 0),
      CHECK (NOT (debit > 0 AND credit > 0)),
      CHECK (debit > 0 OR credit > 0)
    );

    CREATE INDEX IF NOT EXISTS journal_lines_account_idx ON journal_lines(account_code);
    CREATE INDEX IF NOT EXISTS journal_entries_date_idx ON journal_entries(entry_date);

    CREATE TABLE IF NOT EXISTS stock_moves (
      id bigserial PRIMARY KEY,
      item_id bigint NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      move_date date NOT NULL,
      direction text NOT NULL,
      qty numeric(18,3) NOT NULL,
      unit_cost numeric(18,2) NOT NULL DEFAULT 0,
      source text NOT NULL,
      source_id text,
      serial_no text,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (qty > 0),
      CHECK (direction IN ('IN','OUT','ADJUST'))
    );

    CREATE TABLE IF NOT EXISTS inventory_layers (
      id bigserial PRIMARY KEY,
      item_id bigint NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      layer_date date NOT NULL,
      source text NOT NULL,
      source_id text,
      qty_in numeric(18,3) NOT NULL DEFAULT 0,
      qty_remaining numeric(18,3) NOT NULL DEFAULT 0,
      unit_cost numeric(18,2) NOT NULL DEFAULT 0,
      currency text NOT NULL DEFAULT 'IQD',
      exchange_rate numeric(18,6) NOT NULL DEFAULT 1,
      serial_no text,
      warranty_months integer,
      warranty_hours integer,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (qty_in >= 0),
      CHECK (qty_remaining >= 0),
      CHECK (unit_cost >= 0),
      CHECK (exchange_rate > 0)
    );

    CREATE INDEX IF NOT EXISTS inventory_layers_item_idx ON inventory_layers(item_id, layer_date, id);
    CREATE INDEX IF NOT EXISTS stock_moves_item_idx ON stock_moves(item_id, move_date);

    CREATE TABLE IF NOT EXISTS serial_numbers (
      id bigserial PRIMARY KEY,
      item_id bigint NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      serial_no text NOT NULL UNIQUE,
      engine_no text,
      customer_id bigint REFERENCES customers(id),
      warranty_starts_on date,
      warranty_years integer,
      warranty_hours integer,
      status text NOT NULL DEFAULT 'IN_STOCK',
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS maintenance_job_cards (
      id bigserial PRIMARY KEY,
      job_no text NOT NULL UNIQUE,
      customer_id bigint REFERENCES customers(id),
      serial_id bigint REFERENCES serial_numbers(id),
      status text NOT NULL DEFAULT 'OPEN',
      opened_at timestamptz NOT NULL DEFAULT now(),
      closed_at timestamptz,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role text NOT NULL,
      permission text NOT NULL,
      allowed boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (role, permission)
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id bigserial PRIMARY KEY,
      document_type text NOT NULL,
      document_id text NOT NULL,
      status text NOT NULL DEFAULT 'PENDING',
      requested_by text NOT NULL,
      approved_by text,
      approved_at timestamptz,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED'))
    );

    CREATE TABLE IF NOT EXISTS report_cache (
      cache_key text PRIMARY KEY,
      payload jsonb NOT NULL,
      refreshed_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS exchange_rates (
      id bigserial PRIMARY KEY,
      rate_date date NOT NULL,
      base_currency text NOT NULL,
      quote_currency text NOT NULL,
      rate numeric(18,6) NOT NULL,
      source text NOT NULL DEFAULT 'manual',
      note text NOT NULL DEFAULT '',
      created_by text NOT NULL DEFAULT 'system',
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (rate > 0)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS exchange_rates_unique_idx
      ON exchange_rates(rate_date, base_currency, quote_currency);

    CREATE TABLE IF NOT EXISTS posting_operations (
      id bigserial PRIMARY KEY,
      operation_type text NOT NULL,
      source_collection text NOT NULL,
      source_id text NOT NULL,
      status text NOT NULL DEFAULT 'PENDING',
      created_by text NOT NULL DEFAULT 'system',
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      result jsonb NOT NULL DEFAULT '{}'::jsonb,
      error_message text,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz,
      CHECK (status IN ('PENDING','POSTED','FAILED'))
    );

    CREATE INDEX IF NOT EXISTS posting_operations_lookup_idx
      ON posting_operations(operation_type, source_collection, source_id, started_at DESC);
  `);
  await pool.query(
    `INSERT INTO schema_migrations (version, name)
     VALUES (1, 'initial_production_schema')
     ON CONFLICT (version) DO NOTHING`
  );
  await pool.query("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS parent_code text REFERENCES accounts(code)");
  await pool.query("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'IQD'");
  await pool.query("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS nature text NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS classification text NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS level_no integer NOT NULL DEFAULT 1");
  await pool.query("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true");
  await pool.query("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false");
  await pool.query("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS posting_mode text NOT NULL DEFAULT 'transaction'");
  await pool.query("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_id bigserial");
  await pool.query("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS parent_id bigint");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS accounts_account_id_unique_idx ON accounts(account_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS accounts_parent_id_idx ON accounts(parent_id)");
  await pool.query("UPDATE accounts a SET parent_id = p.account_id FROM accounts p WHERE a.parent_code = p.code AND a.parent_id IS NULL");
  await pool.query("ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_posting_mode_chk");
  await pool.query("ALTER TABLE accounts ADD CONSTRAINT accounts_posting_mode_chk CHECK (posting_mode IN ('view','transaction','header','control'))");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS accounts_code_unique_idx ON accounts(code)");
  await pool.query(
    `INSERT INTO schema_migrations (version, name)
     VALUES (2, 'erp_core_accounting_inventory_controls')
     ON CONFLICT (version) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO schema_migrations (version, name)
     VALUES (3, 'dashboard_report_cache')
     ON CONFLICT (version) DO NOTHING`
  );

  for (const [code, name, type, level] of defaultAccounts) {
    await pool.query(
      `INSERT INTO accounts (code, name, type, level, is_system, posting_mode)
       VALUES ($1, $2, $3, $4, true, 'header')
       ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, type=EXCLUDED.type, level=EXCLUDED.level, is_system=true`,
      [code, name, type, level]
    );
  }

  const userCount = Number((await pool.query("SELECT count(*) AS count FROM users")).rows[0].count);
  if (!userCount) {
    const password = createPassword("ChangeMe-12345");
    await pool.query(
      `INSERT INTO users (name, username, role, password_salt, password_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      ["مدير النظام", "admin", "مدير", password.salt, password.hash]
    );
    await audit("system", "INIT", "Created PostgreSQL production database");
  }

  for (const role of ["مدير"]) {
    for (const [permission] of permissionCatalog) {
      await pool.query(
        `INSERT INTO role_permissions (role, permission, allowed)
         VALUES ($1,$2,true)
         ON CONFLICT (role, permission) DO NOTHING`,
        [role, permission]
      );
    }
  }

  await pool.query(
    `INSERT INTO meta (key, value)
     VALUES ('system_settings', $1::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify({ baseCurrency: "IQD", secondaryCurrency: "USD" })]
  );

  await pool.query(
    `INSERT INTO exchange_rates (rate_date, base_currency, quote_currency, rate, source, note, created_by)
     VALUES (current_date, 'IQD', 'USD', 0.00076, 'manual', 'initial seed', 'system')
     ON CONFLICT (rate_date, base_currency, quote_currency) DO NOTHING`
  );
}

async function audit(username, action, detail) {
  await pool.query(
    "INSERT INTO audit_log (username, action, detail) VALUES ($1, $2, $3)",
    [username || "system", action, detail || ""]
  );
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function sendBuffer(res, status, buffer, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(buffer);
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const [key, ...value] = part.trim().split("=");
    return [key, decodeURIComponent(value.join("="))];
  }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) reject(new Error("Request too large"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function currentSession(req) {
  const token = parseCookies(req).session;
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function requireSession(req, res) {
  const session = currentSession(req);
  if (!session) {
    sendJson(res, 401, { error: "UNAUTHENTICATED" });
    return null;
  }
  return session;
}

async function requirePermission(session, permission) {
  if (session.role === "مدير") return true;
  const result = await pool.query(
    "SELECT allowed FROM role_permissions WHERE role=$1 AND permission=$2",
    [session.role, permission]
  );
  return Boolean(result.rows[0]?.allowed);
}

function safePublicPath(urlPath) {
  const clean = urlPath === "/" ? "/index.html" : urlPath;
  const target = path.normalize(path.join(PUBLIC_DIR, clean));
  return target.startsWith(PUBLIC_DIR) ? target : null;
}

function serveStatic(req, res) {
  const target = safePublicPath(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (!target || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(target).toLowerCase();
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8" };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(target).pipe(res);
}

function num(value) {
  return Number(value || 0);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ");
}

function digitsOnly(value) {
  return String(value || "").replace(/\D+/g, "");
}

function calculatedBalances(journals) {
  const balances = {};
  for (const journal of journals || []) {
    if (Array.isArray(journal.lines)) {
      for (const line of journal.lines) {
        const code = String(line.accountCode || "");
        if (!code) continue;
        balances[code] = (balances[code] || 0) + num(line.debit) - num(line.credit);
      }
      continue;
    }
    if (journal.debitCode) balances[journal.debitCode] = (balances[journal.debitCode] || 0) + num(journal.amount);
    if (journal.creditCode) balances[journal.creditCode] = (balances[journal.creditCode] || 0) - num(journal.amount);
  }
  return balances;
}

async function loadSystemSettings() {
  const result = await pool.query("SELECT value FROM meta WHERE key='system_settings' LIMIT 1");
  const value = result.rows[0]?.value || {};
  return {
    baseCurrency: String(value.baseCurrency || "IQD").toUpperCase(),
    secondaryCurrency: String(value.secondaryCurrency || "USD").toUpperCase()
  };
}

async function loadSystemSettingsFromClient(client) {
  const result = await client.query("SELECT value FROM meta WHERE key='system_settings' LIMIT 1");
  const value = result.rows[0]?.value || {};
  return {
    baseCurrency: String(value.baseCurrency || "IQD").toUpperCase(),
    secondaryCurrency: String(value.secondaryCurrency || "USD").toUpperCase()
  };
}

async function normalizeJournalCurrency(client, currencyInput, exchangeRateInput) {
  const settings = await loadSystemSettingsFromClient(client);
  const baseCurrency = settings.baseCurrency || "IQD";
  const currency = String(currencyInput || baseCurrency).toUpperCase();
  if (currency === baseCurrency) return { currency, exchangeRate: 1 };
  const exchangeRate = num(exchangeRateInput);
  if (exchangeRate <= 0) throw new Error("Exchange rate must be greater than zero for non-base currency");
  return { currency, exchangeRate };
}

async function stateFromDb() {
  const [accounts, customers, suppliers, items, records, templates, settings, exchangeRates] = await Promise.all([
    pool.query("SELECT account_id AS id, code, name, type, level, parent_code AS \"parentCode\", parent_id AS \"parentId\", currency, nature, classification, level_no AS \"levelNo\", posting_mode AS \"postingMode\", active, is_system AS \"isSystem\" FROM accounts WHERE active=true ORDER BY length(code), code"),
    pool.query("SELECT id, name, phone, address, type, data, created_at AS \"createdAt\", updated_at AS \"updatedAt\" FROM customers ORDER BY id"),
    pool.query("SELECT id, name, phone, address, type, data, created_at AS \"createdAt\", updated_at AS \"updatedAt\" FROM suppliers ORDER BY id"),
    pool.query("SELECT id, sku, name, category, brand, spec, qty::float8 AS qty, cost::float8 AS cost, sale_price::float8 AS \"salePrice\", data, created_at AS \"createdAt\", updated_at AS \"updatedAt\" FROM items ORDER BY id"),
    pool.query("SELECT id, collection, payload, created_at AS \"createdAt\", updated_at AS \"updatedAt\" FROM app_records ORDER BY id"),
    pool.query("SELECT id, name, original_filename AS \"originalFilename\", active, created_by AS \"createdBy\", created_at AS \"createdAt\" FROM invoice_templates ORDER BY id DESC"),
    loadSystemSettings(),
    pool.query("SELECT id, rate_date AS \"rateDate\", base_currency AS \"baseCurrency\", quote_currency AS \"quoteCurrency\", rate::float8 AS rate, source, note, created_by AS \"createdBy\", created_at AS \"createdAt\" FROM exchange_rates ORDER BY rate_date DESC, id DESC LIMIT 120")
  ]);

  const grouped = {};
  for (const row of records.rows) {
    if (!grouped[row.collection]) grouped[row.collection] = [];
    grouped[row.collection].push({ id: Number(row.id), ...row.payload, createdAt: row.createdAt, updatedAt: row.updatedAt });
  }
  const balances = calculatedBalances(grouped.journals || []);

  return {
    meta: { name: "Generator ERP PostgreSQL", storage: "PostgreSQL" },
    accounts: accounts.rows.map((row) => ({ ...row, balance: balances[row.code] || 0 })),
    settings,
    exchangeRates: exchangeRates.rows,
    invoiceTemplates: templates.rows,
    customers: customers.rows.map((row) => ({ ...row, ...(row.data || {}) })),
    suppliers: suppliers.rows.map((row) => ({ ...row, ...(row.data || {}) })),
    items: items.rows.map((row) => ({ ...row, ...(row.data || {}) })),
    sales: grouped.sales || [],
    purchases: grouped.purchases || [],
    imports: grouped.imports || [],
    vouchers: grouped.vouchers || [],
    journals: grouped.journals || [],
    payrolls: grouped.payrolls || [],
    fixedAssets: grouped.fixedAssets || [],
    maintenanceRevenues: grouped.maintenanceRevenues || [],
    receipts: grouped.receipts || [],
    openingJournals: grouped.openingJournals || [],
    openingInventory: grouped.openingInventory || [],
    generators: grouped.generators || [],
    maintenance: grouped.maintenance || [],
    reservations: grouped.reservations || [],
    saleOrders: grouped.saleOrders || [],
    supplyOrders: grouped.supplyOrders || [],
    purchaseRequests: grouped.purchaseRequests || []
  };
}

async function getRecordCollection(collection) {
  const result = await pool.query(
    "SELECT id, payload FROM app_records WHERE collection=$1 ORDER BY id",
    [collection]
  );
  return result.rows.map((row) => ({ id: Number(row.id), ...(row.payload || {}) }));
}

function monthKey(dateValue) {
  return String(dateValue || new Date().toISOString()).slice(0, 7);
}

function lastMonthKeys(count = 6) {
  const now = new Date();
  const keys = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() - index, 1, 12));
    keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

function sumBy(rows, keyFn, valueFn) {
  const map = new Map();
  for (const row of rows || []) {
    const key = keyFn(row) || "غير محدد";
    map.set(key, num(map.get(key)) + num(valueFn(row)));
  }
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

async function buildDashboardReport() {
  const cache = await pool.query(
    "SELECT payload, refreshed_at FROM report_cache WHERE cache_key='executive_dashboard' AND refreshed_at > now() - interval '5 minutes'"
  );
  if (cache.rowCount) return { ...cache.rows[0].payload, cached: true, refreshedAt: cache.rows[0].refreshed_at };

  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartText = monthStart.toISOString().slice(0, 10);
  const monthKeys = lastMonthKeys(6);

  const financial = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN jl.account_code LIKE '4%' AND je.entry_date >= $1 THEN jl.credit_base - jl.debit_base ELSE 0 END),0)::float8 AS monthly_revenue,
       COALESCE(SUM(CASE WHEN jl.account_code LIKE '5%' AND je.entry_date >= $1 THEN jl.debit_base - jl.credit_base ELSE 0 END),0)::float8 AS monthly_expenses,
       COALESCE(SUM(CASE WHEN jl.account_code='151' THEN jl.debit_base - jl.credit_base ELSE 0 END),0)::float8 AS receivables,
       COALESCE(SUM(CASE WHEN jl.account_code='221' THEN jl.credit_base - jl.debit_base ELSE 0 END),0)::float8 AS payables,
       COALESCE(SUM(CASE WHEN jl.account_code IN ('1611','1612','1621','1622') THEN jl.debit_base - jl.credit_base ELSE 0 END),0)::float8 AS cash_bank
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_entry_id
     WHERE je.status='POSTED'`,
    [monthStartText]
  );

  const monthlyTrendRows = await pool.query(
    `SELECT to_char(date_trunc('month', je.entry_date), 'YYYY-MM') AS month,
       COALESCE(SUM(CASE WHEN jl.account_code LIKE '4%' THEN jl.credit_base - jl.debit_base ELSE 0 END),0)::float8 AS revenue,
       COALESCE(SUM(CASE WHEN jl.account_code LIKE '5%' THEN jl.debit_base - jl.credit_base ELSE 0 END),0)::float8 AS expenses
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_entry_id
     WHERE je.status='POSTED' AND je.entry_date >= (date_trunc('month', CURRENT_DATE) - interval '5 months')
     GROUP BY 1
     ORDER BY 1`
  );
  const trendByMonth = Object.fromEntries(monthlyTrendRows.rows.map((row) => [row.month, row]));
  const monthlyTrend = monthKeys.map((key) => {
    const row = trendByMonth[key] || {};
    const revenue = num(row.revenue);
    const expenses = num(row.expenses);
    return { month: key, revenue, expenses, profit: revenue - expenses };
  });

  const [sales, maintenance, items, supplyOrders, purchaseRequests] = await Promise.all([
    getRecordCollection("sales"),
    getRecordCollection("maintenance"),
    pool.query("SELECT id, sku, name, category, brand, qty::float8 AS qty, cost::float8 AS cost FROM items ORDER BY id"),
    getRecordCollection("supplyOrders"),
    getRecordCollection("purchaseRequests")
  ]);

  const stockMoves = await pool.query(
    `SELECT i.sku, i.name, i.category, sm.direction, SUM(sm.qty)::float8 AS qty
     FROM stock_moves sm
     JOIN items i ON i.id = sm.item_id
     GROUP BY i.sku, i.name, i.category, sm.direction
     ORDER BY qty DESC
     LIMIT 10`
  );

  const topCustomers = sumBy(sales, (row) => row.customerName, (row) => row.total).slice(0, 5);
  const salesByMonthMap = new Map(monthKeys.map((key) => [key, 0]));
  for (const row of sales) {
    const key = monthKey(row.date);
    if (salesByMonthMap.has(key)) salesByMonthMap.set(key, num(salesByMonthMap.get(key)) + num(row.total));
  }
  const salesByMonth = Array.from(salesByMonthMap.entries()).map(([month, value]) => ({ month, value }));
  const salesByGeneratorType = sumBy(
    sales.flatMap((sale) => (sale.lines || []).map((line) => ({ ...line, sale }))),
    (line) => line.category || (String(line.name || "").includes("مولد") ? "مولدات" : "مواد أخرى"),
    (line) => line.total
  ).slice(0, 6);
  const paidTotal = sales.reduce((sum, row) => sum + num(row.paidAmount), 0);
  const salesTotal = sales.reduce((sum, row) => sum + num(row.total), 0);

  const itemRows = items.rows || [];
  const lowStock = itemRows.filter((item) => num(item.qty) <= 2).slice(0, 8);
  const currentInventoryValue = itemRows.reduce((sum, item) => sum + (num(item.qty) * num(item.cost)), 0);
  const deadStock = itemRows.filter((item) => num(item.qty) > 0 && !stockMoves.rows.some((move) => move.sku === item.sku)).slice(0, 8);
  const warrantyItems = itemRows.filter((item) => String(item.category || "").includes("مولد") || String(item.data || "").includes("ضمان")).slice(0, 8);

  const openMaintenance = maintenance.filter((row) => !row.status || String(row.status).includes("OPEN") || String(row.status).includes("مفتوح"));
  const overdueContracts = purchaseRequests.filter((row) => String(row.status || "").includes("بانتظار")).slice(0, 8);

  const f = financial.rows[0] || {};
  const report = {
    refreshedAt: new Date().toISOString(),
    cached: false,
    financial: {
      monthlyRevenue: num(f.monthly_revenue),
      monthlyExpenses: num(f.monthly_expenses),
      netProfit: num(f.monthly_revenue) - num(f.monthly_expenses),
      cashFlow: num(f.cash_bank),
      receivables: num(f.receivables),
      payables: num(f.payables),
      cashAndBanks: num(f.cash_bank)
    },
    sales: {
      topCustomers,
      salesByMonth,
      salesByGeneratorType,
      collectionRate: salesTotal > 0 ? (paidTotal / salesTotal) * 100 : 0,
      bestSalesEmployee: "غير محدد"
    },
    maintenance: {
      openJobs: openMaintenance.length,
      repeatedFaults: [],
      topTechnicians: [],
      overdueContracts,
      costByCustomer: [],
      mostFailingGenerators: []
    },
    inventory: {
      lowStock,
      topMovingParts: stockMoves.rows,
      deadStock,
      currentValue: currentInventoryValue,
      warrantyItems,
      returnedParts: []
    },
    trends: {
      monthlyFinancial: monthlyTrend
    }
  };

  await pool.query(
    `INSERT INTO report_cache (cache_key, payload, refreshed_at)
     VALUES ('executive_dashboard', $1, now())
     ON CONFLICT (cache_key) DO UPDATE SET payload=EXCLUDED.payload, refreshed_at=now()`,
    [report]
  );
  return report;
}

async function usersPermissionsState() {
  const [users, permissions] = await Promise.all([
    pool.query(`SELECT id, name, username, role, active, failed_attempts AS "failedAttempts", created_at AS "createdAt", updated_at AS "updatedAt" FROM users ORDER BY id`),
    pool.query("SELECT role, permission, allowed FROM role_permissions ORDER BY role, permission")
  ]);
  const roles = Array.from(new Set([
    "مدير",
    "محاسب",
    "أمين مخزن",
    "مبيعات",
    "صيانة",
    ...users.rows.map((row) => row.role)
  ].filter(Boolean)));
  return {
    users: users.rows,
    roles,
    catalog: permissionCatalog.map(([key, label]) => ({ key, label })),
    permissions: permissions.rows
  };
}

async function saveUser(body) {
  const name = String(body.name || "").trim();
  const username = String(body.username || "").trim();
  const role = String(body.role || "موظف").trim();
  const active = body.active !== false && body.active !== "false";
  if (!name || !username) throw new Error("User name and username are required");

  if (body.id) {
    if (body.password) {
      const password = createPassword(String(body.password));
      const result = await pool.query(
        `UPDATE users
         SET name=$1, username=$2, role=$3, active=$4, password_salt=$5, password_hash=$6, failed_attempts=0, updated_at=now()
         WHERE id=$7 RETURNING id`,
        [name, username, role, active, password.salt, password.hash, Number(body.id)]
      );
      if (!result.rowCount) throw new Error("User not found");
      return Number(result.rows[0].id);
    }
    const result = await pool.query(
      `UPDATE users
       SET name=$1, username=$2, role=$3, active=$4, failed_attempts=0, updated_at=now()
       WHERE id=$5 RETURNING id`,
      [name, username, role, active, Number(body.id)]
    );
    if (!result.rowCount) throw new Error("User not found");
    return Number(result.rows[0].id);
  }

  if (!body.password || String(body.password).length < 8) throw new Error("Password must be at least 8 characters");
  const password = createPassword(String(body.password));
  const result = await pool.query(
    `INSERT INTO users (name, username, role, active, password_salt, password_hash)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [name, username, role, active, password.salt, password.hash]
  );
  return Number(result.rows[0].id);
}

async function saveRolePermissions(body) {
  const role = String(body.role || "").trim();
  const permissions = Array.isArray(body.permissions) ? body.permissions : [];
  if (!role) throw new Error("Role is required");
  await pool.query("DELETE FROM role_permissions WHERE role=$1", [role]);
  for (const [permission] of permissionCatalog) {
    await pool.query(
      `INSERT INTO role_permissions (role, permission, allowed)
       VALUES ($1,$2,$3)`,
      [role, permission, permissions.includes(permission)]
    );
  }
  return role;
}

async function saveCurrencySettings(body) {
  const baseCurrency = String(body.baseCurrency || "IQD").toUpperCase().trim();
  const secondaryCurrency = String(body.secondaryCurrency || "USD").toUpperCase().trim();
  if (!baseCurrency || !secondaryCurrency) throw new Error("Currencies are required");
  if (baseCurrency === secondaryCurrency) throw new Error("Base and secondary currencies must be different");
  const payload = { baseCurrency, secondaryCurrency };
  await pool.query(
    `INSERT INTO meta (key, value)
     VALUES ('system_settings', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
    [JSON.stringify(payload)]
  );
  return payload;
}

async function saveExchangeRate(body, username) {
  const rateDate = String(body.rateDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const baseCurrency = String(body.baseCurrency || "IQD").toUpperCase().trim();
  const quoteCurrency = String(body.quoteCurrency || "USD").toUpperCase().trim();
  const rate = num(body.rate);
  const source = String(body.source || "manual");
  const note = String(body.note || "");
  if (!baseCurrency || !quoteCurrency) throw new Error("Currencies are required");
  if (baseCurrency === quoteCurrency) throw new Error("Currencies must be different");
  if (rate <= 0) throw new Error("Rate must be greater than zero");
  await pool.query(
    `INSERT INTO exchange_rates (rate_date, base_currency, quote_currency, rate, source, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (rate_date, base_currency, quote_currency)
     DO UPDATE SET rate=EXCLUDED.rate, source=EXCLUDED.source, note=EXCLUDED.note, created_by=EXCLUDED.created_by, created_at=now()`,
    [rateDate, baseCurrency, quoteCurrency, rate, source, note, username || "system"]
  );
}

async function buildAccountLedger(accountCode, filters = {}) {
  const code = String(accountCode || "").trim();
  if (!code) throw new Error("Account code is required");
  const accountResult = await pool.query("SELECT code, name, type, level FROM accounts WHERE code=$1", [code]);
  if (!accountResult.rowCount) throw new Error("Account not found");

  const records = await pool.query(
    "SELECT id, payload, created_at AS \"createdAt\" FROM app_records WHERE collection='journals' ORDER BY COALESCE(payload->>'date', created_at::text), id"
  );
  const rows = [];
  for (const record of records.rows) {
    const journal = record.payload || {};
    if (Array.isArray(journal.lines)) {
      for (const line of journal.lines) {
        if (String(line.accountCode || "") !== code) continue;
        rows.push({
          journalId: Number(record.id),
          date: journal.date || String(record.createdAt).slice(0, 10),
          source: journal.source || "",
          memo: journal.memo || line.note || "",
          accountCode: code,
          debit: num(line.debit),
          credit: num(line.credit),
          createdAt: record.createdAt
        });
      }
      continue;
    }
    if (String(journal.debitCode || "") === code) {
      rows.push({
        journalId: Number(record.id),
        date: journal.date || String(record.createdAt).slice(0, 10),
        source: journal.source || "",
        memo: journal.memo || "",
        accountCode: code,
        debit: num(journal.amount),
        credit: 0,
        createdAt: record.createdAt
      });
    }
    if (String(journal.creditCode || "") === code) {
      rows.push({
        journalId: Number(record.id),
        date: journal.date || String(record.createdAt).slice(0, 10),
        source: journal.source || "",
        memo: journal.memo || "",
        accountCode: code,
        debit: 0,
        credit: num(journal.amount),
        createdAt: record.createdAt
      });
    }
  }

  const filteredRows = rows.filter((row) => {
    if (filters.dateFrom && row.date < filters.dateFrom) return false;
    if (filters.dateTo && row.date > filters.dateTo) return false;
    if (filters.source && row.source !== filters.source) return false;
    if (filters.side === "debit" && row.debit <= 0) return false;
    if (filters.side === "credit" && row.credit <= 0) return false;
    if (filters.search && !String(row.memo || "").includes(filters.search)) return false;
    return true;
  });

  let runningBalance = 0;
  const movements = filteredRows.map((row) => {
    runningBalance += row.debit - row.credit;
    return { ...row, balance: runningBalance };
  });
  return {
    account: accountResult.rows[0],
    totals: {
      debit: movements.reduce((sum, row) => sum + row.debit, 0),
      credit: movements.reduce((sum, row) => sum + row.credit, 0),
      balance: runningBalance
    },
    rows: movements
  };
}

async function buildTrialBalance(filters = {}) {
  const params = [];
  let dateWhere = "1=1";
  if (filters.dateFrom) {
    params.push(String(filters.dateFrom));
    dateWhere += ` AND je.entry_date >= $${params.length}::date`;
  }
  if (filters.dateTo) {
    params.push(String(filters.dateTo));
    dateWhere += ` AND je.entry_date <= $${params.length}::date`;
  }
  const rows = await pool.query(
    `SELECT a.code, a.name, a.type, a.level,
            COALESCE(SUM(jl.debit),0)::float8 AS debit,
            COALESCE(SUM(jl.credit),0)::float8 AS credit
     FROM accounts a
     LEFT JOIN journal_lines jl ON jl.account_code = a.code
     LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
     WHERE ${dateWhere}
     GROUP BY a.code, a.name, a.type, a.level
     ORDER BY length(a.code), a.code`,
    params
  );
  const items = rows.rows.map((row) => ({
    ...row,
    balance: num(row.debit) - num(row.credit)
  }));
  return {
    filters,
    totals: {
      debit: items.reduce((s, r) => s + num(r.debit), 0),
      credit: items.reduce((s, r) => s + num(r.credit), 0),
      balance: items.reduce((s, r) => s + num(r.balance), 0)
    },
    rows: items
  };
}

async function buildFinancialStatements(filters = {}) {
  const tb = await buildTrialBalance(filters);
  const byGroup = { assets: [], liabilities: [], equity: [], revenues: [], expenses: [] };
  for (const row of tb.rows) {
    const code = String(row.code || "");
    const first = code.charAt(0);
    if (first === "1") byGroup.assets.push(row);
    else if (first === "2") byGroup.liabilities.push(row);
    else if (first === "3") byGroup.equity.push(row);
    else if (first === "4") byGroup.revenues.push(row);
    else if (first === "5") byGroup.expenses.push(row);
  }
  const sumBal = (rows) => rows.reduce((s, r) => s + num(r.balance), 0);
  const totalRevenues = Math.abs(sumBal(byGroup.revenues));
  const totalExpenses = Math.abs(sumBal(byGroup.expenses));
  const netProfit = totalRevenues - totalExpenses;
  const totalAssets = sumBal(byGroup.assets);
  const totalLiabilities = Math.abs(sumBal(byGroup.liabilities));
  const totalEquity = Math.abs(sumBal(byGroup.equity)) + netProfit;
  return {
    filters,
    incomeStatement: {
      revenues: byGroup.revenues,
      expenses: byGroup.expenses,
      totals: { revenues: totalRevenues, expenses: totalExpenses, netProfit }
    },
    balanceSheet: {
      assets: byGroup.assets,
      liabilities: byGroup.liabilities,
      equity: byGroup.equity,
      totals: { assets: totalAssets, liabilities: totalLiabilities, equity: totalEquity, liabilitiesAndEquity: totalLiabilities + totalEquity }
    }
  };
}

async function upsertCore(client, collection, record) {
  const now = new Date();
  if (collection === "customers") {
    if (record.id) {
      const result = await client.query(
        `UPDATE customers SET name=$1, phone=$2, address=$3, type=$4, data=$5, updated_at=$6 WHERE id=$7 RETURNING id`,
        [record.name, record.phone || "", record.address || "", record.type || "", record, now, record.id]
      );
      if (!result.rowCount) throw new Error("Customer not found");
      return Number(record.id);
    }
    const result = await client.query(
      `INSERT INTO customers (name, phone, address, type, data) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [record.name, record.phone || "", record.address || "", record.type || "", record]
    );
    return Number(result.rows[0].id);
  }

  if (collection === "suppliers") {
    if (record.id) {
      const result = await client.query(
        `UPDATE suppliers SET name=$1, phone=$2, address=$3, type=$4, data=$5, updated_at=$6 WHERE id=$7 RETURNING id`,
        [record.name, record.phone || "", record.address || "", record.type || "", record, now, record.id]
      );
      if (!result.rowCount) throw new Error("Supplier not found");
      return Number(record.id);
    }
    const result = await client.query(
      `INSERT INTO suppliers (name, phone, address, type, data) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [record.name, record.phone || "", record.address || "", record.type || "", record]
    );
    return Number(result.rows[0].id);
  }

  if (collection === "items") {
    if (record.id) {
      const result = await client.query(
        `UPDATE items SET sku=$1, name=$2, category=$3, brand=$4, spec=$5, qty=$6, cost=$7, sale_price=$8, data=$9, updated_at=$10 WHERE id=$11 RETURNING id`,
        [record.sku, record.name, record.category || "", record.brand || "", record.spec || "", num(record.qty), num(record.cost), num(record.salePrice), record, now, record.id]
      );
      if (!result.rowCount) throw new Error("Item not found");
      return Number(record.id);
    }
    const result = await client.query(
      `INSERT INTO items (sku, name, category, brand, spec, qty, cost, sale_price, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [record.sku, record.name, record.category || "", record.brand || "", record.spec || "", num(record.qty), num(record.cost), num(record.salePrice), record]
    );
    return Number(result.rows[0].id);
  }

  throw new Error("Unsupported core collection");
}

async function upsertRecord(client, collection, record) {
  if (["customers", "suppliers", "items"].includes(collection)) return upsertCore(client, collection, record);
  const allowed = new Set(["sales", "purchases", "imports", "vouchers", "journals", "generators", "maintenance", "reservations", "saleOrders", "supplyOrders", "purchaseRequests"]);
  if (!allowed.has(collection)) throw new Error("Collection not allowed");

  if (record.id) {
    const result = await client.query(
      `UPDATE app_records SET payload=$1, updated_at=now() WHERE collection=$2 AND id=$3 RETURNING id`,
      [record, collection, record.id]
    );
    if (!result.rowCount) throw new Error("Record not found");
    return Number(record.id);
  }

  const result = await client.query(
    `INSERT INTO app_records (collection, payload) VALUES ($1, $2) RETURNING id`,
    [collection, record]
  );
  return Number(result.rows[0].id);
}

async function assertPeriodOpen(client, entryDate) {
  const result = await client.query(
    `SELECT name FROM fiscal_periods
     WHERE $1::date BETWEEN starts_on AND ends_on AND status='CLOSED'
     LIMIT 1`,
    [entryDate]
  );
  if (result.rowCount) throw new Error(`Fiscal period is closed: ${result.rows[0].name}`);
}

async function executePostingPipeline(
  client,
  { operationType, sourceCollection, sourceId, createdBy, payload, runner, finalSourceIdResolver }
) {
  const start = await client.query(
    `INSERT INTO posting_operations
      (operation_type, source_collection, source_id, status, created_by, payload)
     VALUES ($1,$2,$3,'PENDING',$4,$5)
     RETURNING id`,
    [
      String(operationType || "UNKNOWN"),
      String(sourceCollection || "app_records"),
      String(sourceId || `TEMP-${Date.now()}`),
      String(createdBy || "system"),
      payload || {}
    ]
  );
  const pipelineId = Number(start.rows[0].id);
  try {
    const result = await runner();
    const finalSourceId = finalSourceIdResolver ? finalSourceIdResolver(result) : sourceId;
    await client.query(
      `UPDATE posting_operations
       SET status='POSTED', result=$1, source_id=$2, finished_at=now(), error_message=NULL
       WHERE id=$3`,
      [result || {}, String(finalSourceId || sourceId || ""), pipelineId]
    );
    return { pipelineId, result };
  } catch (error) {
    await client.query(
      `UPDATE posting_operations
       SET status='FAILED', error_message=$1, finished_at=now()
       WHERE id=$2`,
      [String(error.message || error), pipelineId]
    );
    throw error;
  }
}

async function insertStructuredJournal(client, appRecordId, journal) {
  const entryDate = journal.date || new Date().toISOString().slice(0, 10);
  await assertPeriodOpen(client, entryDate);
  const lines = Array.isArray(journal.lines) ? journal.lines : [
    { accountCode: journal.debitCode, debit: num(journal.amount), credit: 0, note: journal.memo || "" },
    { accountCode: journal.creditCode, debit: 0, credit: num(journal.amount), note: journal.memo || "" }
  ];
  const debitTotal = lines.reduce((sum, line) => sum + num(line.debit), 0);
  const creditTotal = lines.reduce((sum, line) => sum + num(line.credit), 0);
  if (Math.abs(debitTotal - creditTotal) > 0.001) throw new Error("Structured journal is not balanced");

  const currency = String(journal.currency || "IQD").toUpperCase();
  const exchangeRate = num(journal.exchangeRate || 1) || 1;
  const entry = await client.query(
    `INSERT INTO journal_entries
       (app_record_id, entry_date, source, memo, currency, exchange_rate, status, payload)
     VALUES ($1,$2,$3,$4,$5,$6,'POSTED',$7)
     ON CONFLICT (app_record_id) DO UPDATE SET
       entry_date=EXCLUDED.entry_date,
       source=EXCLUDED.source,
       memo=EXCLUDED.memo,
       currency=EXCLUDED.currency,
       exchange_rate=EXCLUDED.exchange_rate,
       payload=EXCLUDED.payload
     RETURNING id`,
    [appRecordId, entryDate, journal.source || "Journal Entry", journal.memo || "", currency, exchangeRate, journal]
  );
  const entryId = Number(entry.rows[0].id);
  await client.query("DELETE FROM journal_lines WHERE journal_entry_id=$1", [entryId]);
  for (const line of lines) {
    const debit = num(line.debit);
    const credit = num(line.credit);
    if (!line.accountCode || (debit <= 0 && credit <= 0)) continue;
    await client.query(
      `INSERT INTO journal_lines
        (journal_entry_id, account_code, debit, credit, debit_base, credit_base, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [entryId, String(line.accountCode), debit, credit, debit * exchangeRate, credit * exchangeRate, line.note || ""]
    );
  }
  return entryId;
}

async function assertTransactionAccount(client, accountCode) {
  const result = await client.query(
    "SELECT code, posting_mode AS \"postingMode\", active FROM accounts WHERE code=$1",
    [String(accountCode || "").trim()]
  );
  if (!result.rowCount) throw new Error(`Account not found: ${accountCode}`);
  const row = result.rows[0];
  if (!row.active) throw new Error(`Account is archived: ${accountCode}`);
  if (String(row.postingMode || "transaction") !== "transaction") {
    throw new Error(`الحساب ${accountCode} تجميعي ولا يقبل قيود مباشرة`);
  }
}

async function recordStockIn(client, { itemId, qty, unitCost, source, sourceId, moveDate, serialNo, payload }) {
  const date = moveDate || new Date().toISOString().slice(0, 10);
  const quantity = num(qty);
  const cost = num(unitCost);
  if (!itemId || quantity <= 0) throw new Error("Invalid stock-in movement");
  await client.query(
    `INSERT INTO stock_moves (item_id, move_date, direction, qty, unit_cost, source, source_id, serial_no, payload)
     VALUES ($1,$2,'IN',$3,$4,$5,$6,$7,$8)`,
    [itemId, date, quantity, cost, source || "Stock In", sourceId || "", serialNo || "", payload || {}]
  );
  await client.query(
    `INSERT INTO inventory_layers
       (item_id, layer_date, source, source_id, qty_in, qty_remaining, unit_cost, serial_no, warranty_months, warranty_hours, payload)
     VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10)`,
    [
      itemId,
      date,
      source || "Stock In",
      sourceId || "",
      quantity,
      cost,
      serialNo || "",
      payload?.warrantyMonths ? Number(payload.warrantyMonths) : null,
      payload?.warrantyHours ? Number(payload.warrantyHours) : null,
      payload || {}
    ]
  );
}

async function recordStockOut(client, { itemId, qty, source, sourceId, moveDate, serialNo, payload }) {
  const date = moveDate || new Date().toISOString().slice(0, 10);
  const quantity = num(qty);
  if (!itemId || quantity <= 0) throw new Error("Invalid stock-out movement");
  let remaining = quantity;
  let weightedCost = 0;
  const layers = await client.query(
    `SELECT id, qty_remaining::float8 AS qty_remaining, unit_cost::float8 AS unit_cost
     FROM inventory_layers
     WHERE item_id=$1 AND qty_remaining > 0
     ORDER BY layer_date, id
     FOR UPDATE`,
    [itemId]
  );
  for (const layer of layers.rows) {
    if (remaining <= 0) break;
    const used = Math.min(remaining, num(layer.qty_remaining));
    weightedCost += used * num(layer.unit_cost);
    remaining -= used;
    await client.query("UPDATE inventory_layers SET qty_remaining=qty_remaining-$1 WHERE id=$2", [used, layer.id]);
  }
  const unitCost = weightedCost > 0 ? weightedCost / (quantity - remaining) : 0;
  await client.query(
    `INSERT INTO stock_moves (item_id, move_date, direction, qty, unit_cost, source, source_id, serial_no, payload)
     VALUES ($1,$2,'OUT',$3,$4,$5,$6,$7,$8)`,
    [itemId, date, quantity, unitCost, source || "Stock Out", sourceId || "", serialNo || "", payload || {}]
  );
}

async function postJournal(client, { memo, debitCode, creditCode, amount, source, date, payload, currency, exchangeRate }) {
  const value = num(amount);
  if (!debitCode || !creditCode || value <= 0) throw new Error("Invalid journal");
  await assertTransactionAccount(client, debitCode);
  await assertTransactionAccount(client, creditCode);
  const currencyInfo = await normalizeJournalCurrency(client, currency || payload?.currency, exchangeRate || payload?.exchangeRate);
  const journal = {
    memo,
    debitCode,
    creditCode,
    amount: value,
    source,
    date: date || payload?.date || new Date().toISOString().slice(0, 10),
    currency: currencyInfo.currency,
    exchangeRate: currencyInfo.exchangeRate,
    ...(payload || {})
  };
  const result = await client.query(
    "INSERT INTO app_records (collection, payload) VALUES ('journals', $1) RETURNING id",
    [journal]
  );
  await insertStructuredJournal(client, Number(result.rows[0].id), journal);
  return Number(result.rows[0].id);
}

async function postBalancedJournal(client, { memo, source, date, lines, payload, currency, exchangeRate }) {
  if (!Array.isArray(lines) || lines.length < 2) throw new Error("Journal needs at least two lines");
  const cleanLines = lines.map((line) => ({
    accountCode: String(line.accountCode || "").trim(),
    debit: num(line.debit),
    credit: num(line.credit),
    note: String(line.note || "").trim()
  })).filter((line) => line.accountCode && (line.debit > 0 || line.credit > 0));
  if (cleanLines.length < 2) throw new Error("Journal needs at least two valid lines");

  const debitTotal = cleanLines.reduce((sum, line) => sum + line.debit, 0);
  const creditTotal = cleanLines.reduce((sum, line) => sum + line.credit, 0);
  if (debitTotal <= 0 || creditTotal <= 0) throw new Error("Journal totals must be greater than zero");
  if (Math.abs(debitTotal - creditTotal) > 0.001) throw new Error("Journal is not balanced");

  for (const line of cleanLines) await assertTransactionAccount(client, line.accountCode);

  const currencyInfo = await normalizeJournalCurrency(client, currency || payload?.currency, exchangeRate || payload?.exchangeRate);
  const journal = {
    memo: memo || source || "قيد محاسبي",
    source: source || "قيد محاسبي",
    date: date || new Date().toISOString().slice(0, 10),
    currency: currencyInfo.currency,
    exchangeRate: currencyInfo.exchangeRate,
    debitTotal,
    creditTotal,
    amount: debitTotal,
    lines: cleanLines,
    ...(payload || {})
  };
  const result = await client.query(
    "INSERT INTO app_records (collection, payload) VALUES ('journals', $1) RETURNING id",
    [journal]
  );
  await insertStructuredJournal(client, Number(result.rows[0].id), journal);
  return Number(result.rows[0].id);
}

async function postReceipt(client, body) {
  const amount = num(body.amount);
  if (amount <= 0) throw new Error("Receipt amount must be greater than zero");
  const receiptType = body.receiptType || "عربون";
  const paymentMethod = body.paymentMethod || "نقدا";
  const debitCode = paymentMethod === "دفع إلكتروني" ? "1621" : (body.cashAccountCode || "1611");
  const creditCode = body.accountCode || "151";
  const date = body.date || new Date().toISOString().slice(0, 10);
  const journalId = await postJournal(client, {
    memo: `سند قبض - ${receiptType} - ${body.customerName || "زبون"} - ${body.memo || ""}`,
    debitCode,
    creditCode,
    amount,
    source: "سند قبض",
    currency: body.currency,
    exchangeRate: body.exchangeRate,
    payload: { ...body, receiptType, paymentMethod, bankAccountCode: debitCode === "1621" ? "1621" : "" }
  });
  await client.query("INSERT INTO app_records (collection, payload) VALUES ('receipts', $1)", [{
    ...body,
    receiptType,
    paymentMethod,
    cashAccountCode: debitCode,
    bankAccountCode: debitCode === "1621" ? "1621" : "",
    accountCode: creditCode,
    amount,
    journalId,
    date
  }]);
  return journalId;
}

async function postOpeningJournal(client, body) {
  const journalId = await postBalancedJournal(client, {
    memo: body.memo || "قيد افتتاحي",
    source: "قيد افتتاحي",
    date: body.date,
    currency: body.currency,
    exchangeRate: body.exchangeRate,
    lines: body.lines || [],
    payload: { openingType: "قيد افتتاحي" }
  });
  await client.query("INSERT INTO app_records (collection, payload) VALUES ('openingJournals', $1)", [{
    memo: body.memo || "قيد افتتاحي",
    date: body.date || new Date().toISOString().slice(0, 10),
    lines: body.lines || [],
    journalId
  }]);
  return journalId;
}

function inventoryAccountCode(category) {
  const value = String(category || "");
  if (value.includes("مولد")) return "1211";
  if (value.includes("قطع")) return "1212";
  if (value.includes("زيت")) return "1213";
  return "121";
}

function cogsAccountCode(category) {
  const value = String(category || "");
  if (value.includes("مولد")) return "511";
  if (value.includes("قطع")) return "512";
  if (value.includes("زيت")) return "513";
  return "511";
}

function revenueAccountCode(line) {
  const value = `${line?.category || ""} ${line?.name || ""} ${line?.sku || ""}`;
  if (value.includes("قطع")) return "412";
  if (value.includes("زيت")) return "412";
  return "411";
}

async function postOpeningInventory(client, body) {
  const qty = num(body.qty);
  const cost = num(body.cost);
  const salePrice = num(body.salePrice);
  const amount = qty * cost;
  if (!body.sku || !body.name) throw new Error("Opening inventory item needs sku and name");
  if (qty <= 0 || cost < 0 || amount <= 0) throw new Error("Opening inventory quantity and cost must be valid");

  const existing = await client.query("SELECT id, qty::float8 AS qty, cost::float8 AS cost FROM items WHERE sku=$1", [body.sku]);
  let itemId;
  if (existing.rowCount) {
    const row = existing.rows[0];
    const oldQty = num(row.qty);
    const oldCost = num(row.cost);
    const newQty = oldQty + qty;
    const weightedCost = newQty > 0 ? ((oldQty * oldCost) + amount) / newQty : cost;
    await client.query(
      `UPDATE items SET name=$1, category=$2, brand=$3, spec=$4, qty=$5, cost=$6, sale_price=$7, data=$8, updated_at=now() WHERE id=$9`,
      [body.name, body.category || "بضاعة أول مدة", body.brand || "", body.spec || "", newQty, weightedCost, salePrice, body, row.id]
    );
    itemId = Number(row.id);
  } else {
    const result = await client.query(
      `INSERT INTO items (sku, name, category, brand, spec, qty, cost, sale_price, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [body.sku, body.name, body.category || "بضاعة أول مدة", body.brand || "", body.spec || "", qty, cost, salePrice, body]
    );
    itemId = Number(result.rows[0].id);
  }

  const journalId = await postJournal(client, {
    memo: `قيد بضاعة أول مدة - ${body.sku} - ${body.name}`,
    debitCode: inventoryAccountCode(body.category),
    creditCode: body.creditAccountCode || "31",
    amount,
    source: "بضاعة أول مدة",
    currency: body.currency,
    exchangeRate: body.exchangeRate,
    payload: { ...body, qty, cost, salePrice, amount, itemId }
  });
  await recordStockIn(client, {
    itemId,
    qty,
    unitCost: cost,
    source: "Opening Inventory",
    sourceId: String(journalId),
    moveDate: body.date,
    serialNo: body.serialNo || "",
    payload: { ...body, journalId, amount }
  });
  await client.query("INSERT INTO app_records (collection, payload) VALUES ('openingInventory', $1)", [{
    ...body,
    qty,
    cost,
    salePrice,
    amount,
    itemId,
    journalId,
    date: body.date || new Date().toISOString().slice(0, 10)
  }]);
  return journalId;
}

function cleanSaleLines(lines) {
  if (!Array.isArray(lines)) throw new Error("Invoice lines are required");
  return lines.map((line) => {
    const qty = num(line.qty);
    const unitPrice = num(line.unitPrice);
    const sku = String(line.sku || "").trim();
    const name = String(line.name || "").trim();
    if (!sku || qty <= 0 || unitPrice < 0) return null;
    return {
      sku,
      name,
      category: String(line.category || "").trim(),
      qty,
      unitPrice,
      total: qty * unitPrice,
      note: String(line.note || "").trim()
    };
  }).filter(Boolean);
}

const invoiceWorkflowStages = [
  "Draft",
  "Sales Review",
  "Pending Cashier Approval",
  "Pending Warehouse Approval",
  "Pending Accounting Verification",
  "Ready For Posting",
  "Posted",
  "Delivered",
  "Invoice Closed"
];

function stageIndex(stage) {
  return invoiceWorkflowStages.indexOf(String(stage || ""));
}

function ensureStageForward(currentStage, nextStage) {
  const current = stageIndex(currentStage);
  const next = stageIndex(nextStage);
  if (current === -1 || next === -1 || next !== current + 1) {
    throw new Error(`Invalid workflow transition from ${currentStage} to ${nextStage}`);
  }
}

async function postSalesInvoice(client, body) {
  const lines = cleanSaleLines(body.lines || []);
  if (!body.customerName) throw new Error("Customer name is required");
  if (!lines.length) throw new Error("Invoice needs at least one valid line");
  const total = lines.reduce((sum, line) => sum + line.total, 0);
  const invoice = {
    invoiceNo: body.invoiceNo || `INV-${Date.now()}`,
    customerName: body.customerName,
    customerPhone: body.customerPhone || "",
    date: body.date || new Date().toISOString().slice(0, 10),
    lines,
    total,
    paidAmount: 0,
    balance: total,
    paymentStatus: "غير مقبوض",
    status: "فاتورة صادرة - بانتظار القبض",
    memo: body.memo || ""
  };
  const result = await client.query(
    "INSERT INTO app_records (collection, payload) VALUES ('sales', $1) RETURNING id",
    [invoice]
  );
  const invoiceId = Number(result.rows[0].id);
  const groupedRevenue = new Map();
  for (const line of lines) {
    const accountCode = revenueAccountCode(line);
    groupedRevenue.set(accountCode, num(groupedRevenue.get(accountCode)) + num(line.total));
  }
  const journalId = await postBalancedJournal(client, {
    memo: `Sales invoice ${invoice.invoiceNo} - ${invoice.customerName}`,
    source: "Sales Invoice",
    date: invoice.date,
    currency: body.currency,
    exchangeRate: body.exchangeRate,
    lines: [
      { accountCode: "151", debit: total, credit: 0, note: invoice.customerName },
      ...Array.from(groupedRevenue.entries()).map(([accountCode, amount]) => ({
        accountCode,
        debit: 0,
        credit: amount,
        note: invoice.invoiceNo
      }))
    ],
    payload: { invoiceId, invoiceNo: invoice.invoiceNo, customerName: invoice.customerName }
  });
  await client.query(
    "UPDATE app_records SET payload=$1, updated_at=now() WHERE collection='sales' AND id=$2",
    [{ ...invoice, journalId }, invoiceId]
  );
  await client.query("INSERT INTO app_records (collection, payload) VALUES ('reservations', $1)", [{
    invoiceId,
    invoiceNo: invoice.invoiceNo,
    customerName: invoice.customerName,
    date: invoice.date,
    lines: invoice.lines,
    status: "حجز أولي بعد إنشاء الفاتورة",
    memo: "تم إنشاء حجز تلقائي عند قطع الفاتورة"
  }]);
  return invoiceId;
}

async function loadRecord(client, collection, id) {
  const result = await client.query("SELECT id, payload FROM app_records WHERE collection=$1 AND id=$2 FOR UPDATE", [collection, id]);
  if (!result.rowCount) throw new Error(`${collection} record not found`);
  return { id: Number(result.rows[0].id), payload: result.rows[0].payload || {} };
}

async function postInvoicePayment(client, body) {
  const invoice = await loadRecord(client, "sales", Number(body.invoiceId));
  const amount = num(body.amount);
  if (amount <= 0) throw new Error("Payment amount must be greater than zero");
  const total = num(invoice.payload.total);
  const paidAmount = num(invoice.payload.paidAmount) + amount;
  const balance = Math.max(0, total - paidAmount);
  const paymentStatus = balance <= 0 ? "مدفوع بالكامل" : "مدفوع جزئيا";

  const journalId = await postReceipt(client, {
    customerName: invoice.payload.customerName,
    amount,
    receiptType: body.receiptType || "عربون",
    paymentMethod: body.paymentMethod || "نقدا",
    cashAccountCode: body.cashAccountCode || "1611",
    accountCode: "151",
    currency: body.currency,
    exchangeRate: body.exchangeRate,
    memo: `قبض فاتورة ${invoice.payload.invoiceNo || invoice.id} - ${body.memo || ""}`
  });

  const updatedInvoice = {
    ...invoice.payload,
    paidAmount,
    balance,
    paymentStatus,
    status: "مقبوضة - بانتظار التجهيز",
    lastReceiptJournalId: journalId
  };
  await client.query("UPDATE app_records SET payload=$1, updated_at=now() WHERE collection='sales' AND id=$2", [updatedInvoice, invoice.id]);

  const existingOrder = await client.query("SELECT id FROM app_records WHERE collection='supplyOrders' AND payload->>'invoiceId'=$1 LIMIT 1", [String(invoice.id)]);
  let supplyOrderId = existingOrder.rows[0]?.id ? Number(existingOrder.rows[0].id) : null;
  if (!supplyOrderId) {
    const order = {
      invoiceId: invoice.id,
      invoiceNo: invoice.payload.invoiceNo,
      customerName: invoice.payload.customerName,
      date: new Date().toISOString().slice(0, 10),
      lines: invoice.payload.lines || [],
      status: "وصل إلى أمين المخزن - بانتظار التجهيز",
      memo: "أمر تجهيز صادر بعد قبض الحسابات"
    };
    const orderResult = await client.query(
      "INSERT INTO app_records (collection, payload) VALUES ('supplyOrders', $1) RETURNING id",
      [order]
    );
    supplyOrderId = Number(orderResult.rows[0].id);
  }

  const reservationResult = await client.query(
    "SELECT id, payload FROM app_records WHERE collection='reservations' AND payload->>'invoiceId'=$1 ORDER BY id DESC LIMIT 1 FOR UPDATE",
    [String(invoice.id)]
  );
  if (reservationResult.rowCount) {
    const reservation = reservationResult.rows[0].payload || {};
    await client.query(
      "UPDATE app_records SET payload=$1, updated_at=now() WHERE collection='reservations' AND id=$2",
      [{
        ...reservation,
        status: "تم القبض - جاهز للتجهيز",
        receiptType: body.receiptType || "عربون",
        paymentMethod: body.paymentMethod || "نقدا",
        paidAt: new Date().toISOString(),
        supplyOrderId
      }, Number(reservationResult.rows[0].id)]
    );
  }

  return { journalId, supplyOrderId };
}

async function processSupplyOrder(client, body) {
  const order = await loadRecord(client, "supplyOrders", Number(body.orderId));
  if (order.payload.processedAt) throw new Error("أمر التجهيز نُفِّذ مسبقاً ولا يمكن تنفيذه مرة أخرى");
  const lines = order.payload.lines || [];
  if (!lines.length) throw new Error("Supply order has no lines");
  const issued = [];
  const missing = [];
  const cogsLines = [];

  for (const line of lines) {
    const item = await client.query(
      "SELECT id, sku, name, category, qty::float8 AS qty, cost::float8 AS cost FROM items WHERE sku=$1 FOR UPDATE",
      [line.sku]
    );
    const available = item.rows[0] ? num(item.rows[0].qty) : 0;
    const requested = num(line.qty);
    if (item.rowCount && available >= requested) {
      await client.query("UPDATE items SET qty=qty-$1, updated_at=now() WHERE id=$2", [requested, item.rows[0].id]);
      await recordStockOut(client, {
        itemId: Number(item.rows[0].id),
        qty: requested,
        source: "Supply Order",
        sourceId: String(order.id),
        moveDate: new Date().toISOString().slice(0, 10),
        serialNo: line.serialNo || "",
        payload: { ...line, supplyOrderId: order.id, invoiceId: order.payload.invoiceId }
      });
      const costAmount = requested * num(item.rows[0].cost);
      if (costAmount > 0) {
        cogsLines.push(
          { accountCode: cogsAccountCode(item.rows[0].category), debit: costAmount, credit: 0, note: line.sku },
          { accountCode: inventoryAccountCode(item.rows[0].category), debit: 0, credit: costAmount, note: line.sku }
        );
      }
      issued.push({ ...line, issuedQty: requested, costAmount });
    } else {
      missing.push({ ...line, availableQty: available, missingQty: Math.max(0, requested - available) });
    }
  }

  let purchaseRequestId = null;
  if (missing.length) {
    const request = {
      supplyOrderId: order.id,
      invoiceId: order.payload.invoiceId,
      invoiceNo: order.payload.invoiceNo,
      customerName: order.payload.customerName,
      date: new Date().toISOString().slice(0, 10),
      lines: missing,
      status: "طلب شراء بانتظار المشتريات",
      memo: "مواد غير متوفرة من أمر التجهيز"
    };
    const requestResult = await client.query(
      "INSERT INTO app_records (collection, payload) VALUES ('purchaseRequests', $1) RETURNING id",
      [request]
    );
    purchaseRequestId = Number(requestResult.rows[0].id);
  }

  const status = missing.length ? "مجهز جزئيا - يوجد طلب شراء" : "مجهز ومخرج من المخزن";
  await client.query(
    "UPDATE app_records SET payload=$1, updated_at=now() WHERE collection='supplyOrders' AND id=$2",
    [{ ...order.payload, status, issued, missing, purchaseRequestId, processedAt: new Date().toISOString() }, order.id]
  );
  const reservationResult = await client.query(
    "SELECT id, payload FROM app_records WHERE collection='reservations' AND payload->>'invoiceId'=$1 ORDER BY id DESC LIMIT 1 FOR UPDATE",
    [String(order.payload.invoiceId || "")]
  );
  if (reservationResult.rowCount) {
    const reservation = reservationResult.rows[0].payload || {};
    await client.query(
      "UPDATE app_records SET payload=$1, updated_at=now() WHERE collection='reservations' AND id=$2",
      [{
        ...reservation,
        status: missing.length ? "تجهيز جزئي - بانتظار شراء النواقص" : "مجهز ومغلق",
        issued,
        missing,
        processedAt: new Date().toISOString()
      }, Number(reservationResult.rows[0].id)]
    );
  }
  if (order.payload.invoiceId) {
    const invoice = await loadRecord(client, "sales", Number(order.payload.invoiceId));
    await client.query(
      "UPDATE app_records SET payload=$1, updated_at=now() WHERE collection='sales' AND id=$2",
      [{ ...invoice.payload, status: missing.length ? "تجهيز جزئي - بانتظار شراء النواقص" : "مجهزة ومخرجة من المخزن" }, invoice.id]
    );
  }
  let cogsJournalId = null;
  if (cogsLines.length) {
    cogsJournalId = await postBalancedJournal(client, {
      memo: `Inventory issue for supply order ${order.id}`,
      source: "Inventory Issue",
      date: new Date().toISOString().slice(0, 10),
      lines: cogsLines,
      payload: { supplyOrderId: order.id, invoiceId: order.payload.invoiceId }
    });
  }
  return { orderId: order.id, status, issued, missing, purchaseRequestId, cogsJournalId };
}

async function setInvoiceStage(client, invoiceId, nextStage, patch = {}) {
  const invoice = await loadRecord(client, "sales", Number(invoiceId));
  const current = String(invoice.payload.workflowStage || invoice.payload.status || "Draft");
  if (current !== nextStage && stageIndex(current) !== -1 && stageIndex(nextStage) !== -1) ensureStageForward(current, nextStage);
  const updated = {
    ...invoice.payload,
    workflowStage: nextStage,
    status: nextStage,
    ...patch
  };
  await client.query(
    "UPDATE app_records SET payload=$1, updated_at=now() WHERE collection='sales' AND id=$2",
    [updated, invoice.id]
  );
  return { id: invoice.id, payload: updated };
}

async function createSalesInvoiceWorkflow(client, body) {
  const invoiceId = await postSalesInvoice(client, body);
  await setInvoiceStage(client, invoiceId, "Sales Review");
  await setInvoiceStage(client, invoiceId, "Pending Cashier Approval");
  return invoiceId;
}

async function approveCashierPayment(client, body) {
  const invoice = await loadRecord(client, "sales", Number(body.invoiceId));
  if (String(invoice.payload.workflowStage || "") !== "Pending Cashier Approval") {
    throw new Error("Invoice is not in Pending Cashier Approval stage");
  }
  const amount = num(body.amount);
  if (amount <= 0) throw new Error("Payment amount must be greater than zero");
  const total = num(invoice.payload.total);
  const paidAmount = num(invoice.payload.paidAmount) + amount;
  const balance = Math.max(0, total - paidAmount);
  const paymentStatus = balance <= 0 ? "Paid" : "Partially Paid";
  const payment = {
    amount,
    date: body.date || new Date().toISOString().slice(0, 10),
    paymentMethod: body.paymentMethod || "Cash",
    receiptType: body.receiptType || "Advance",
    cashAccountCode: body.cashAccountCode || "1611",
    memo: body.memo || ""
  };
  await client.query("INSERT INTO app_records (collection, payload) VALUES ('receipts', $1)", [{
    invoiceId: invoice.id,
    customerName: invoice.payload.customerName,
    ...payment
  }]);
  const existingOrder = await client.query("SELECT id FROM app_records WHERE collection='supplyOrders' AND payload->>'invoiceId'=$1 LIMIT 1", [String(invoice.id)]);
  let supplyOrderId = existingOrder.rows[0]?.id ? Number(existingOrder.rows[0].id) : null;
  if (!supplyOrderId) {
    const orderResult = await client.query(
      "INSERT INTO app_records (collection, payload) VALUES ('supplyOrders', $1) RETURNING id",
      [{
        invoiceId: invoice.id,
        invoiceNo: invoice.payload.invoiceNo,
        customerName: invoice.payload.customerName,
        date: new Date().toISOString().slice(0, 10),
        lines: invoice.payload.lines || [],
        status: "Pending Warehouse Approval",
        memo: "Created after cashier approval"
      }]
    );
    supplyOrderId = Number(orderResult.rows[0].id);
  }
  await setInvoiceStage(client, invoice.id, "Pending Warehouse Approval", {
    paidAmount,
    balance,
    paymentStatus,
    approvals: { ...(invoice.payload.approvals || {}), cashierApproved: true },
    payments: [...(invoice.payload.payments || []), payment],
    supplyOrderId
  });
  return { invoiceId: invoice.id, paidAmount, balance, supplyOrderId };
}

async function postInvoiceFinalAccounting(client, invoicePayload, supplyOrderId, issued) {
  const groupedRevenue = new Map();
  for (const line of invoicePayload.lines || []) {
    const accountCode = revenueAccountCode(line);
    groupedRevenue.set(accountCode, num(groupedRevenue.get(accountCode)) + num(line.total));
  }
  const salesJournalId = await postBalancedJournal(client, {
    memo: `Sales invoice ${invoicePayload.invoiceNo} - ${invoicePayload.customerName}`,
    source: "Sales Invoice Final Posting",
    date: invoicePayload.date,
    currency: invoicePayload.currency,
    exchangeRate: invoicePayload.exchangeRate,
    lines: [
      { accountCode: "151", debit: num(invoicePayload.total), credit: 0, note: invoicePayload.customerName },
      ...Array.from(groupedRevenue.entries()).map(([accountCode, amount]) => ({ accountCode, debit: 0, credit: amount, note: invoicePayload.invoiceNo }))
    ],
    payload: { invoiceId: invoicePayload.id, supplyOrderId }
  });
  const collected = num(invoicePayload.paidAmount || 0);
  let receiptJournalId = null;
  if (collected > 0) {
    receiptJournalId = await postJournal(client, {
      memo: `Receipt posting for invoice ${invoicePayload.invoiceNo}`,
      debitCode: "1611",
      creditCode: "151",
      amount: collected,
      source: "Receipt Final Posting",
      date: invoicePayload.date,
      payload: { invoiceId: invoicePayload.id }
    });
  }
  return { salesJournalId, receiptJournalId };
}

async function processSupplyOrderWorkflow(client, body) {
  const output = await processSupplyOrder(client, body);
  const order = await loadRecord(client, "supplyOrders", Number(body.orderId));
  if (output.missing?.length) throw new Error("لا يمكن ترحيل الفاتورة لأن بعض المواد لا تمتلك رصيد كافي داخل المخزن.");
  const invoice = await loadRecord(client, "sales", Number(order.payload.invoiceId));
  if (String(invoice.payload.workflowStage || "") !== "Pending Warehouse Approval") {
    throw new Error("Invoice is not in Pending Warehouse Approval stage");
  }
  await setInvoiceStage(client, invoice.id, "Pending Accounting Verification", {
    approvals: { ...(invoice.payload.approvals || {}), warehouseApproved: true },
    posting: { ...(invoice.payload.posting || {}), stockPosted: true }
  });
  const staged = await setInvoiceStage(client, invoice.id, "Ready For Posting", {
    approvals: { ...(invoice.payload.approvals || {}), warehouseApproved: true, accountingVerified: true }
  });
  const journals = await postInvoiceFinalAccounting(client, { ...staged.payload, id: invoice.id }, order.id, output.issued || []);
  const posted = await setInvoiceStage(client, invoice.id, "Posted", {
    posting: { ...(staged.payload.posting || {}), posted: true, journalIds: Object.values(journals).filter(Boolean) }
  });
  await setInvoiceStage(client, invoice.id, "Delivered", posted.payload);
  await setInvoiceStage(client, invoice.id, "Invoice Closed", posted.payload);
  return { ...output, finalPosting: journals };
}

async function postFinance(client, body) {
  const type = body.type;
  const cashAccountCode = body.cashAccountCode || "1611";
  const amount = num(body.amount);
  if (amount <= 0) throw new Error("Amount must be greater than zero");

  if (type === "payroll") {
    const debitCode = body.kind === "أجور" ? "514" : "531";
    const id = await postJournal(client, {
      memo: `${body.kind || "رواتب"} - ${body.employeeName || "عامل"} - ${body.memo || ""}`,
      debitCode,
      creditCode: cashAccountCode,
      amount,
      source: "رواتب وأجور",
      currency: body.currency,
      exchangeRate: body.exchangeRate,
      payload: body
    });
    await client.query("INSERT INTO app_records (collection, payload) VALUES ('payrolls', $1)", [{ ...body, journalId: id, date: body.date || new Date().toISOString().slice(0, 10) }]);
    return id;
  }

  if (type === "maintenanceRevenue") {
    const debitCode = body.paymentStatus === "آجل" ? "151" : cashAccountCode;
    const id = await postJournal(client, {
      memo: `إيراد صيانة - ${body.customerName || "زبون"} - ${body.memo || ""}`,
      debitCode,
      creditCode: "421",
      amount,
      source: "إيرادات صيانة",
      currency: body.currency,
      exchangeRate: body.exchangeRate,
      payload: body
    });
    await client.query("INSERT INTO app_records (collection, payload) VALUES ('maintenanceRevenues', $1)", [{ ...body, journalId: id, date: body.date || new Date().toISOString().slice(0, 10) }]);
    return id;
  }

  if (type === "fixedAsset") {
    const assetCodeByType = { "سيارة": "114", "أثاث": "115", "آلة": "113", "معدات": "113" };
    const debitCode = assetCodeByType[body.assetType] || "114";
    const creditCode = body.paymentStatus === "آجل" ? "221" : cashAccountCode;
    const id = await postJournal(client, {
      memo: `شراء موجود ثابت - ${body.assetType || "أصل"} - ${body.assetName || ""}`,
      debitCode,
      creditCode,
      amount,
      source: "موجودات ثابتة",
      currency: body.currency,
      exchangeRate: body.exchangeRate,
      payload: body
    });
    await client.query("INSERT INTO app_records (collection, payload) VALUES ('fixedAssets', $1)", [{ ...body, journalId: id, accountCode: debitCode, date: body.date || new Date().toISOString().slice(0, 10) }]);
    return id;
  }

  throw new Error("Unsupported finance type");
}

async function addAccount(client, body) {
  const code = String(body.code || "").trim();
  const name = String(body.name || "").trim();
  const type = String(body.type || "موجودات").trim();
  const level = String(body.level || "تحليلي").trim();
  const parentCode = String(body.parentCode || "").trim();
  if (!code || !name) throw new Error("Account code and name are required");
  if (parentCode) {
    const parent = await client.query("SELECT code FROM accounts WHERE code=$1", [parentCode]);
    if (!parent.rowCount) throw new Error("Parent account not found");
    if (!code.startsWith(parentCode)) throw new Error("Account code must start with parent code");
  }
  await client.query(
    "INSERT INTO accounts (code, name, type, level, balance) VALUES ($1,$2,$3,$4,0)",
    [code, name, type, level]
  );
  return code;
}

async function deleteAccount(client, code) {
  const accountCode = String(code || "").trim();
  if (!accountCode) throw new Error("Account code is required");
  const used = await client.query("SELECT 1 FROM journal_lines WHERE account_code=$1 LIMIT 1", [accountCode]);
  if (used.rowCount) throw new Error("لا يمكن حذف الحساب لأنه مستخدم في قيود محاسبية");
  const children = await client.query("SELECT 1 FROM accounts WHERE code <> $1 AND code LIKE $2 LIMIT 1", [accountCode, `${accountCode}%`]);
  if (children.rowCount) throw new Error("لا يمكن حذف الحساب لأنه يحتوي حسابات فرعية");
  const result = await client.query("UPDATE accounts SET active=false WHERE code=$1", [accountCode]);
  if (!result.rowCount) throw new Error("Account not found");
  return accountCode;
}

async function getAccountByCode(client, code) {
  const result = await client.query(
    `SELECT account_id AS id, code, name, type, level, parent_code AS "parentCode", parent_id AS "parentId", currency, nature, classification, level_no AS "levelNo", posting_mode AS "postingMode", active, is_system AS "isSystem"
     FROM accounts WHERE code=$1`,
    [String(code || "").trim()]
  );
  return result.rows[0] || null;
}

async function validateAccountCode(client, { code, parentCode, excludeCode }) {
  const value = String(code || "").trim();
  if (!value) return { ok: false, message: "رقم الحساب مطلوب.", reason: "required" };
  if (!/^\d+$/.test(value)) return { ok: false, message: "رقم الحساب يجب أن يكون أرقام فقط.", reason: "format" };
  const dup = await client.query("SELECT code FROM accounts WHERE code=$1", [value]);
  if (dup.rowCount && String(dup.rows[0].code) !== String(excludeCode || "")) {
    return { ok: false, message: "رقم الحساب مستخدم مسبقاً، يرجى اختيار رقم آخر.", reason: "duplicate" };
  }
  if (parentCode) {
    const parent = await getAccountByCode(client, parentCode);
    if (!parent) return { ok: false, message: "الحساب الأب غير موجود.", reason: "parent_not_found" };
    if (!value.startsWith(parent.code) || value === parent.code) {
      return { ok: false, message: "رقم الحساب خارج النطاق الهرمي للحساب الأب.", reason: "parent_scope" };
    }
  }
  return { ok: true, message: "OK", reason: "ok" };
}

async function suggestChildAccountCode(client, parentCode) {
  const parent = await getAccountByCode(client, parentCode);
  if (!parent) throw new Error("الحساب الأب غير موجود.");
  const last = await client.query(
    "SELECT code FROM accounts WHERE parent_code=$1 ORDER BY length(code) DESC, code DESC LIMIT 1",
    [parent.code]
  );
  if (!last.rowCount) return `${parent.code}1`;
  const suffix = String(last.rows[0].code).slice(parent.code.length);
  if (!/^\d+$/.test(suffix)) return `${parent.code}1`;
  const next = String(Number(suffix) + 1).padStart(suffix.length, "0");
  return `${parent.code}${next}`;
}

async function addAccountAdvanced(client, body) {
  const parentCode = String(body.parentCode || "").trim();
  const code = String(body.code || "").trim();
  const name = String(body.name || "").trim();
  if (!code || !name) throw new Error("Account code and name are required");
  const check = await validateAccountCode(client, { code, parentCode });
  if (!check.ok) throw new Error(check.message);
  const parent = parentCode ? await getAccountByCode(client, parentCode) : null;
  const type = String(body.type || parent?.type || "موجودات").trim();
  const level = String(body.level || parent?.level || "تحليلي").trim();
  const currency = String(body.currency || parent?.currency || "IQD").toUpperCase();
  const nature = String(body.nature || parent?.nature || "").trim();
  const classification = String(body.classification || parent?.classification || type).trim();
  const levelNo = parent ? Number(parent.levelNo || 1) + 1 : 1;
  const postingMode = String(body.postingMode || "transaction").trim();
  await client.query(
    `INSERT INTO accounts (code, name, type, level, balance, parent_code, parent_id, currency, nature, classification, level_no, posting_mode, active, is_system)
     VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8,$9,$10,$11,true,false)`,
    [code, name, type, level, parentCode || null, parent?.id || null, currency, nature, classification, levelNo, postingMode]
  );
  return code;
}

async function reparentAccount(client, { code, newParentCode }) {
  const accountCode = String(code || "").trim();
  const parentCode = String(newParentCode || "").trim();
  if (!accountCode || !parentCode) throw new Error("Account code and parent code are required");
  if (accountCode === parentCode) throw new Error("لا يمكن جعل الحساب أباً لنفسه.");
  const account = await getAccountByCode(client, accountCode);
  if (!account) throw new Error("Account not found");
  const parent = await getAccountByCode(client, parentCode);
  if (!parent) throw new Error("Parent account not found");
  if (!accountCode.startsWith(parentCode)) throw new Error("لا يمكن نقل الحساب خارج النطاق الرقمي للحساب الأب.");
  await client.query(
    "UPDATE accounts SET parent_code=$1, parent_id=$2, type=$3, currency=$4, nature=$5, classification=$6, level_no=$7 WHERE code=$8",
    [parent.code, parent.id || null, parent.type, parent.currency, parent.nature, parent.classification, Number(parent.levelNo || 1) + 1, accountCode]
  );
  return accountCode;
}

async function buildInventoryTrace(options = {}) {
  const query = String(options.query || "").trim();
  const dateFrom = String(options.dateFrom || "").trim();
  const dateTo = String(options.dateTo || "").trim();
  let where = "1=1";
  const params = [];
  if (query) {
    params.push(`%${query.toLowerCase()}%`);
    where += ` AND (lower(i.sku) LIKE $${params.length} OR lower(i.name) LIKE $${params.length})`;
  }
  if (dateFrom) {
    params.push(dateFrom);
    where += ` AND sm.move_date >= $${params.length}`;
  }
  if (dateTo) {
    params.push(dateTo);
    where += ` AND sm.move_date <= $${params.length}`;
  }
  const rows = await pool.query(
    `SELECT sm.id, sm.move_date AS "date", sm.direction, sm.qty::float8 AS qty, sm.unit_cost::float8 AS "unitCost",
            sm.source, sm.source_id AS "sourceId", i.id AS "itemId", i.sku, i.name,
            i.qty::float8 AS "currentQty", i.cost::float8 AS "currentCost"
     FROM stock_moves sm
     JOIN items i ON i.id = sm.item_id
     WHERE ${where}
     ORDER BY i.sku, sm.move_date, sm.id`,
    params
  );
  const grouped = new Map();
  for (const row of rows.rows) {
    if (!grouped.has(row.itemId)) {
      grouped.set(row.itemId, {
        itemId: row.itemId,
        sku: row.sku,
        name: row.name,
        currentQty: num(row.currentQty),
        currentCost: num(row.currentCost),
        moves: [],
        totals: { inQty: 0, outQty: 0 }
      });
    }
    const item = grouped.get(row.itemId);
    if (row.direction === "IN") item.totals.inQty += num(row.qty);
    if (row.direction === "OUT") item.totals.outQty += num(row.qty);
    item.moves.push({
      id: row.id,
      date: row.date,
      direction: row.direction,
      qty: num(row.qty),
      unitCost: num(row.unitCost),
      source: row.source,
      sourceId: row.sourceId || ""
    });
  }
  let openingBalances = new Map();
  if (dateFrom) {
    const opening = await pool.query(
      `SELECT sm.item_id AS "itemId",
              SUM(CASE WHEN sm.direction='OUT' THEN -sm.qty::float8 ELSE sm.qty::float8 END)::float8 AS qty
       FROM stock_moves sm
       JOIN items i ON i.id = sm.item_id
       WHERE sm.move_date < $1
         ${query ? "AND (lower(i.sku) LIKE $2 OR lower(i.name) LIKE $2)" : ""}
       GROUP BY sm.item_id`,
      query ? [dateFrom, `%${query.toLowerCase()}%`] : [dateFrom]
    );
    openingBalances = new Map(opening.rows.map((row) => [Number(row.itemId), num(row.qty)]));
  }
  for (const item of grouped.values()) {
    const openingQty = num(openingBalances.get(Number(item.itemId)) || 0);
    item.openingQty = openingQty;
    let running = openingQty;
    for (const move of item.moves) {
      running += move.direction === "OUT" ? -num(move.qty) : num(move.qty);
      move.runningQty = running;
    }
    item.closingQty = running;
    item.periodQtyIn = num(item.totals.inQty);
    item.periodQtyOut = num(item.totals.outQty);
  }
  return { generatedAt: new Date().toISOString(), filters: { query, dateFrom, dateTo }, items: Array.from(grouped.values()) };
}

async function dedupeCustomers(client) {
  const rows = await client.query(
    "SELECT id, name, phone, address, type, data FROM customers ORDER BY id"
  );
  const groups = new Map();
  for (const row of rows.rows) {
    const nameKey = normalizeText(row.name);
    const phoneKey = digitsOnly(row.phone);
    const key = phoneKey ? `${nameKey}|${phoneKey}` : nameKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  let mergedGroups = 0;
  let removedCount = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const keeper = list[0];
    const duplicates = list.slice(1);
    const mergedPhone = list.map((row) => digitsOnly(row.phone)).find(Boolean) || "";
    const mergedAddress = list.map((row) => String(row.address || "").trim()).find(Boolean) || "";
    const mergedType = list.map((row) => String(row.type || "").trim()).find(Boolean) || "";
    await client.query(
      "UPDATE customers SET phone=$1, address=$2, type=$3, updated_at=now() WHERE id=$4",
      [mergedPhone, mergedAddress, mergedType, keeper.id]
    );
    const duplicateIds = duplicates.map((row) => Number(row.id));
    if (duplicateIds.length) {
      await client.query("UPDATE serial_numbers SET customer_id=$1 WHERE customer_id = ANY($2)", [keeper.id, duplicateIds]);
      await client.query("UPDATE maintenance_job_cards SET customer_id=$1 WHERE customer_id = ANY($2)", [keeper.id, duplicateIds]);
      await client.query("DELETE FROM customers WHERE id = ANY($1)", [duplicateIds]);
      removedCount += duplicateIds.length;
      mergedGroups += 1;
    }
  }
  return { mergedGroups, removedCount };
}

async function dedupeItems(client) {
  const rows = await client.query(
    "SELECT id, sku, name, category, brand, spec, qty::float8 AS qty, cost::float8 AS cost, sale_price::float8 AS sale_price, data FROM items ORDER BY id"
  );
  const groups = new Map();
  for (const row of rows.rows) {
    const data = row.data || {};
    const key = [
      normalizeText(row.name),
      normalizeText(row.category),
      normalizeText(row.brand),
      normalizeText(row.spec),
      normalizeText(data.size || data.capacity || data.hajm || ""),
      normalizeText(data.type || "")
    ].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  let mergedGroups = 0;
  let removedCount = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const keeper = list[0];
    const duplicates = list.slice(1);
    const allRows = [keeper, ...duplicates];
    const totalQty = allRows.reduce((sum, row) => sum + num(row.qty), 0);
    const totalCost = allRows.reduce((sum, row) => sum + (num(row.qty) * num(row.cost)), 0);
    const weightedCost = totalQty > 0 ? (totalCost / totalQty) : num(keeper.cost);
    const maxSale = Math.max(...allRows.map((row) => num(row.sale_price)));
    await client.query(
      "UPDATE items SET qty=$1, cost=$2, sale_price=$3, updated_at=now() WHERE id=$4",
      [totalQty, weightedCost, maxSale, keeper.id]
    );
    const duplicateIds = duplicates.map((row) => Number(row.id));
    if (duplicateIds.length) {
      await client.query("UPDATE stock_moves SET item_id=$1 WHERE item_id = ANY($2)", [keeper.id, duplicateIds]);
      await client.query("UPDATE inventory_layers SET item_id=$1 WHERE item_id = ANY($2)", [keeper.id, duplicateIds]);
      await client.query("UPDATE serial_numbers SET item_id=$1 WHERE item_id = ANY($2)", [keeper.id, duplicateIds]);
      await client.query("DELETE FROM items WHERE id = ANY($1)", [duplicateIds]);
      removedCount += duplicateIds.length;
      mergedGroups += 1;
    }
  }
  return { mergedGroups, removedCount };
}

function reportSheetDefinitions(state) {
  return {
    accounts: {
      title: "دليل الحسابات",
      rows: state.accounts,
      columns: [
        ["code", "رقم الحساب"], ["name", "اسم الحساب"], ["type", "النوع"], ["level", "المستوى"], ["balance", "الرصيد"]
      ]
    },
    customers: {
      title: "العملاء",
      rows: state.customers,
      columns: [["id", "رقم"], ["name", "الاسم"], ["phone", "الهاتف"], ["address", "العنوان"], ["sector", "القطاع"], ["customerKind", "التصنيف"], ["type", "النوع"]]
    },
    suppliers: {
      title: "الموردون",
      rows: state.suppliers,
      columns: [["id", "رقم"], ["name", "الاسم"], ["phone", "الهاتف"], ["address", "العنوان"], ["type", "النوع"]]
    },
    items: {
      title: "المخزون",
      rows: state.items,
      columns: [["sku", "الرمز"], ["name", "الصنف"], ["category", "التصنيف"], ["brand", "الماركة"], ["spec", "المواصفة"], ["qty", "الكمية"], ["cost", "الكلفة"], ["salePrice", "سعر البيع"]]
    },
    journals: {
      title: "القيود",
      rows: state.journals,
      columns: [["id", "رقم"], ["date", "التاريخ"], ["memo", "البيان"], ["debitCode", "مدين"], ["creditCode", "دائن"], ["amount", "المبلغ"], ["source", "المصدر"]]
    },
    payrolls: {
      title: "الرواتب والأجور",
      rows: state.payrolls,
      columns: [["date", "التاريخ"], ["employeeName", "العامل"], ["kind", "النوع"], ["amount", "المبلغ"], ["cashAccountCode", "حساب الدفع"], ["memo", "البيان"]]
    },
    maintenanceRevenues: {
      title: "إيرادات الصيانة",
      rows: state.maintenanceRevenues,
      columns: [["date", "التاريخ"], ["customerName", "الزبون"], ["amount", "المبلغ"], ["paymentStatus", "الدفع"], ["cashAccountCode", "حساب القبض"], ["memo", "البيان"]]
    },
    fixedAssets: {
      title: "الموجودات الثابتة",
      rows: state.fixedAssets,
      columns: [["date", "التاريخ"], ["assetType", "النوع"], ["assetName", "الاسم"], ["amount", "المبلغ"], ["paymentStatus", "الدفع"], ["accountCode", "حساب الموجود"]]
    },
    receipts: {
      title: "سندات القبض",
      rows: state.receipts,
      columns: [["date", "التاريخ"], ["customerName", "الزبون"], ["receiptType", "نوع السند"], ["paymentMethod", "طريقة الدفع"], ["cashAccountCode", "حساب القبض"], ["amount", "المبلغ"], ["memo", "البيان"], ["journalId", "رقم القيد"]]
    },
    openingJournals: {
      title: "القيود الافتتاحية",
      rows: state.openingJournals,
      columns: [["date", "التاريخ"], ["memo", "البيان"], ["journalId", "رقم القيد"]]
    },
    openingInventory: {
      title: "بضاعة أول مدة",
      rows: state.openingInventory,
      columns: [["date", "التاريخ"], ["sku", "رمز الصنف"], ["name", "الصنف"], ["category", "التصنيف"], ["brand", "الماركة"], ["qty", "الكمية"], ["cost", "الكلفة"], ["amount", "إجمالي الكلفة"], ["journalId", "رقم القيد"]]
    }
  };
}

function addWorksheet(workbook, definition) {
  const sheet = workbook.addWorksheet(definition.title, { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  sheet.columns = definition.columns.map(([key, header]) => ({
    key,
    header,
    width: Math.max(14, String(header).length + 8)
  }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  sheet.getRow(1).alignment = { horizontal: "center" };
  definition.rows.forEach((row) => {
    const output = {};
    definition.columns.forEach(([key]) => output[key] = row[key] ?? "");
    sheet.addRow(output);
  });
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } }
      };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
  });
  return sheet;
}

async function buildExcelReport(reportName, options = {}) {
  const state = await stateFromDb();
  const definitions = reportSheetDefinitions(state);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Generator ERP";
  workbook.created = new Date();
  if (reportName === "accountLedger") {
    const ledger = await buildAccountLedger(options.accountCode, options);
    addWorksheet(workbook, {
      title: `كشف ${ledger.account.code}`,
      rows: ledger.rows,
      columns: [
        ["date", "التاريخ"],
        ["journalId", "رقم القيد"],
        ["source", "المصدر"],
        ["memo", "البيان"],
        ["debit", "مدين"],
        ["credit", "دائن"],
        ["balance", "الرصيد"]
      ]
    });
  } else if (reportName === "trialBalance") {
    const trial = await buildTrialBalance(options);
    addWorksheet(workbook, {
      title: "ميزان المراجعة",
      rows: trial.rows,
      columns: [["code", "رمز الحساب"], ["name", "اسم الحساب"], ["type", "النوع"], ["debit", "مدين"], ["credit", "دائن"], ["balance", "الرصيد"]]
    });
  } else if (reportName === "incomeStatement") {
    const fs = await buildFinancialStatements(options);
    addWorksheet(workbook, {
      title: "قائمة الدخل",
      rows: [
        ...fs.incomeStatement.revenues.map((r) => ({ section: "إيرادات", code: r.code, name: r.name, amount: Math.abs(num(r.balance)) })),
        ...fs.incomeStatement.expenses.map((r) => ({ section: "مصروفات", code: r.code, name: r.name, amount: Math.abs(num(r.balance)) })),
        { section: "الإجمالي", code: "", name: "صافي الربح", amount: fs.incomeStatement.totals.netProfit }
      ],
      columns: [["section", "القسم"], ["code", "الرمز"], ["name", "الحساب"], ["amount", "المبلغ"]]
    });
  } else if (reportName === "balanceSheet") {
    const fs = await buildFinancialStatements(options);
    addWorksheet(workbook, {
      title: "الميزانية العمومية",
      rows: [
        ...fs.balanceSheet.assets.map((r) => ({ section: "موجودات", code: r.code, name: r.name, amount: r.balance })),
        ...fs.balanceSheet.liabilities.map((r) => ({ section: "مطلوبات", code: r.code, name: r.name, amount: Math.abs(num(r.balance)) })),
        ...fs.balanceSheet.equity.map((r) => ({ section: "حقوق ملكية", code: r.code, name: r.name, amount: Math.abs(num(r.balance)) })),
        { section: "الإجمالي", code: "", name: "مجموع الموجودات", amount: fs.balanceSheet.totals.assets },
        { section: "الإجمالي", code: "", name: "مجموع المطلوبات + حقوق الملكية", amount: fs.balanceSheet.totals.liabilitiesAndEquity }
      ],
      columns: [["section", "القسم"], ["code", "الرمز"], ["name", "الحساب"], ["amount", "المبلغ"]]
    });
  } else if (reportName === "all") {
    Object.values(definitions).forEach((definition) => addWorksheet(workbook, definition));
  } else {
    const definition = definitions[reportName];
    if (!definition) throw new Error("Unknown report");
    addWorksheet(workbook, definition);
  }
  return workbook.xlsx.writeBuffer();
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      const started = Date.now();
      await pool.query("SELECT 1");
      return sendJson(res, 200, {
        ok: true,
        storage: "PostgreSQL",
        uptimeSeconds: Math.round(process.uptime()),
        databaseMs: Date.now() - started
      });
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(req);
      const result = await pool.query("SELECT * FROM users WHERE username=$1 AND active=true", [body.username]);
      const user = result.rows[0];
      if (!user) {
        await audit(body.username || "unknown", "LOGIN_FAILED", "User not found");
        return sendJson(res, 403, { error: "INVALID_LOGIN" });
      }
      if (user.failed_attempts >= 5) {
        await audit(user.username, "LOGIN_BLOCKED", "Account locked after too many failed attempts");
        return sendJson(res, 403, { error: "ACCOUNT_LOCKED" });
      }
      if (!verifyPassword(user, body.password)) {
        await pool.query("UPDATE users SET failed_attempts=failed_attempts+1, updated_at=now() WHERE id=$1", [user.id]);
        await audit(user.username, "LOGIN_FAILED", `Invalid password attempt ${user.failed_attempts + 1}`);
        return sendJson(res, 403, { error: "INVALID_LOGIN" });
      }
      await pool.query("UPDATE users SET failed_attempts=0, updated_at=now() WHERE id=$1", [user.id]);
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, { username: user.username, role: user.role, expiresAt: Date.now() + SESSION_TTL_MS });
      await audit(user.username, "LOGIN", "Successful login");
      return sendJson(res, 200, { ok: true, user: { username: user.username, name: user.name, role: user.role } }, {
        "Set-Cookie": `session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
      });
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      const token = parseCookies(req).session;
      if (token) sessions.delete(token);
      return sendJson(res, 200, { ok: true }, { "Set-Cookie": "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
    }

    const session = requireSession(req, res);
    if (!session) return;

    if (req.method === "GET" && url.pathname === "/api/state") {
      const data = await stateFromDb();
      if (!(await requirePermission(session, "hr.manage"))) data.payrolls = [];
      return sendJson(res, 200, data);
    }

    if (req.method === "GET" && url.pathname === "/api/audit") {
      if (!(await requirePermission(session, "users.manage"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const result = await pool.query("SELECT at, username AS user, action, detail FROM audit_log ORDER BY id DESC LIMIT 500");
      return sendJson(res, 200, result.rows);
    }

    if (req.method === "GET" && url.pathname === "/api/posting-operations") {
      if (!(await requirePermission(session, "accounting.view"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const result = await pool.query(
        `SELECT id, operation_type AS "operationType", source_collection AS "sourceCollection",
                source_id AS "sourceId", status, created_by AS "createdBy", payload, result,
                error_message AS "errorMessage", started_at AS "startedAt", finished_at AS "finishedAt"
         FROM posting_operations
         ORDER BY id DESC
         LIMIT 500`
      );
      return sendJson(res, 200, result.rows);
    }

    if (req.method === "GET" && url.pathname === "/api/dashboard") {
      return sendJson(res, 200, await buildDashboardReport());
    }

    if (req.method === "GET" && url.pathname === "/api/users-permissions") {
      if (!(await requirePermission(session, "users.manage"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      return sendJson(res, 200, await usersPermissionsState());
    }

    if (req.method === "POST" && url.pathname === "/api/settings/currency") {
      if (!(await requirePermission(session, "settings.manage"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const body = await readBody(req);
      const settings = await saveCurrencySettings(body);
      await audit(session.username, "SAVE_CURRENCY_SETTINGS", `${settings.baseCurrency}/${settings.secondaryCurrency}`);
      return sendJson(res, 200, settings);
    }

    if (req.method === "POST" && url.pathname === "/api/settings/exchange-rate") {
      if (!(await requirePermission(session, "settings.manage"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const body = await readBody(req);
      await saveExchangeRate(body, session.username);
      await audit(session.username, "SAVE_EXCHANGE_RATE", `${body.baseCurrency || "IQD"}/${body.quoteCurrency || "USD"} @ ${body.rate}`);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/dedupe/customers") {
      if (!(await requirePermission(session, "settings.manage"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const result = await withTransaction(async (client) => dedupeCustomers(client));
      await audit(session.username, "DEDUPE_CUSTOMERS", `groups=${result.mergedGroups}; removed=${result.removedCount}`);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/api/dedupe/items") {
      if (!(await requirePermission(session, "settings.manage"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const result = await withTransaction(async (client) => dedupeItems(client));
      await audit(session.username, "DEDUPE_ITEMS", `groups=${result.mergedGroups}; removed=${result.removedCount}`);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/api/users") {
      if (!(await requirePermission(session, "users.manage"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const body = await readBody(req);
      const id = await saveUser(body);
      await audit(session.username, "SAVE_USER", `id=${id}; username=${body.username}`);
      return sendJson(res, 200, { id });
    }

    if (req.method === "POST" && url.pathname === "/api/role-permissions") {
      if (!(await requirePermission(session, "users.manage"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const body = await readBody(req);
      const role = await saveRolePermissions(body);
      await audit(session.username, "SAVE_ROLE_PERMISSIONS", `role=${role}`);
      return sendJson(res, 200, { role });
    }

    if (req.method === "GET" && url.pathname === "/api/account-ledger") {
      if (!(await requirePermission(session, "accounting.view"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const ledger = await buildAccountLedger(url.searchParams.get("accountCode"), {
        dateFrom: url.searchParams.get("dateFrom"),
        dateTo: url.searchParams.get("dateTo"),
        source: url.searchParams.get("source"),
        side: url.searchParams.get("side"),
        search: url.searchParams.get("search")
      });
      return sendJson(res, 200, ledger);
    }

    if (req.method === "GET" && url.pathname === "/api/trial-balance") {
      if (!(await requirePermission(session, "accounting.view"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const report = await buildTrialBalance({
        dateFrom: url.searchParams.get("dateFrom"),
        dateTo: url.searchParams.get("dateTo")
      });
      return sendJson(res, 200, report);
    }

    if (req.method === "GET" && url.pathname === "/api/financial-statements") {
      if (!(await requirePermission(session, "accounting.view"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const report = await buildFinancialStatements({
        dateFrom: url.searchParams.get("dateFrom"),
        dateTo: url.searchParams.get("dateTo")
      });
      return sendJson(res, 200, report);
    }

    if (req.method === "POST" && url.pathname === "/api/accounts/add") {
      if (!(await requirePermission(session, "accounting.post"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const body = await readBody(req);
      const code = await withTransaction(async (client) => {
        const created = await addAccountAdvanced(client, body);
        await client.query("INSERT INTO audit_log (username, action, detail) VALUES ($1,$2,$3)", [session.username, "ADD_ACCOUNT", `code=${created}`]);
        return created;
      });
      return sendJson(res, 200, { code });
    }

    if (req.method === "POST" && url.pathname === "/api/accounts/validate-code") {
      if (!(await requirePermission(session, "accounting.view"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const body = await readBody(req);
      const result = await withTransaction(async (client) => validateAccountCode(client, body || {}));
      return sendJson(res, 200, result);
    }

    if (req.method === "GET" && url.pathname === "/api/accounts/suggest-child") {
      if (!(await requirePermission(session, "accounting.view"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const parentCode = String(url.searchParams.get("parentCode") || "").trim();
      const suggestedCode = await withTransaction(async (client) => suggestChildAccountCode(client, parentCode));
      return sendJson(res, 200, { suggestedCode });
    }

    if (req.method === "POST" && url.pathname === "/api/accounts/delete") {
      if (!(await requirePermission(session, "accounting.post"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const body = await readBody(req);
      const code = await withTransaction(async (client) => {
        const removed = await deleteAccount(client, body.code);
        await client.query("INSERT INTO audit_log (username, action, detail) VALUES ($1,$2,$3)", [session.username, "DELETE_ACCOUNT", `code=${removed}`]);
        return removed;
      });
      return sendJson(res, 200, { code });
    }

    if (req.method === "POST" && url.pathname === "/api/accounts/reparent") {
      if (!(await requirePermission(session, "accounting.post"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const body = await readBody(req);
      const code = await withTransaction(async (client) => {
        const moved = await reparentAccount(client, body || {});
        await client.query("INSERT INTO audit_log (username, action, detail) VALUES ($1,$2,$3)", [session.username, "REPARENT_ACCOUNT", `code=${moved}; parent=${body.newParentCode}`]);
        return moved;
      });
      return sendJson(res, 200, { code });
    }

    if (req.method === "GET" && url.pathname === "/api/inventory-trace") {
      if (!(await requirePermission(session, "inventory.view"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const report = await buildInventoryTrace({
        query: url.searchParams.get("query"),
        dateFrom: url.searchParams.get("dateFrom"),
        dateTo: url.searchParams.get("dateTo")
      });
      return sendJson(res, 200, report);
    }

    if (req.method === "GET" && url.pathname === "/api/reports/excel") {
      const report = url.searchParams.get("report") || "all";
      const buffer = await buildExcelReport(report, {
        accountCode: url.searchParams.get("accountCode"),
        dateFrom: url.searchParams.get("dateFrom"),
        dateTo: url.searchParams.get("dateTo"),
        source: url.searchParams.get("source"),
        side: url.searchParams.get("side"),
        search: url.searchParams.get("search")
      });
      const filename = `generator-erp-${report}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      return sendBuffer(res, 200, buffer, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`
      });
    }

    if (req.method === "GET" && url.pathname === "/api/invoice-templates") {
      const result = await pool.query("SELECT id, name, original_filename AS \"originalFilename\", active, created_by AS \"createdBy\", created_at AS \"createdAt\" FROM invoice_templates ORDER BY id DESC");
      return sendJson(res, 200, result.rows);
    }

    const templateDownloadMatch = url.pathname.match(/^\/api\/invoice-templates\/(\d+)\/download$/);
    if (req.method === "GET" && templateDownloadMatch) {
      const result = await pool.query(
        "SELECT original_filename, mime_type, content_base64 FROM invoice_templates WHERE id=$1",
        [Number(templateDownloadMatch[1])]
      );
      if (!result.rowCount) return sendJson(res, 404, { error: "TEMPLATE_NOT_FOUND" });
      const row = result.rows[0];
      return sendBuffer(res, 200, Buffer.from(row.content_base64, "base64"), {
        "Content-Type": row.mime_type,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(row.original_filename)}"`
      });
    }

    if (req.method === "POST" && url.pathname === "/api/invoice-templates") {
      const body = await readBody(req);
      if (!body.name || !body.filename || !body.contentBase64) return sendJson(res, 400, { error: "MISSING_TEMPLATE_DATA" });
      if (!String(body.filename).toLowerCase().endsWith(".docx")) return sendJson(res, 400, { error: "DOCX_ONLY" });
      const sizeBytes = Buffer.byteLength(body.contentBase64, "base64");
      if (sizeBytes > 5 * 1024 * 1024) return sendJson(res, 400, { error: "TEMPLATE_TOO_LARGE" });
      const result = await pool.query(
        `INSERT INTO invoice_templates (name, original_filename, mime_type, content_base64, fields, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [body.name, body.filename, body.mimeType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document", body.contentBase64, body.fields || {}, session.username]
      );
      await audit(session.username, "UPLOAD_INVOICE_TEMPLATE", `id=${result.rows[0].id}; file=${body.filename}`);
      return sendJson(res, 200, { id: Number(result.rows[0].id) });
    }

    if (req.method === "POST" && url.pathname === "/api/upsert") {
      const body = await readBody(req);
      const id = await withTransaction(async (client) => {
        const savedId = await upsertRecord(client, body.collection, body.record || {});
        await client.query("INSERT INTO audit_log (username, action, detail) VALUES ($1,$2,$3)", [session.username, `UPSERT_${body.collection}`, `id=${savedId}`]);
        return savedId;
      });
      return sendJson(res, 200, { id });
    }

    if (req.method === "POST" && url.pathname === "/api/post-finance") {
      const body = await readBody(req);
      const id = await withTransaction(async (client) => {
        const journalId = await postFinance(client, body);
        await client.query("INSERT INTO audit_log (username, action, detail) VALUES ($1,$2,$3)", [session.username, `POST_${body.type}`, `journal=${journalId}`]);
        return journalId;
      });
      return sendJson(res, 200, { id });
    }

    if (req.method === "POST" && url.pathname === "/api/sales-invoice") {
      const body = await readBody(req);
      const output = await withTransaction(async (client) => {
        const posted = await executePostingPipeline(client, {
          operationType: "SALES_INVOICE_POST",
          sourceCollection: "sales",
          sourceId: String(body.invoiceNo || `AUTO-${Date.now()}`),
          createdBy: session.username,
          payload: { invoiceNo: body.invoiceNo || null, customerName: body.customerName || null },
          runner: async () => ({ invoiceId: await createSalesInvoiceWorkflow(client, body) }),
          finalSourceIdResolver: (result) => result?.invoiceId
        });
        await client.query(
          "INSERT INTO audit_log (username, action, detail) VALUES ($1,$2,$3)",
          [session.username, "POST_SALES_INVOICE", `invoice=${posted.result.invoiceId}; pipeline=${posted.pipelineId}`]
        );
        return posted;
      });
      return sendJson(res, 200, { id: output.result.invoiceId, pipelineId: output.pipelineId });
    }

    if (req.method === "POST" && url.pathname === "/api/invoice-payment") {
      const body = await readBody(req);
      const result = await withTransaction(async (client) => {
        const posted = await executePostingPipeline(client, {
          operationType: "INVOICE_PAYMENT_POST",
          sourceCollection: "sales",
          sourceId: String(body.invoiceId || ""),
          createdBy: session.username,
          payload: {
            invoiceId: body.invoiceId,
            amount: body.amount,
            paymentMethod: body.paymentMethod || "نقدا",
            receiptType: body.receiptType || "عربون"
          },
          runner: async () => approveCashierPayment(client, body),
          finalSourceIdResolver: () => body.invoiceId
        });
        const output = posted.result || {};
        await client.query(
          "INSERT INTO audit_log (username, action, detail) VALUES ($1,$2,$3)",
          [session.username, "POST_INVOICE_PAYMENT", `invoice=${body.invoiceId}; journal=${output.journalId}; supplyOrder=${output.supplyOrderId}; pipeline=${posted.pipelineId}`]
        );
        return { ...output, pipelineId: posted.pipelineId };
      });
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/api/process-supply-order") {
      const body = await readBody(req);
      const result = await withTransaction(async (client) => {
        const posted = await executePostingPipeline(client, {
          operationType: "SUPPLY_ORDER_PROCESS",
          sourceCollection: "supplyOrders",
          sourceId: String(body.orderId || ""),
          createdBy: session.username,
          payload: { orderId: body.orderId },
          runner: async () => processSupplyOrderWorkflow(client, body),
          finalSourceIdResolver: () => body.orderId
        });
        const output = posted.result || {};
        await client.query(
          "INSERT INTO audit_log (username, action, detail) VALUES ($1,$2,$3)",
          [session.username, "PROCESS_SUPPLY_ORDER", `order=${output.orderId}; status=${output.status}; pipeline=${posted.pipelineId}`]
        );
        return { ...output, pipelineId: posted.pipelineId };
      });
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/api/receipts") {
      const body = await readBody(req);
      const id = await withTransaction(async (client) => {
        const journalId = await postReceipt(client, body);
        await client.query("INSERT INTO audit_log (username, action, detail) VALUES ($1,$2,$3)", [session.username, "POST_RECEIPT", `journal=${journalId}`]);
        return journalId;
      });
      return sendJson(res, 200, { id });
    }

    if (req.method === "POST" && url.pathname === "/api/opening-journal") {
      const body = await readBody(req);
      const id = await withTransaction(async (client) => {
        const journalId = await postOpeningJournal(client, body);
        await client.query("INSERT INTO audit_log (username, action, detail) VALUES ($1,$2,$3)", [session.username, "POST_OPENING_JOURNAL", `journal=${journalId}`]);
        return journalId;
      });
      return sendJson(res, 200, { id });
    }

    if (req.method === "POST" && url.pathname === "/api/opening-inventory") {
      const body = await readBody(req);
      const id = await withTransaction(async (client) => {
        const journalId = await postOpeningInventory(client, body);
        await client.query("INSERT INTO audit_log (username, action, detail) VALUES ($1,$2,$3)", [session.username, "POST_OPENING_INVENTORY", `journal=${journalId}`]);
        return journalId;
      });
      return sendJson(res, 200, { id });
    }

    if (req.method === "GET" && /^\/api\/journal\/\d+$/.test(url.pathname)) {
      if (!(await requirePermission(session, "accounting.view"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const journalId = Number(url.pathname.split("/").pop());
      const entry = await pool.query(
        `SELECT id, entry_date AS "entryDate", source, memo, currency, exchange_rate AS "exchangeRate", status, created_at AS "createdAt"
         FROM journal_entries WHERE id=$1`,
        [journalId]
      );
      if (!entry.rowCount) return sendJson(res, 404, { error: "Journal not found" });
      const lines = await pool.query(
        `SELECT jl.account_code AS "accountCode", a.name AS "accountName",
                jl.debit::float8 AS debit, jl.credit::float8 AS credit,
                jl.debit_base::float8 AS "debitBase", jl.credit_base::float8 AS "creditBase", jl.note
         FROM journal_lines jl
         LEFT JOIN accounts a ON a.code = jl.account_code
         WHERE jl.journal_entry_id=$1 ORDER BY jl.id`,
        [journalId]
      );
      const totalDebit = lines.rows.reduce((s, l) => s + num(l.debit), 0);
      const totalCredit = lines.rows.reduce((s, l) => s + num(l.credit), 0);
      return sendJson(res, 200, { ...entry.rows[0], lines: lines.rows, totals: { debit: totalDebit, credit: totalCredit } });
    }

    if (req.method === "POST" && url.pathname === "/api/company-logo") {
      if (!(await requirePermission(session, "settings.manage"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const body = await readBody(req);
      const logoData = String(body.logoBase64 || "");
      if (logoData && !logoData.startsWith("data:image/")) return sendJson(res, 400, { error: "Invalid image format" });
      await pool.query(
        "INSERT INTO meta (key, value) VALUES ('company_logo', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
        [JSON.stringify({ data: logoData || null, updatedAt: new Date().toISOString() })]
      );
      await audit(session.username, "SAVE_COMPANY_LOGO", "Company logo updated");
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/company-logo") {
      const result = await pool.query("SELECT value FROM meta WHERE key='company_logo' LIMIT 1");
      const data = result.rows[0]?.value?.data || null;
      return sendJson(res, 200, { data });
    }

    if (req.method === "POST" && /^\/api\/invoice-templates\/\d+\/activate$/.test(url.pathname)) {
      if (!(await requirePermission(session, "settings.manage"))) return sendJson(res, 403, { error: "FORBIDDEN" });
      const templateId = Number(url.pathname.split("/")[3]);
      await pool.query("UPDATE invoice_templates SET active=false");
      const result = await pool.query("UPDATE invoice_templates SET active=true WHERE id=$1 RETURNING id", [templateId]);
      if (!result.rowCount) return sendJson(res, 404, { error: "Template not found" });
      await audit(session.username, "ACTIVATE_TEMPLATE", `templateId=${templateId}`);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { error: "NOT_FOUND" });
  } catch (error) {
    try {
      await audit("system", "ERROR", error.message);
    } catch {}
    return sendJson(res, 500, { error: "SERVER_ERROR", detail: error.message });
  }
}

async function start() {
  await initDb();
  const server = http.createServer((req, res) => {
    const requestId = crypto.randomBytes(8).toString("hex");
    const started = Date.now();
    res.on("finish", () => {
      log("info", "request", {
        requestId,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        durationMs: Date.now() - started
      });
    });
    if (req.url.startsWith("/api/")) return handleApi(req, res);
    return serveStatic(req, res);
  });

  function shutdown(signal) {
    log("info", "shutdown_requested", { signal });
    server.close(async () => {
      await pool.end();
      log("info", "shutdown_complete");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("uncaughtException", (error) => {
    log("error", "uncaught_exception", { error: error.stack || error.message });
    process.exit(1);
  });
  process.on("unhandledRejection", (error) => {
    log("error", "unhandled_rejection", { error: error?.stack || String(error) });
  });

  server.listen(PORT, "0.0.0.0", () => {
    log("info", "server_started", {
      url: `http://0.0.0.0:${PORT}`,
      database: DATABASE_URL.replace(/:[^:@/]+@/, ":***@")
    });
    console.log(`Production ERP with PostgreSQL running on http://0.0.0.0:${PORT}`);
    console.log(`Health check: http://0.0.0.0:${PORT}/api/health`);
    console.log("Default login: admin / ChangeMe-12345");
  });
}

start().catch((error) => {
  log("error", "startup_failed", { error: error.stack || error.message });
  console.error("Failed to start production server:", error.message);
  process.exit(1);
});
