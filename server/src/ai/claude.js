// Claude adapter — the reference LLM implementation (spec §7). Uses the official
// Anthropic SDK with the tenant's own API key (BYO key, billed to them). Returns
// the SAME structured contract as the fallback engine, so the two are
// interchangeable: tenants with a key get live Claude guidance; everyone else
// gets the deterministic engine. Structured output is via forced tool-use so the
// client receives typed fields, never prose to parse.
import Anthropic from '@anthropic-ai/sdk';
import { liveSystemPrompt, analysisSystemPrompt, proposalSystemPrompt, STAGES, RUBRICS, DIMENSION_LABELS } from './prompts.js';

// Fast/cheap model for the live loop; stronger model for post-call analysis
// (spec §7.2/§7.4). Model IDs verified against the Claude API reference.
const LIVE_MODEL = process.env.CALLAID_LIVE_MODEL || 'claude-haiku-4-5';
const ANALYSIS_MODEL = process.env.CALLAID_ANALYSIS_MODEL || 'claude-opus-4-8';

function client(apiKey) {
  return new Anthropic({ apiKey });
}

function transcriptText(transcript) {
  return transcript.map(t => `${t.speaker === 'rep' ? 'REP' : 'CALLER'}: ${t.text}`).join('\n');
}

// Extract the single forced tool-use input from a response.
function toolInput(msg, name) {
  const block = msg.content.find(b => b.type === 'tool_use' && b.name === name);
  return block ? block.input : null;
}

// ---- Live suggestion (low-latency, forced tool-use) ----
const LIVE_TOOL = {
  name: 'emit_guidance',
  description: 'Emit the live in-call guidance for the rep.',
  input_schema: {
    type: 'object',
    properties: {
      kicker: { type: 'string', description: 'Short label for the cue, e.g. "Ask, don\'t pitch".' },
      line: { type: 'string', description: 'The single best next line for the rep to say now.' },
      why: { type: 'string', description: 'One sentence on why this works.' },
      alts: { type: 'array', items: { type: 'string' }, description: '2-3 alternative quick actions.' },
      stage: { type: 'string', description: 'The detected current stage name.' },
      listen: { type: 'boolean', description: 'True if the rep should just listen and not interrupt.' },
      tone: { type: 'integer', description: 'Rep tone 0 (firm) to 100 (warm).' },
      pace: { type: 'integer', description: 'Rep pace 0 (steady) to 100 (rushing).' },
      caller_energy: { type: 'integer', description: 'Caller energy 0-100.' },
      discovery_complete: { type: 'boolean', description: 'True if the real problem has been captured.' },
      score: { type: 'integer', description: 'Running call score 0-100.' },
    },
    required: ['kicker', 'line', 'why', 'alts', 'stage', 'listen', 'score'],
  },
};

export async function suggest(apiKey, ctx) {
  const { transcript = [], mode = 'care', playbook = null, companyName = 'the company', kbContext = '', callType, touchNumber } = ctx;
  const stages = playbook?.stages || STAGES[mode];
  const user = [
    kbContext ? `Knowledge base context (ground all product/policy claims in this):\n${kbContext}\n` : 'No KB context retrieved — do not invent product facts.',
    `Call type: ${callType || 'unknown'} · touch ${touchNumber || 1}.`,
    `Recent transcript:\n${transcriptText(transcript) || '(call just started)'}`,
    'Emit the guidance now via the emit_guidance tool.',
  ].join('\n\n');

  const msg = await client(apiKey).messages.create({
    model: LIVE_MODEL,
    max_tokens: 1024,
    system: liveSystemPrompt({ mode, playbook, companyName }),
    tools: [LIVE_TOOL],
    tool_choice: { type: 'tool', name: 'emit_guidance' },
    messages: [{ role: 'user', content: user }],
  });

  const out = toolInput(msg, 'emit_guidance');
  if (!out) throw new Error('no_guidance');
  const idx = Math.max(0, stages.indexOf(out.stage));
  const tone = out.tone ?? 60, pace = out.pace ?? 45, callerEnergy = out.caller_energy ?? 50;
  return {
    cue: { kicker: out.kicker, line: out.line, why: out.why, alts: out.alts || [] },
    stage: { name: out.stage, index: idx < 0 ? 0 : idx, all: stages },
    gauges: {
      tone: { value: tone, read: tone > 66 ? 'Warm' : tone > 40 ? 'Even' : 'Firm', state: tone < 45 ? 'A touch firm — soften' : 'Hold this warmth' },
      pace: { value: pace, read: pace > 62 ? 'Fast' : pace > 38 ? 'Steady' : 'Slow', state: pace > 62 ? 'Slow down' : 'Pace is good' },
      energy: { caller: callerEnergy, you: Math.max(20, callerEnergy - 25), gap: Math.round(Math.abs(callerEnergy - 50) / 25), callerLabel: callerEnergy > 65 ? 'heated' : 'engaged', youLabel: 'calm' },
    },
    discovery: [],
    discoveryComplete: !!out.discovery_complete,
    listen: !!out.listen,
    score: out.score,
    scoreTrend: tone > 55 ? 'trending up' : 'hold steady',
  };
}

