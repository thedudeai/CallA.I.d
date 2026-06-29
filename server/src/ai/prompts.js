// Mode + playbook + stage + call-type select a prompt template and rubric.
// These live as editable configuration (spec §7) so playbooks tune behaviour
// without code changes. The fallback engine and the Claude adapter both read
// from here, so swapping providers never changes the guidance contract.

export const STAGES = {
  care: ['Listen', 'Diagnose', 'Resolve', 'Confirm'],
  sales: ['Discovery', 'Problem', 'Solution', 'Close'],
};

// Default scoring rubric per mode (dimension -> weight). Playbooks may override.
export const RUBRICS = {
  care: {
    empathy: 0.25,
    tone: 0.2,
    pacing: 0.15,
    discovery: 0.2,
    resolution: 0.2,
  },
  sales: {
    discovery: 0.25,
    objections: 0.2,
    value: 0.2,
    pacing: 0.15,
    close: 0.2,
  },
};

export const DIMENSION_LABELS = {
  empathy: 'Empathy & acknowledgement',
  tone: 'Tone control',
  pacing: 'Pacing',
  discovery: 'Discovery / listening',
  resolution: 'Resolution clarity',
  objections: 'Objection handling',
  value: 'Value framing',
  close: 'Close strength',
};

// The discovery slots a playbook wants filled before it will leave the
// discovery/diagnose gate (spec §6.4). Keyed by mode; playbooks may extend.
export const DISCOVERY_SLOTS = {
  care: [
    { key: 'symptom', label: 'Symptom / problem', probes: ["What exactly is happening?", 'When did it start?'] },
    { key: 'tried', label: 'What they tried', probes: ['What have you tried so far?'] },
    { key: 'account', label: 'Account verified', probes: ['Can I confirm the account on file?'] },
  ],
  sales: [
    { key: 'current', label: 'Current tool / state', probes: ['What are you using to handle this today?'] },
    { key: 'team', label: 'Team / scale', probes: ['How big is the team that touches this?'] },
    { key: 'pain', label: 'Real pain / cost', probes: ["Where is that falling short?", "Where's it costing you?"] },
  ],
};

// System prompt for the live (low-latency) loop. The model returns structured
// fields via tool-use; never free prose to parse (spec §7.2).
export function liveSystemPrompt({ mode, playbook, companyName }) {
  const role = mode === 'sales'
    ? 'an elite sales coach whispering in a rep\'s ear during a live call'
    : 'an elite customer-care coach whispering in a rep\'s ear during a live call';
  return [
    `You are CallA.I.d — ${role} for ${companyName}.`,
    `Mode: ${mode}. Playbook: ${playbook?.name || 'default'}.`,
    `Stages: ${(playbook?.stages || STAGES[mode]).join(' -> ')}.`,
    'Rules:',
    '- Ground every product/policy claim ONLY in the provided knowledge-base context. Never invent facts.',
    '- Discovery is the gate: before suggesting any solution/pitch, the real problem must be captured. If it is not, stay in discovery and produce a probing question, not a pitch.',
    '- Output the single most useful next line, why it works, 2-3 alternative quick actions, the detected stage, and whether the rep should just listen.',
    '- Keep the line short enough to read mid-conversation while talking to a stressed human.',
  ].join('\n');
}

// System prompt for post-call analysis (spec §7.4) — stronger model, no latency
// pressure, structured scoring + coaching + extraction.
export function analysisSystemPrompt({ mode, playbook, companyName }) {
  const rubric = playbook?.rubric_weights && Object.keys(playbook.rubric_weights).length
    ? playbook.rubric_weights : RUBRICS[mode];
  return [
    `You are CallA.I.d post-call analyst for ${companyName}.`,
    `Score this ${mode} call against the playbook rubric: ${Object.keys(rubric).map(k => DIMENSION_LABELS[k] || k).join(', ')}.`,
    'Produce: overall score (0-100), a one-line verdict, per-dimension scores, 3-5 timestamped moments (good/warn/bad),',
    'EXACTLY ONE concrete "try next time" coaching tip, a short summary paragraph, extracted tasks/notes,',
    'and a follow-up calendar event only if the call implies one. Be specific and actionable; no laundry lists.',
  ].join('\n');
}

export function proposalSystemPrompt({ companyName }) {
  return [
    `You are CallA.I.d analysing a newly uploaded document for ${companyName}.`,
    'Decide whether the material warrants a NEW playbook/mode (e.g. an enterprise renewal guide -> a "software renewal" sales model).',
    'If yes, draft its mode, name, stages, discovery bank, rubric and tactic tags for admin approval. If not, say so.',
  ].join('\n');
}
