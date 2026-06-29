// Deterministic, offline AI engine. Produces realistic live cues, gauges, and
// post-call analysis purely from transcript heuristics + the company's KB — no
// network, no key. This is the graceful-degradation path (spec §13): if a tenant
// has no LLM key or the provider is slow/unavailable, guidance still flows.
// It implements the exact same contract as the Claude adapter.
import { STAGES, RUBRICS, DIMENSION_LABELS, DISCOVERY_SLOTS } from './prompts.js';

const ACK = ['sorry', 'understand', 'hear you', 'apolog', 'i get', 'makes sense', 'thank', 'appreciate', 'frustrat'];
const CURT = ['no', 'cannot', "can't", 'policy', 'have to', 'just', 'actually', 'but'];
const NEG = ['angry', 'ridiculous', 'unacceptable', 'terrible', 'broken', 'again', 'still', 'worst', 'frustrated', 'annoyed', 'wrong', 'never works'];
const PITCH = ['our product', 'we offer', 'the plan', 'pricing', 'features', 'upgrade', 'package', 'discount'];

function repTurns(t) { return t.filter(x => x.speaker === 'rep'); }
function callerTurns(t) { return t.filter(x => x.speaker === 'caller'); }
function hits(text, list) { const l = text.toLowerCase(); return list.reduce((n, w) => n + (l.includes(w) ? 1 : 0), 0); }
function clamp(n, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, Math.round(n))); }

// ---- Tone / pace / energy (acoustic stand-ins from text, spec §7.3) ----
function gauges(transcript) {
  const rep = repTurns(transcript);
  const caller = callerTurns(transcript);
  const repText = rep.map(t => t.text).join(' ');
  const callerText = caller.map(t => t.text).join(' ');

  const ack = hits(repText, ACK);
  const curt = hits(repText, CURT);
  // 0 = firm, 100 = warm
  const tone = clamp(55 + ack * 9 - curt * 5);
  // words per rep turn as a pace proxy; long bursts => rushing
  const wpt = rep.length ? repText.split(/\s+/).length / rep.length : 12;
  const pace = clamp(40 + (wpt - 14) * 3.2); // 0 steady .. 100 rushing
  // caller energy from negative-word density and exclamation
  const callerEnergy = clamp(35 + hits(callerText, NEG) * 11 + (callerText.match(/!/g) || []).length * 6);
  const repEnergy = clamp(40 + ack * 4);

  return {
    tone: {
      value: tone,
      read: tone > 66 ? 'Warm' : tone > 40 ? 'Even' : 'Firm',
      state: tone < 45 ? 'A touch firm — soften' : tone > 80 ? 'Warm — good' : 'Hold this warmth',
    },
    pace: {
      value: pace,
      read: pace > 62 ? 'Fast' : pace > 38 ? 'Steady' : 'Slow',
      state: pace > 62 ? `Slow down ~${Math.min(25, Math.round((pace - 50) / 2))}%` : 'Pace is good',
    },
    energy: {
      caller: callerEnergy,
      you: repEnergy,
      gap: Math.round(Math.abs(callerEnergy - repEnergy) / 25),
      callerLabel: callerEnergy > 65 ? 'heated' : callerEnergy > 45 ? 'engaged' : 'calm',
      youLabel: repEnergy > 65 ? 'high' : repEnergy > 45 ? 'calm' : 'flat',
    },
  };
}