// ---- Post-call analysis (stronger model, structured output) ----
function analysisTool(mode, playbook) {
  const rubric = playbook?.rubric_weights && Object.keys(playbook.rubric_weights).length ? playbook.rubric_weights : RUBRICS[mode];
  const dims = Object.keys(rubric);
  return {
    name: 'emit_analysis',
    description: 'Emit the structured post-call analysis.',
    input_schema: {
      type: 'object',
      properties: {
        overall: { type: 'integer' },
        verdict: { type: 'string' },
        scores: {
          type: 'array',
          items: {
            type: 'object',
            properties: { dimension: { type: 'string', enum: dims }, value: { type: 'integer' } },
            required: ['dimension', 'value'],
          },
        },
        moments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ts: { type: 'string' }, severity: { type: 'string', enum: ['good', 'warn', 'bad'] },
              label: { type: 'string' }, detail: { type: 'string' },
            },
            required: ['ts', 'severity', 'label', 'detail'],
          },
        },
        coaching: { type: 'string', description: 'Exactly one concrete "try next time" tip.' },
        summary: { type: 'string' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: { text: { type: 'string' }, kind: { type: 'string', enum: ['follow-up', 'note'] } },
            required: ['text', 'kind'],
          },
        },
        follow_up: {
          type: ['object', 'null'],
          properties: { title: { type: 'string' }, days_out: { type: 'integer' } },
        },
      },
      required: ['overall', 'verdict', 'scores', 'moments', 'coaching', 'summary', 'tasks'],
    },
  };
}

export async function analyze(apiKey, ctx) {
  const { transcript = [], mode = 'care', playbook = null, companyName = 'the company', contactName = 'the caller' } = ctx;
  const tool = analysisTool(mode, playbook);
  const msg = await client(apiKey).messages.create({
    model: ANALYSIS_MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    system: analysisSystemPrompt({ mode, playbook, companyName }),
    tools: [tool],
    tool_choice: { type: 'tool', name: 'emit_analysis' },
    messages: [{ role: 'user', content: `Call with ${contactName}. Full transcript:\n${transcriptText(transcript)}\n\nProduce the analysis via emit_analysis.` }],
  });
  const out = toolInput(msg, 'emit_analysis');
  if (!out) throw new Error('no_analysis');
  const follow = out.follow_up
    ? { title: out.follow_up.title, starts_at: new Date(Date.now() + (out.follow_up.days_out || 3) * 86400000).toISOString() }
    : null;
  return {
    overall: out.overall,
    verdict: out.verdict,
    scores: out.scores.map(s => ({ ...s, label: DIMENSION_LABELS[s.dimension] || s.dimension })),
    moments: out.moments,
    coaching: out.coaching,
    summary: out.summary,
    tasks: out.tasks,
    follow,
    gap: out.overall - 85,
  };
}

// ---- Auto playbook proposal ----
const PROPOSAL_TOOL = {
  name: 'emit_proposal',
  description: 'Emit a proposed playbook, or set warranted=false if the material does not warrant one.',
  input_schema: {
    type: 'object',
    properties: {
      warranted: { type: 'boolean' },
      mode: { type: 'string', enum: ['care', 'sales'] },
      name: { type: 'string' },
      emoji: { type: 'string' },
      description: { type: 'string' },
      stages: { type: 'array', items: { type: 'string' } },
      discovery_bank: { type: 'array', items: { type: 'string' } },
      tactics: { type: 'array', items: { type: 'string' } },
    },
    required: ['warranted'],
  },
};

export async function propose(apiKey, { companyName = 'the company', filename = 'document', text = '' }) {
  const msg = await client(apiKey).messages.create({
    model: ANALYSIS_MODEL,
    max_tokens: 1500,
    system: proposalSystemPrompt({ companyName }),
    tools: [PROPOSAL_TOOL],
    tool_choice: { type: 'tool', name: 'emit_proposal' },
    messages: [{ role: 'user', content: `File: ${filename}\n\nExcerpt:\n${text.slice(0, 6000)}\n\nDecide and emit via emit_proposal.` }],
  });
  const out = toolInput(msg, 'emit_proposal');
  if (!out || !out.warranted) return null;
  return {
    mode: out.mode || 'sales', name: out.name, emoji: out.emoji || '✨',
    description: out.description || `Proposed from ${filename}.`,
    stages: out.stages || [], discovery_bank: out.discovery_bank || [],
    rubric_weights: RUBRICS[out.mode || 'sales'], tactics: out.tactics || [],
  };
}
