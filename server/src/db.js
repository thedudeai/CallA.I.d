// SQLite connection + schema. Every tenant row carries company_id; the repo
// layer (tenant.js) scopes every query by it. SQLite is used for a self-contained
// build; the schema maps 1:1 to the Postgres model in the spec (§9) so swapping
// in Postgres + RLS later is mechanical.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// On serverless platforms (Vercel/Lambda) the bundle filesystem is read-only;
// only /tmp is writable (and ephemeral per instance), so the DB lives there and
// is seeded on cold start. Elsewhere it's a persistent file under server/data.
const ON_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
export const DB_PATH = process.env.CALLAID_DB || (ON_SERVERLESS ? '/tmp/callaid.db' : join(__dirname, '..', 'data', 'callaid.db'));
export const EPHEMERAL_DB = ON_SERVERLESS && !process.env.CALLAID_DB;
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
// WAL needs a writable dir + shared memory; on serverless /tmp use the simpler
// rollback journal, which is fine for a single-instance ephemeral demo DB.
db.pragma(`journal_mode = ${ON_SERVERLESS ? 'DELETE' : 'WAL'}`);
db.pragma('foreign_keys = ON');

export function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'Starter',
    status TEXT NOT NULL DEFAULT 'active',     -- active | trial | suspended
    theme TEXT NOT NULL DEFAULT 'aurora',
    seats INTEGER NOT NULL DEFAULT 5,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    company_id TEXT,                            -- null only for platform super_admin
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,                         -- super_admin | company_admin | sales_rep | customer_service_rep
    default_mode TEXT NOT NULL DEFAULT 'care',  -- care | sales
    default_playbook_id TEXT,
    access_level TEXT NOT NULL DEFAULT 'self',  -- self | full
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'anthropic',
    encrypted_key TEXT NOT NULL,               -- reversibly obfuscated for this build; KMS in prod
    last4 TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    type TEXT NOT NULL,                         -- twilio | ringcentral | aircall | genesys | webrtc
    config TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'disconnected',
    created_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS kb_documents (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'doc',
    status TEXT NOT NULL DEFAULT 'indexing',    -- indexing | indexed | analyzed
    storage_ref TEXT,
    size_bytes INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS kb_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding TEXT,                             -- JSON array (lexical fallback vector for this build)
    FOREIGN KEY (document_id) REFERENCES kb_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS playbooks (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    mode TEXT NOT NULL,                         -- care | sales
    name TEXT NOT NULL,
    emoji TEXT DEFAULT '📘',
    description TEXT DEFAULT '',
    stages TEXT NOT NULL DEFAULT '[]',          -- JSON string[]
    discovery_bank TEXT NOT NULL DEFAULT '[]',  -- JSON string[]
    rubric_weights TEXT NOT NULL DEFAULT '{}',  -- JSON { dimension: weight }
    tactics TEXT NOT NULL DEFAULT '[]',         -- JSON string[] tags
    source TEXT NOT NULL DEFAULT 'custom',      -- default | ai-proposed | custom
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS playbook_proposals (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    source_document_id TEXT,
    source_filename TEXT,
    draft TEXT NOT NULL,                        -- JSON of a draft playbook
    status TEXT NOT NULL DEFAULT 'pending',     -- pending | accepted | dismissed
    created_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT NOT NULL,                      -- rep
    contact_name TEXT,
    contact_number TEXT,
    mode TEXT NOT NULL,
    playbook_id TEXT,
    call_type TEXT,                             -- cold | inbound | follow-up | returning | new
    touch_number INTEGER DEFAULT 1,
    direction TEXT DEFAULT 'inbound',
    status TEXT NOT NULL DEFAULT 'completed',   -- live | completed
    started_at TEXT NOT NULL,
    duration INTEGER DEFAULT 0,                 -- seconds
    recording_ref TEXT,
    transcript TEXT,                            -- JSON [{speaker,text,t}]
    overall_score INTEGER,
    gap INTEGER,
    verdict TEXT,
    summary TEXT,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS call_scores (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    dimension TEXT NOT NULL,
    value INTEGER NOT NULL,
    FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS call_moments (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    ts TEXT NOT NULL,                           -- mm:ss
    severity TEXT NOT NULL,                     -- good | warn | bad
    label TEXT NOT NULL,
    detail TEXT,
    FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS coaching (
    call_id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tip TEXT NOT NULL,
    FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    call_id TEXT,
    owner_user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'follow-up',     -- follow-up | note
    source TEXT NOT NULL DEFAULT 'ai',          -- ai | manual
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    call_id TEXT,
    owner_user_id TEXT,
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled',
    external_ref TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS suggestions_log (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    call_id TEXT,
    ts TEXT NOT NULL,
    stage TEXT,
    suggested_line TEXT,
    used INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT,
    company_id TEXT,                            -- nullable for platform actions
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
  CREATE INDEX IF NOT EXISTS idx_calls_company ON calls(company_id);
  CREATE INDEX IF NOT EXISTS idx_calls_user ON calls(user_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_company ON tasks(company_id);
  CREATE INDEX IF NOT EXISTS idx_playbooks_company ON playbooks(company_id);
  CREATE INDEX IF NOT EXISTS idx_chunks_company ON kb_chunks(company_id);
  `);
}

// Zoho integration schema additions (companion spec). Idempotent: adds columns
// to existing tables only if missing, plus the sync-queue and (sandbox) mirror
// tables. Kept separate so the core schema stays readable.
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

export function migrateZoho() {
  addColumn('users', 'zoho_crm_user_id', 'TEXT');
  addColumn('users', 'zoho_desk_agent_id', 'TEXT');
  addColumn('calls', 'zoho_sync_status', "TEXT DEFAULT 'pending'"); // pending|synced|failed|skipped
  addColumn('calls', 'zoho_record_id', 'TEXT');
  addColumn('calls', 'zoho_product', 'TEXT');                       // crm|desk
  addColumn('tasks', 'zoho_task_id', 'TEXT');
  addColumn('tasks', 'zoho_sync_status', 'TEXT');
  addColumn('calendar_events', 'zoho_event_id', 'TEXT');

  db.exec(`
  CREATE TABLE IF NOT EXISTS zoho_sync_jobs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    call_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | failed | skipped
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Sandbox/demo mirror: the records that WOULD be (or were) written to Zoho, so
  -- the integration is fully demoable without a live Zoho org. Real connections
  -- also log here for an in-app audit of what was pushed.
  CREATE TABLE IF NOT EXISTS zoho_mirror (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    call_id TEXT,
    product TEXT NOT NULL,                    -- crm | desk
    kind TEXT NOT NULL,                       -- contact | call | ticket | task | event | comment
    zoho_id TEXT NOT NULL,
    owner TEXT,
    payload TEXT NOT NULL,                    -- JSON of the record as sent
    sandbox INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_zoho_jobs_company ON zoho_sync_jobs(company_id);
  CREATE INDEX IF NOT EXISTS idx_zoho_mirror_company ON zoho_mirror(company_id);
  CREATE INDEX IF NOT EXISTS idx_zoho_mirror_call ON zoho_mirror(call_id);
  `);
}

migrate();
migrateZoho();