// ---- Discovery tracking + stage detection (spec §6.4) ----
function trackDiscovery(transcript, mode, playbook) {
  const slots = (playbook?.discovery_slots) || DISCOVERY_SLOTS[mode];
  const text = transcript.map(t => t.text).join(' ').toLowerCase();
  const captured = slots.map(s => {
    let ok = false; let value = '';
    if (mode === 'care') {
      if (s.key === 'symptom') { ok = /(won'?t|not working|broken|error|fail|issue|problem|crash|sync)/.test(text); value = ok ? 'reported' : ''; }
      if (s.key === 'tried') { ok = /(tried|reinstall|restart|reset|already)/.test(text); value = ok ? 'noted' : ''; }
      if (s.key === 'account') { ok = /(account|order|confirm|email|verify)/.test(text); value = ok ? 'verified' : ''; }
    } else {
      if (s.key === 'current') { ok = /(using|currently|today|right now|we use|on)/.test(text) && /(tool|system|software|spreadsheet|manual|zendesk|salesforce)/.test(text); }
      if (s.key === 'team') { ok = /(team|people|reps|agents|\b\d+\b)/.test(text); }
      if (s.key === 'pain') { ok = /(falling short|problem|costing|slow|painful|bottleneck|waste|hours|struggle|hard)/.test(text); }
    }
    return { key: s.key, label: s.label, captured: ok, value };
  });
  const missing = captured.filter(c => !c.captured);
  const discoveryComplete = missing.length === 0 || (missing.length === 1 && transcript.length > 8);
  return { captured, missing, discoveryComplete };
}

function detectStage(mode, transcript, disco, playbook) {
  const stages = playbook?.stages || STAGES[mode];
  const captured = disco.captured.filter(c => c.captured).length;
  const total = disco.captured.length || 1;
  const ratio = captured / total;
  let idx;
  if (ratio < 0.4) idx = 0;
  else if (!disco.discoveryComplete) idx = 1;
  else if (disco.discoveryComplete && transcript.length < 12) idx = 2;
  else idx = Math.min(3, stages.length - 1);
  return { stages, index: Math.min(idx, stages.length - 1), name: stages[Math.min(idx, stages.length - 1)] };
}

// ---- Live "say next" cue ----
function liveCue({ mode, transcript, disco, stage, kbContext, callType, touchNumber }) {
  const lastCaller = [...callerTurns(transcript)].pop()?.text || '';
  const venting = lastCaller.split(/\s+/).length > 22 || hits(lastCaller, NEG) >= 2;

  // Discovery gate — never pitch before the problem is on the table.
  if (!disco.discoveryComplete) {
    const slot = disco.missing[0];
    const probe = slot?.probes?.[0] || (mode === 'sales' ? 'What are you using to handle this today?' : 'Walk me through exactly what happened?');
    return {
      kicker: mode === 'sales' ? "Ask, don't pitch" : 'Diagnose first',
      line: mode === 'sales'
        ? `"Before I show you anything — ${probe.toLowerCase().replace(/\?$/, '')}, and where is it falling short?"`
        : `"${probe}"`,
      why: mode === 'sales'
        ? `${callType || 'Inbound'}, touch ${touchNumber || 1} — still in discovery. Get current-state and the real pain before any pitch.`
        : 'Reflect the problem back in their words before offering any fix. It lowers heat and earns the resolution.',
      alts: (mode === 'sales' ? DISCOVERY_SLOTS.sales : DISCOVERY_SLOTS.care)
        .flatMap(s => s.probes).slice(0, 3),
      stage: stage.name,
      stageIndex: stage.index,
      listen: venting,
    };
  }

  // Past the gate: map the company's product/policy (from KB) to the captured pain.
  const grounded = kbContext ? ` Ground it in: "${kbContext.slice(0, 90).trim()}…"` : '';
  if (mode === 'sales') {
    return {
      kicker: 'Map to their pain',
      line: '"Given the manual work you described, here\'s exactly how we\'d remove it — and what that\'s worth to you each week."',
      why: 'Problem is captured; now tie the product to that specific pain, not a generic pitch.' + grounded,
      alts: ['Quantify the cost', 'Confirm the decision-maker', 'Propose a trial next step'],
      stage: stage.name, stageIndex: stage.index, listen: venting,
    };
  }
  return {
    kicker: 'Resolve + confirm',
    line: '"Here\'s the fix, step by step — and I\'ll stay on until it\'s working for you."',
    why: 'Problem is understood; deliver the resolution clearly, then confirm it landed before closing.' + grounded,
    alts: ['Walk through the steps', 'Confirm it works for them', 'Offer a follow-up check-in'],
    stage: stage.name, stageIndex: stage.index, listen: venting,
  };
}

// ---- Live score (running) ----
function liveScore(g, disco) {
  const base = 60 + (g.tone.value - 50) * 0.25 - Math.max(0, g.pace.value - 55) * 0.3
    + disco.captured.filter(c => c.captured).length * 5;
  return clamp(base, 40, 98);
}

export function suggest(ctx) {
  const { transcript = [], mode = 'care', playbook = null, kbContext = '', callType, touchNumber } = ctx;
  const g = gauges(transcript);
  const disco = trackDiscovery(transcript, mode, playbook);
  const stage = detectStage(mode, transcript, disco, playbook);
  const cue = liveCue({ mode, transcript, disco, stage, kbContext, callType, touchNumber });
  return {
    cue: { kicker: cue.kicker, line: cue.line, why: cue.why, alts: cue.alts },
    stage: { name: cue.stage, index: cue.stageIndex, all: stage.stages },
    gauges: g,
    discovery: disco.captured,
    discoveryComplete: disco.discoveryComplete,
    listen: cue.listen,
    score: liveScore(g, disco),
    scoreTrend: g.tone.value > 55 ? 'trending up' : 'hold steady',
  };
}

// ---- Post-call analysis (spec §6.5 / §7.4) ----
export function analyze(ctx) {
  const { transcript = [], mode = 'care', playbook = null, contactName = 'the caller', durationSec = 0 } = ctx;
  const g = gauges(transcript);
  const disco = trackDiscovery(transcript, mode, playbook);
  const rubric = playbook?.rubric_weights && Object.keys(playbook.rubric_weights).length
    ? playbook.rubric_weights : RUBRICS[mode];
  const repText = repTurns(transcript).map(t => t.text).join(' ');

  const raw = {
    empathy: clamp(60 + hits(repText, ACK) * 7),
    tone: g.tone.value,
    pacing: clamp(100 - g.pace.value),
    discovery: clamp(50 + disco.captured.filter(c => c.captured).length * 16),
    resolution: clamp(60 + (/(fix|resolved|update|sorted|working|done)/.test(repText.toLowerCase()) ? 25 : 5)),
    objections: clamp(58 + hits(repText, ACK) * 5),
    value: clamp(55 + hits(repText, PITCH) * 7),
    close: clamp(55 + (/(next step|trial|schedule|sign|send|book)/.test(repText.toLowerCase()) ? 25 : 8)),
  };

  const dims = Object.keys(rubric);
  const scores = dims.map(d => ({ dimension: d, label: DIMENSION_LABELS[d] || d, value: raw[d] ?? 70 }));
  const overall = clamp(scores.reduce((s, x) => s + x.value * (rubric[x.dimension] || 0), 0));

  // Timestamped moments from the transcript.
  const moments = [];
  transcript.forEach((turn, i) => {
    const ts = turn.t || mmss(Math.round((i / Math.max(1, transcript.length)) * Math.max(durationSec, transcript.length * 8)));
    if (turn.speaker === 'rep' && hits(turn.text, ACK) >= 1 && moments.filter(m => m.severity === 'good').length < 1)
      moments.push({ ts, severity: 'good', label: 'Owned the problem', detail: 'Acknowledged + took responsibility early — heat dropped.' });
    if (turn.speaker === 'rep' && turn.interrupt)
      moments.push({ ts, severity: 'warn', label: 'Talked over the caller', detail: 'Jumped in while they were explaining. Cost listening score.' });
    if (turn.speaker === 'rep' && g.pace.value > 62 && i > transcript.length - 3)
      moments.push({ ts, severity: 'bad', label: 'Rushed the wrap-up', detail: 'Confirmed in one breath — pace too fast at the close.' });
  });
  if (!moments.length) moments.push({ ts: '00:30', severity: 'good', label: 'Stayed on track', detail: 'Kept the call moving and on-topic.' });

  const lowest = [...scores].sort((a, b) => a.value - b.value)[0];
  const coaching = COACH[lowest.dimension] || 'Pause after your key point and let the silence sit — it lifts clarity and pacing together.';

  const summary = buildSummary({ mode, contactName, disco, scores, overall });
  const tasks = extractTasks({ mode, transcript, contactName });
  const follow = scheduleFollow({ mode, transcript, contactName });

  return {
    overall,
    verdict: verdict(overall, scores),
    scores,
    moments: moments.slice(0, 5),
    coaching,
    summary,
    tasks,
    follow,
    gap: overall - clamp(playbookTarget(rubric, raw)),
  };
}

const COACH = {
  pacing: 'After you state the fix, pause and ask "does that work for you?" — let the silence sit. It lifts pacing and resolution together.',
  discovery: 'Hold in discovery one beat longer: ask "is that the main thing, or is something underneath it?" before moving to a solution.',
  empathy: 'Name the feeling once, in their words, before troubleshooting — "that\'s frustrating after three calls" — then act.',
  tone: 'Swap one policy phrase for a warm one: "what I can do is…" instead of "I can\'t…". Same outcome, softer landing.',
  resolution: 'Restate the resolution in one clean sentence and confirm it back before you close.',
  objections: 'When you hear a stall, slow down and ask what\'s behind it instead of answering the surface objection.',
  value: 'Tie one feature to the exact cost they named — value framing lands when it\'s their number, not yours.',
  close: 'Ask for one concrete next step every call: a time, a trial, an intro — don\'t leave it open.',
};

function playbookTarget(rubric) { return Object.keys(rubric).reduce((s, k) => s + 85 * rubric[k], 0); }
function verdict(overall, scores) {
  const top = [...scores].sort((a, b) => b.value - a.value)[0];
  const low = [...scores].sort((a, b) => a.value - b.value)[0];
  const head = overall >= 85 ? 'Excellent call.' : overall >= 72 ? 'Solid recovery.' : overall >= 60 ? 'Decent, with gaps.' : 'Needs work.';
  return `${head} Strong ${top.label.toLowerCase()}, watch ${low.label.toLowerCase()}.`;
}
function buildSummary({ mode, contactName, disco, overall }) {
  const captured = disco.captured.filter(c => c.captured).map(c => c.label.toLowerCase()).join(', ');
  if (mode === 'sales') {
    return `${contactName}: ${disco.discoveryComplete ? 'discovery surfaced the real pain' : 'discovery was incomplete — pitched before the problem was fully on the table'}. Captured ${captured || 'limited context'}. ${overall >= 80 ? 'Mapped the product to that pain and earned a next step.' : 'Needs a clearer next step and the decision-maker involved.'}`;
  }
  return `${contactName}: ${disco.discoveryComplete ? 'diagnosed the issue before resolving' : 'moved to a fix before fully diagnosing'}. Captured ${captured || 'limited context'}. ${overall >= 80 ? 'Resolution was clear and the customer left satisfied.' : 'Resolution landed but pace/clarity could improve.'}`;
}
function extractTasks({ mode, transcript, contactName }) {
  const text = transcript.map(t => t.text).join(' ').toLowerCase();
  const tasks = [];
  if (/(send|email|share|link|guide|pricing|pdf|steps)/.test(text))
    tasks.push({ text: `Email ${contactName} the ${mode === 'sales' ? 'pricing + next steps' : 'steps we covered'}`, kind: 'follow-up' });
  if (/(bug|recurring|again|still|escalat|product)/.test(text))
    tasks.push({ text: mode === 'sales' ? 'Loop in the decision-maker' : 'Flag recurring issue to product', kind: 'note' });
  if (!tasks.length) tasks.push({ text: `Log outcome for ${contactName}`, kind: 'note' });
  return tasks;
}
function scheduleFollow({ mode, transcript, contactName }) {
  const text = transcript.map(t => t.text).join(' ').toLowerCase();
  if (!/(follow|call back|next week|check in|trial|kickoff|review|callback|schedule)/.test(text)) return null;
  const start = new Date(Date.now() + 3 * 86400000);
  return {
    title: mode === 'sales' ? `Follow-up with ${contactName}` : `Check-in call — confirm fixed (${contactName})`,
    starts_at: start.toISOString(),
  };
}
function mmss(s) { const m = Math.floor(s / 60); const r = s % 60; return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`; }

// ---- Auto playbook proposal from an upload (spec §6.3 / §7.5) ----
export function propose({ filename = 'document', text = '' }) {
  const l = (filename + ' ' + text).toLowerCase();
  if (/(renewal|enterprise|onboarding|saas|software|contract|expansion)/.test(l)) {
    return {
      mode: 'sales', name: 'Enterprise renewal — software', emoji: '🔁',
      description: `Built from ${filename}. Consultative, multi-stakeholder, focused on usage data and renewal risk.`,
      stages: ['Re-discover', 'Usage review', 'Risk & value', 'Renewal close'],
      discovery_bank: ['Who else touches this decision?', 'How are you using it today?', 'What changed since last term?', 'Where is value showing up?', 'What would make this a no-brainer to renew?'],
      rubric_weights: { discovery: 0.25, objections: 0.2, value: 0.25, pacing: 0.1, close: 0.2 },
      tactics: ['Multi-stakeholder', 'Usage data', 'Renewal risk'],
    };
  }
  if (/(return|refund|warranty|complaint|policy|escalat)/.test(l)) {
    return {
      mode: 'care', name: 'Returns & escalations', emoji: '📦',
      description: `Built from ${filename}. De-escalation plus precise policy handling for returns and refunds.`,
      stages: ['Listen', 'Verify policy', 'Resolve', 'Confirm'],
      discovery_bank: ['What would put this right for you?', 'Do you have the order details?', 'When was the purchase?'],
      rubric_weights: { empathy: 0.25, tone: 0.2, pacing: 0.15, discovery: 0.15, resolution: 0.25 },
      tactics: ['Policy-precise', 'De-escalation'],
    };
  }
  return null; // material does not warrant a new playbook
}
