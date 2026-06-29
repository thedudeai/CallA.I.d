// Seed data mirroring callaid_ui.html so the app is fully populated on first run.
// Northwind Audio is the demo tenant; Brightline & Harbor populate the super-admin
// table. Reporting numbers are computed from real seeded calls, not hardcoded.
import { db, migrate } from './db.js';
import { id, now } from './util.js';
import { hashPassword } from './auth.js';
import { indexDocument } from './ai/rag.js';

const RESET = process.argv.includes('--reset');

function reset() {
  const tables = ['audit_log', 'suggestions_log', 'calendar_events', 'tasks', 'coaching',
    'call_moments', 'call_scores', 'calls', 'playbook_proposals', 'playbooks',
    'kb_chunks', 'kb_documents', 'integrations', 'api_keys', 'users', 'companies'];
  for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
}

function alreadySeeded() {
  return db.prepare('SELECT COUNT(*) c FROM companies').get().c > 0;
}

const PW = hashPassword('demo1234'); // shared demo password

function company(name, plan, status, seats, theme) {
  const cid = id('co');
  db.prepare(`INSERT INTO companies (id,name,plan,status,theme,seats,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(cid, name, plan, status, theme, seats, now());
  return cid;
}

function user(companyId, name, email, role, mode, access) {
  const uid = id('usr');
  db.prepare(`INSERT INTO users (id,company_id,name,email,password_hash,role,default_mode,access_level,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(uid, companyId, name, email, PW, role, mode || 'care', access || 'self', 'active', now());
  return uid;
}

function playbook(companyId, mode, name, emoji, description, stages, bank, weights, tactics, source) {
  const pid = id('pb');
  db.prepare(`INSERT INTO playbooks (id,company_id,mode,name,emoji,description,stages,discovery_bank,rubric_weights,tactics,source,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    pid, companyId, mode, name, emoji, description,
    JSON.stringify(stages), JSON.stringify(bank), JSON.stringify(weights), JSON.stringify(tactics),
    source || 'custom', 'active', now());
  return pid;
}

function makeCall(companyId, repId, c) {
  const cid = id('call');
  db.prepare(`INSERT INTO calls (id,company_id,user_id,contact_name,contact_number,mode,playbook_id,call_type,touch_number,direction,status,started_at,duration,transcript,overall_score,gap,verdict,summary)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    cid, companyId, repId, c.contact, c.number || null, c.mode, c.playbookId || null, c.callType || null,
    c.touch || 1, c.direction || 'inbound', 'completed', c.startedAt || now(), c.duration || 0,
    JSON.stringify(c.transcript || []), c.score, c.gap ?? 0, c.verdict || null, c.summary || null);
  for (const [dim, val] of Object.entries(c.scores || {}))
    db.prepare(`INSERT INTO call_scores (id,call_id,company_id,dimension,value) VALUES (?,?,?,?,?)`).run(id('sc'), cid, companyId, dim, val);
  for (const m of c.moments || [])
    db.prepare(`INSERT INTO call_moments (id,call_id,company_id,ts,severity,label,detail) VALUES (?,?,?,?,?,?,?)`).run(id('mo'), cid, companyId, m.ts, m.severity, m.label, m.detail);
  if (c.coaching) db.prepare(`INSERT INTO coaching (call_id,company_id,tip) VALUES (?,?,?)`).run(cid, companyId, c.coaching);
  for (const t of c.tasks || [])
    db.prepare(`INSERT INTO tasks (id,company_id,call_id,owner_user_id,text,kind,source,done,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id('tsk'), companyId, cid, repId, t.text, t.kind, 'ai', t.done ? 1 : 0, now());
  if (c.follow)
    db.prepare(`INSERT INTO calendar_events (id,company_id,call_id,owner_user_id,title,starts_at,status,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id('cal'), companyId, cid, repId, c.follow.title, c.follow.starts_at, 'scheduled', now());
  return cid;
}

function daysAgo(d, h = 10, m = 0) {
  const dt = new Date(); dt.setDate(dt.getDate() - d); dt.setHours(h, m, 0, 0); return dt.toISOString();
}
function daysAhead(d, h = 11) {
  const dt = new Date(); dt.setDate(dt.getDate() + d); dt.setHours(h, 0, 0, 0); return dt.toISOString();
}

function run() {
  migrate();
  if (alreadySeeded() && !RESET) { console.log('Already seeded (use --reset to wipe). Skipping.'); return; }
  if (RESET) reset();

  // ---- Platform owner (super admin, no company) ----
  user(null, 'Dani Lerner', 'dani@callaid.io', 'super_admin', 'care', 'full');

  // ---- Tenant: Northwind Audio (the demo workspace) ----
  const nw = company('Northwind Audio', 'Growth', 'active', 6, 'aurora');
  const admin = user(nw, 'Avery Stone', 'avery@northwind.example', 'company_admin', 'care', 'full');
  const priya = user(nw, 'Priya Ghosh', 'priya@northwind.example', 'customer_service_rep', 'care', 'self');
  const theo = user(nw, 'Theo Marsh', 'theo@northwind.example', 'sales_rep', 'sales', 'self');
  const june = user(nw, 'June Kwan', 'june@northwind.example', 'sales_rep', 'sales', 'self');
  const adam = user(nw, 'Adam Osei', 'adam@northwind.example', 'customer_service_rep', 'care', 'self');

  // No LLM key is seeded: the demo runs entirely on the deterministic engine
  // (no network, no cost). An admin pastes a real Claude key under Settings → AI
  // key to switch this tenant to live Claude guidance — the contract is identical.

  // Integrations
  db.prepare(`INSERT INTO integrations (id,company_id,type,config,status,created_at) VALUES (?,?,?,?,?,?)`)
    .run(id('int'), nw, 'twilio', '{}', 'connected', now());
  for (const t of ['ringcentral', 'aircall', 'genesys'])
    db.prepare(`INSERT INTO integrations (id,company_id,type,config,status,created_at) VALUES (?,?,?,?,?,?)`)
      .run(id('int'), nw, t, '{}', 'disconnected', now());

  // ---- Playbooks (defaults from spec §6.3) ----
  const careRubric = { empathy: 0.25, tone: 0.2, pacing: 0.15, discovery: 0.2, resolution: 0.2 };
  const salesRubric = { discovery: 0.25, objections: 0.2, value: 0.2, pacing: 0.15, close: 0.2 };
  const deesc = playbook(nw, 'care', 'De-escalation', '🫶',
    'For heated or repeat callers. Acknowledge, own it, slow the pace, resolve.',
    ['Listen', 'Diagnose', 'Resolve', 'Confirm'],
    ['What exactly is happening?', 'When did it start?', 'What have you tried?', 'Can I confirm the account?'],
    careRubric, ['Tone', 'Energy match', 'Just listen'], 'default');
  playbook(nw, 'care', 'Guided support', '🧭',
    'Step-by-step help for confused customers. Checks understanding before moving on.',
    ['Listen', 'Diagnose', 'Resolve', 'Confirm'],
    ['What are you trying to do?', 'Where did it stop working?', 'What do you see on screen?'],
    careRubric, ['Clarity', 'Pace'], 'default');
  const phys = playbook(nw, 'sales', 'Physical product', '📦',
    'Tangible goods. Demonstration, scarcity, and a clear next step to purchase.',
    ['Discovery', 'Problem', 'Solution', 'Close'],
    ['What are you using now?', 'What is it for?', 'What is the budget range?'],
    salesRubric, ['Discovery', 'Objections', 'Close cues'], 'default');
  playbook(nw, 'sales', 'Service', '🤝',
    'Trust-first. Surfaces the real problem before pitching the engagement.',
    ['Discovery', 'Problem', 'Solution', 'Close'],
    ['What outcome are you after?', 'What have you tried?', 'Who else is involved?'],
    salesRubric, ['Discovery', 'Value framing'], 'default');
  const saas = playbook(nw, 'sales', 'Software / SaaS', '💻',
    'Consultative. Maps features to outcomes, handles "we\'ll think about it" stalls.',
    ['Discovery', 'Problem', 'Solution', 'Close'],
    ['What are you using to handle this today?', 'Where is it falling short?', 'How big is the team?', 'What would make this a no-brainer?'],
    salesRubric, ['ROI', 'Multi-touch'], 'default');

  // Default playbooks per rep
  db.prepare('UPDATE users SET default_playbook_id = ? WHERE id = ?').run(deesc, priya);
  db.prepare('UPDATE users SET default_playbook_id = ? WHERE id = ?').run(saas, theo);
  db.prepare('UPDATE users SET default_playbook_id = ? WHERE id = ?').run(phys, june);
  db.prepare('UPDATE users SET default_playbook_id = ? WHERE id = ?').run(deesc, adam);

  // ---- Knowledge base ----
  const docs = [
    ['Product_catalogue_2026.pdf', 'pdf', 'indexed',
      'Northwind Audio product catalogue 2026. The Aurora wireless headphones feature active noise cancellation, 40-hour battery life, and multipoint Bluetooth. The Pulse earbuds offer IPX5 water resistance and a 6-hour charge. All products include a 2-year warranty and a 30-day return policy. The companion app handles firmware sync; sync failures are usually fixed by updating to the latest app build. Enterprise customers get bulk pricing and a dedicated onboarding guide.'],
    ['Brand_voice_guidelines.docx', 'docx', 'indexed',
      'Northwind brand voice: warm, plain-spoken, never condescending. Acknowledge the customer\'s feeling before troubleshooting. Take ownership: say "let me fix this" rather than "that\'s not our policy". Avoid jargon. On sales calls, ask before you pitch — surface the real problem first, then map our products to that specific pain.'],
    ['Enterprise_onboarding_guide.pdf', 'pdf', 'analyzed',
      'Enterprise onboarding for Northwind audio fleets. Renewals are consultative and multi-stakeholder, focused on usage data and renewal risk. Track adoption metrics, identify the budget owner early, and review usage before every renewal conversation. Expansion opportunities come from teams hitting device limits.'],
  ];
  let enterpriseDocId = null;
  for (const [fn, type, status, text] of docs) {
    const did = id('doc');
    db.prepare(`INSERT INTO kb_documents (id,company_id,filename,type,status,storage_ref,size_bytes,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(did, nw, fn, type, status, null, text.length, now());
    indexDocument(nw, did, text);
    if (fn.startsWith('Enterprise')) enterpriseDocId = did;
  }

  // Auto-proposed playbook from the enterprise upload (spec §6.3)
  db.prepare(`INSERT INTO playbook_proposals (id,company_id,source_document_id,source_filename,draft,status,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id('prop'), nw, enterpriseDocId, 'Enterprise_onboarding_guide.pdf', JSON.stringify({
      mode: 'sales', name: 'Enterprise renewal — software', emoji: '🔁',
      description: 'Built from Enterprise_onboarding_guide.pdf. Consultative, multi-stakeholder, focused on usage data and renewal risk. 4 stages, 9 discovery prompts.',
      stages: ['Re-discover', 'Usage review', 'Risk & value', 'Renewal close'],
      discovery_bank: ['Who else touches this decision?', 'How are you using it today?', 'What changed since last term?', 'Where is value showing up?', 'Any teams hitting device limits?', 'What would make this a no-brainer to renew?', 'Who owns the budget?', 'When is the renewal date?', 'What would cause you to churn?'],
      rubric_weights: salesRubric, tactics: ['Multi-stakeholder', 'Usage data', 'Renewal risk'],
    }), 'pending', now());

  // ---- Calls (the four detailed ones from the mockup + extras for reporting) ----
  makeCall(nw, priya, {
    contact: 'Marcus Reyes', number: '+1 (415) 555-0148', mode: 'care', playbookId: deesc,
    callType: 'returning', touch: 3, direction: 'inbound', startedAt: daysAgo(0, 10, 24), duration: 461, score: 81, gap: 9,
    verdict: 'Solid recovery. Strong empathy, rushed the close.',
    summary: 'Returning customer, third call about a sync failure. Rep owned the issue early which dropped the heat. Root cause traced to an outdated app build; walked them through the update. Customer satisfied but pace was rushed at the wrap-up.',
    transcript: [
      { speaker: 'caller', text: "This is the third time I'm calling about my headphones not syncing. It's still broken and I'm frustrated.", t: '00:08' },
      { speaker: 'rep', text: "I hear you — three calls on the same issue is genuinely frustrating. Let me own this one and get it fixed today.", t: '00:42' },
      { speaker: 'caller', text: "I already tried reinstalling the app twice.", t: '01:30' },
      { speaker: 'rep', text: "Thanks for trying that. Can I confirm the account on file is the one tied to this order?", t: '02:10' },
      { speaker: 'rep', text: "Found it — your app build is outdated, that's the sync bug. Let's update it now.", t: '04:00' },
      { speaker: 'rep', text: "Okay that's done, you're all set, anything else?", t: '06:55' },
    ],
    scores: { empathy: 92, tone: 84, pacing: 63, discovery: 71, resolution: 88 },
    moments: [
      { ts: '00:42', severity: 'good', label: 'Owned the problem', detail: 'Took responsibility before troubleshooting — heat dropped fast.' },
      { ts: '03:18', severity: 'warn', label: 'Talked over the caller', detail: 'Jumped in twice while they were explaining. Cost you the listening score.' },
      { ts: '06:55', severity: 'bad', label: 'Rushed the wrap-up', detail: 'Confirmed the fix in one breath. Caller hesitated — pace too fast.' },
    ],
    coaching: 'After you state the fix, pause and ask "does that work for you?" — let the silence sit. It lifts pacing and resolution clarity together.',
    tasks: [
      { text: 'Email Marcus the build-update steps', kind: 'follow-up', done: false },
      { text: 'Flag recurring sync bug to product', kind: 'note', done: false },
    ],
    follow: { title: 'Check-in call — confirm sync fixed', starts_at: daysAhead(3) },
  });

  makeCall(nw, theo, {
    contact: 'Lena Ford', number: '+1 (628) 555-0112', mode: 'sales', playbookId: saas,
    callType: 'inbound', touch: 1, direction: 'inbound', startedAt: daysAgo(0, 9, 10), duration: 723, score: 90, gap: 14,
    verdict: 'Excellent call. Strong discovery, clean next step.',
    summary: 'Warm inbound lead. Strong discovery — surfaced that manual onboarding eats ~6 hrs/week. Mapped the automation to that pain and got a verbal yes to a trial. Pricing sent, decision expected next week.',
    transcript: [
      { speaker: 'caller', text: "We saw your demo and wanted to learn more.", t: '00:05' },
      { speaker: 'rep', text: "Before I show you anything — what are you using to handle onboarding today, and where is it falling short?", t: '00:30' },
      { speaker: 'caller', text: "It's all manual right now, probably six hours a week across the team.", t: '01:20' },
      { speaker: 'rep', text: "Six hours a week is real money. Here's exactly how we'd remove that, and what it's worth back to you.", t: '03:40' },
      { speaker: 'caller', text: "That sounds great, let's try it.", t: '09:00' },
    ],
    scores: { discovery: 92, objections: 86, value: 90, pacing: 88, close: 92 },
    moments: [
      { ts: '00:30', severity: 'good', label: 'Asked before pitching', detail: 'Opened in discovery, not a pitch — surfaced the real pain.' },
      { ts: '03:40', severity: 'good', label: 'Quantified the cost', detail: 'Tied the product to a number the caller gave you.' },
    ],
    coaching: 'Great call — next time, name the second stakeholder earlier so the trial kicks off multi-threaded.',
    tasks: [
      { text: 'Send trial access + pricing PDF', kind: 'follow-up', done: true },
      { text: 'Loop in their ops lead, Sam', kind: 'note', done: false },
    ],
    follow: { title: 'Trial kickoff with Lena + ops', starts_at: daysAhead(5, 14) },
  });

  makeCall(nw, june, {
    contact: 'Cobalt Labs', number: '+1 (917) 555-0190', mode: 'sales', playbookId: saas,
    callType: 'follow-up', touch: 3, direction: 'outbound', startedAt: daysAgo(1, 16, 45), duration: 560, score: 64, gap: -11,
    verdict: 'Decent, with gaps. Pitched before re-confirming the problem.',
    summary: 'Third follow-up. Pitched before fully re-confirming the problem, and hit a "we\'ll think about it" stall. Budget owner was not on the call — single-threaded. Needs a multi-stakeholder next step.',
    transcript: [
      { speaker: 'rep', text: "Hi, following up again — I wanted to walk through the plan and pricing.", t: '00:10' },
      { speaker: 'caller', text: "We're still thinking about it honestly.", t: '02:30' },
      { speaker: 'rep', text: "Totally fair. Can I ask what's behind the hesitation?", t: '03:10' },
      { speaker: 'caller', text: "I'd need to loop in the person who owns the budget.", t: '04:40' },
    ],
    scores: { discovery: 60, objections: 66, value: 68, pacing: 70, close: 58 },
    moments: [
      { ts: '00:10', severity: 'warn', label: 'Pitched too early', detail: 'Led with plan/pricing before re-confirming the problem.' },
      { ts: '02:30', severity: 'bad', label: '"Think about it" stall', detail: 'Single-threaded — budget owner not on the call.' },
    ],
    coaching: 'When you hear a stall, slow down and ask what\'s behind it before answering the surface objection.',
    tasks: [
      { text: 'Get intro to the budget owner', kind: 'follow-up', done: false },
      { text: 'Re-run discovery on current blockers', kind: 'note', done: false },
    ],
    follow: { title: 'Multi-stakeholder review — Cobalt', starts_at: daysAhead(9, 15) },
  });

  makeCall(nw, adam, {
    contact: 'Wills Tan', number: '+1 (510) 555-0177', mode: 'care', playbookId: deesc,
    callType: 'new', touch: 1, direction: 'inbound', startedAt: daysAgo(1, 11, 2), duration: 312, score: 77, gap: 4,
    verdict: 'Good recovery. Clear resolution, upsold a touch early.',
    summary: 'First-time setup question. Calm caller, clear resolution. Rep checked understanding at each step. Minor: offered an upsell a bit early before the original issue was fully closed.',
    transcript: [
      { speaker: 'caller', text: "I just got my earbuds and I can't get them to pair.", t: '00:06' },
      { speaker: 'rep', text: "Happy to help. What do you see on the screen when you try?", t: '00:30' },
      { speaker: 'rep', text: "Great, let's put them back in the case and hold the button for five seconds.", t: '02:00' },
    ],
    scores: { empathy: 78, tone: 80, pacing: 74, discovery: 72, resolution: 82 },
    moments: [
      { ts: '00:30', severity: 'good', label: 'Checked understanding', detail: 'Confirmed what the caller saw before giving steps.' },
      { ts: '03:40', severity: 'warn', label: 'Upsold early', detail: 'Offered an accessory before the original issue was fully closed.' },
    ],
    coaching: 'Finish one issue and confirm it before introducing anything new — it keeps resolution clarity high.',
    tasks: [{ text: 'Send setup guide link', kind: 'follow-up', done: true }],
    follow: null,
  });

  // Extra lightweight calls so reporting/leaderboard look populated.
  const extras = [
    [priya, 'care', deesc, 'Elena Park', 92, 'billing', daysAgo(0, 13)],
    [priya, 'care', deesc, 'Ray Bowen', 88, 'returning', daysAgo(1, 9)],
    [priya, 'care', deesc, 'Mona Diaz', 90, 'new', daysAgo(2, 15)],
    [theo, 'sales', saas, 'Drift Works', 74, 'cold', daysAgo(1, 10)],
    [theo, 'sales', saas, 'Nexa Retail', 85, 'follow-up', daysAgo(1, 14)],
    [theo, 'sales', phys, 'Pine Mobile', 80, 'inbound', daysAgo(2, 11)],
    [june, 'sales', phys, 'Pine Mobile', 82, 'inbound', daysAgo(1, 12)],
    [june, 'sales', phys, 'Vela Goods', 70, 'cold', daysAgo(2, 16)],
    [adam, 'care', deesc, 'Gita Hahn', 58, 'returning', daysAgo(1, 13)],
    [adam, 'care', deesc, 'Sol Pereira', 72, 'new', daysAgo(2, 10)],
  ];
  for (const [rep, mode, pb, contact, score, callType, startedAt] of extras) {
    makeCall(nw, rep, {
      contact, mode, playbookId: pb, callType, startedAt, duration: 300 + (score % 7) * 30, score, gap: score - 80,
      summary: `${callType} ${mode} call with ${contact}. Auto-scored ${score}.`,
      scores: mode === 'care'
        ? { empathy: score, tone: score - 2, pacing: score - 8, discovery: score - 5, resolution: score + 2 }
        : { discovery: score, objections: score - 4, value: score, pacing: score - 3, close: score - 6 },
    });
  }

  // ---- Other tenants (super-admin table) ----
  const bright = company('Brightline SaaS', 'Scale', 'active', 10, 'azure');
  user(bright, 'Maya Brandt', 'maya@brightline.example', 'company_admin', 'sales', 'full');
  user(bright, 'Leo Park', 'leo@brightline.example', 'sales_rep', 'sales', 'self');
  const harbor = company('Harbor & Co', 'Starter', 'trial', 3, 'sunset');
  user(harbor, 'Otis Vance', 'otis@harbor.example', 'company_admin', 'care', 'full');

  console.log('Seed complete.');
  console.log('Login with any of: dani@callaid.io (super admin), avery@northwind.example (company admin),');
  console.log('priya@ / theo@ / june@ / adam@northwind.example (reps) — password: demo1234');
}

run();
