// Deep Dive MCP (GRE-4341): the protocol, the tools and their input checks. Same shape as the website's
// portal MCP (GRE-1228): JSON-RPC over one POST, tools only, no SDK and so no dependency to review.
//
// Security lives in the database (migration 0010_deep_dive_mcp): every tool calls one indago.mcp_* function
// with the SHA-256 of the caller's token and the engagement it asks about; the function refuses a token
// for another engagement. Agents write DRAFTS only. A facilitator approves them in the portal.

export const SERVER_INFO = { name: 'greatstone-deep-dive', version: '1.0.0' };
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const TOKEN_RE = /^gsdd_[0-9a-f]{64}$/;
export const MAX_BODY_BYTES = 256 * 1024;
export const ANSWER_STATUSES = ['answered', 'not_answered', 'unclear'];
export const LIMITS = { title: 200, ref: 80, question: 1000, answer: 5000, quote: 600, at: 20, items: 150, notes: 60, note: 2000, source: 500, person: 200, value: 5000, columns: 60 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s) => typeof s === 'string' && UUID_RE.test(s);

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── payload checks ────────────────────────────────────────────────────────────────────────────

const text = (v, max, name, problems, { required = false } = {}) => {
  if (v == null || v === '') { if (required) problems.push(`${name} is needed`); return; }
  if (typeof v !== 'string') return problems.push(`${name} must be text`);
  if (required && !v.trim()) problems.push(`${name} cannot be empty`);
  if (v.length > max) problems.push(`${name} is ${max} characters at most`);
};
const only = (obj, keys, at, problems) => {
  const extra = Object.keys(obj).filter((k) => !keys.includes(k));
  if (extra.length) problems.push(`${at} cannot hold: ${extra.sort().join(', ')}`);
};
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Problems with an interview log, as sentences; empty when it is fine. */
export function checkInterview(log) {
  const problems = [];
  if (!isObject(log)) return ['interview must be an object'];
  only(log, ['notion_page', 'meeting_title', 'held_on', 'interviewee', 'question_source', 'items', 'outside_notes'], 'interview', problems);
  text(log.notion_page, LIMITS.source, 'notion_page', problems, { required: true });
  text(log.meeting_title, LIMITS.title, 'meeting_title', problems, { required: true });
  if (typeof log.held_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(log.held_on) || Number.isNaN(Date.parse(log.held_on))) problems.push('held_on must be a date (YYYY-MM-DD)');
  text(log.interviewee, LIMITS.person, 'interviewee', problems, { required: true });
  text(log.question_source, LIMITS.source, 'question_source', problems, { required: true });
  if (!Array.isArray(log.items) || !log.items.length) problems.push('items must list every question asked, in order');
  else {
    if (log.items.length > LIMITS.items) problems.push(`items has ${LIMITS.items} questions at most`);
    log.items.forEach((item, i) => {
      const at = `item ${i + 1}`;
      if (!isObject(item)) return problems.push(`${at} must be { ref, question, status, answer, quote, at }`);
      only(item, ['ref', 'question', 'status', 'answer', 'quote', 'at'], at, problems);
      text(item.ref, LIMITS.ref, `${at} ref`, problems);
      text(item.question, LIMITS.question, `${at} question`, problems, { required: true });
      if (!ANSWER_STATUSES.includes(item.status)) problems.push(`${at}: status must be one of ${ANSWER_STATUSES.join(', ')}`);
      text(item.answer, LIMITS.answer, `${at} answer`, problems, { required: item.status === 'answered' });
      text(item.quote, LIMITS.quote, `${at} quote`, problems, { required: item.status === 'answered' });
      text(item.at, LIMITS.at, `${at} at`, problems);
      if (item.status === 'not_answered' && item.answer) problems.push(`${at}: a not_answered question has no answer; use unclear if something was said`);
    });
  }
  if (log.outside_notes != null) {
    if (!Array.isArray(log.outside_notes)) problems.push('outside_notes must be a list');
    else {
      if (log.outside_notes.length > LIMITS.notes) problems.push(`outside_notes has ${LIMITS.notes} notes at most`);
      log.outside_notes.forEach((n, i) => {
        const at = `outside note ${i + 1}`;
        if (!isObject(n)) return problems.push(`${at} must be { note, quote, at }`);
        only(n, ['note', 'quote', 'at'], at, problems);
        text(n.note, LIMITS.note, `${at} note`, problems, { required: true });
        text(n.quote, LIMITS.quote, `${at} quote`, problems);
        text(n.at, LIMITS.at, `${at} at`, problems);
      });
    }
  }
  return problems;
}

/** Problems with a proposed record's values; empty when they are fine. */
export function checkValues(values) {
  if (!isObject(values) || !Object.keys(values).length) return ['values must be { "Column name": "text", ... }'];
  const problems = [];
  if (Object.keys(values).length > LIMITS.columns) problems.push(`values has ${LIMITS.columns} columns at most`);
  for (const [k, v] of Object.entries(values)) text(v, LIMITS.value, `values.${k}`, problems);
  return problems;
}

// ── tools ─────────────────────────────────────────────────────────────────────────────────────

const uuid = { type: 'string', format: 'uuid' };
const engagement = { type: 'string', description: 'The engagement key from list_engagements, for example "indago".' };
const WHO = {
  run_id: { ...uuid, description: 'Your GS Agentic Manager run id ($GSAM_RUN_ID). Recorded with every write.' },
  agent_id: { ...uuid, description: 'Your GS Agentic Manager agent id ($GSAM_AGENT_ID). Recorded with every write.' },
};
const REVISE = {
  draft_id: { ...uuid, description: 'Optional: change this open draft instead of making a new one.' },
  expected_version: { type: 'integer', minimum: 1, description: 'Needed with draft_id: the version you last read.' },
};
const quoteRule = 'quote: the speaker\'s exact words from the transcript, two sentences at most.';

export const TOOLS = [
  {
    name: 'list_engagements', title: 'List my engagements',
    description: 'The Deep Dive engagement this connection may act for. Any other engagement is out of reach.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false }, rpc: 'mcp_list_engagements',
  },
  {
    name: 'get_engagement', title: 'Read the engagement',
    description: 'The engagement\'s sheets (Evidence Register, Findings, Decisions, Work Breakdown and the rest) with their columns and row counts, and how many agent drafts wait for review.',
    inputSchema: { type: 'object', required: ['engagement'], properties: { engagement }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false }, rpc: 'mcp_get_engagement',
  },
  {
    name: 'list_records', title: 'Read a sheet',
    description: 'Rows of one sheet as the portal shows them (editors\' changes applied), keyed by column name. Up to 500 per call; page with offset.',
    inputSchema: { type: 'object', required: ['engagement', 'sheet_id'], properties: { engagement, sheet_id: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 500 }, offset: { type: 'integer', minimum: 0 } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false }, rpc: 'mcp_list_records',
  },
  {
    name: 'list_interview_questions', title: 'Read the interview questions',
    description: 'The questions held in the portal (NS-01 North Star interview), each with a ref to use in log_interview. For an interview with questions from another document, use that document\'s wording and leave ref empty.',
    inputSchema: { type: 'object', required: ['engagement'], properties: { engagement }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false }, rpc: 'mcp_interview_questions',
  },
  {
    name: 'list_drafts', title: 'List agent drafts',
    description: 'Every agent draft in this engagement with its status (draft, approved, rejected) and version.',
    inputSchema: { type: 'object', required: ['engagement'], properties: { engagement }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false }, rpc: 'mcp_list_drafts',
  },
  {
    name: 'get_draft', title: 'Read an agent draft',
    description: 'One draft in full, with the reviewer\'s note once it is decided.',
    inputSchema: { type: 'object', required: ['engagement', 'draft_id'], properties: { engagement, draft_id: uuid }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false }, rpc: 'mcp_get_draft',
  },
  {
    name: 'log_interview', title: 'Log an interview as a draft',
    description: `Saves one interview as a DRAFT for John or Ben to approve. Run it only when someone asked you to log that interview. List every question asked, in order: status answered (with answer and quote), unclear (something was said but it did not answer) or not_answered (skipped). Never guess. ${quoteRule} Talk that answers no question goes in outside_notes; it becomes Evidence Register notes after approval.`,
    inputSchema: {
      type: 'object', required: ['engagement', 'run_id', 'agent_id', 'interview'],
      properties: {
        engagement, ...WHO, ...REVISE,
        interview: {
          type: 'object', required: ['notion_page', 'meeting_title', 'held_on', 'interviewee', 'question_source', 'items'],
          properties: {
            notion_page: { type: 'string', description: 'Link or id of the Notion meeting note you read.' },
            meeting_title: { type: 'string' },
            held_on: { type: 'string', description: 'YYYY-MM-DD' },
            interviewee: { type: 'string', description: 'Name and role as written in Notion. No contact details.' },
            question_source: { type: 'string', description: 'Where the questions came from: NS-01 or the document John or Ben named.' },
            items: { type: 'array', items: { type: 'object', required: ['question', 'status'], properties: {
              ref: { type: 'string' }, question: { type: 'string' }, status: { type: 'string', enum: ANSWER_STATUSES },
              answer: { type: 'string', description: 'Short, in the speaker\'s own terms.' }, quote: { type: 'string' },
              at: { type: 'string', description: 'Time in the recording, for example 00:14:05.' } }, additionalProperties: false } },
            outside_notes: { type: 'array', items: { type: 'object', required: ['note'], properties: {
              note: { type: 'string' }, quote: { type: 'string' }, at: { type: 'string' } }, additionalProperties: false } },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, rpc: 'mcp_save_draft',
  },
  {
    name: 'propose_record', title: 'Propose a new row as a draft',
    description: 'Proposes a new row for a sheet (for example a finding, a decision or an Evidence Register entry) as a DRAFT. It is added to the sheet only when a facilitator approves it. values uses the column names from get_engagement.',
    inputSchema: {
      type: 'object', required: ['engagement', 'run_id', 'agent_id', 'sheet_id', 'title', 'values'],
      properties: { engagement, ...WHO, ...REVISE, sheet_id: { type: 'string' }, title: { type: 'string', description: 'One line for the reviewer.' },
        values: { type: 'object', additionalProperties: { type: 'string' } } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, rpc: 'mcp_save_draft',
  },
];
export const publicTools = () => TOOLS.map(({ rpc, ...t }) => t);

// ── errors ────────────────────────────────────────────────────────────────────────────────────

// Database errors whose message is ours (0010) and safe to pass on; anything else gets a general line.
const PASS_CODES = new Set(['P0002', '42501', '23514', '40001', '23505', '23502', '22P02', '22023']);
export const GENERAL_ERROR = 'The Deep Dive portal could not do this just now. Try again; if it keeps failing, say so on your task.';
export const TOKEN_ERROR = 'invalid or revoked token';

class ToolError extends Error {}
const fail = (msg) => { throw new ToolError(msg); };
const needUuid = (args, keys) => { for (const k of keys) if (!isUuid(args[k])) fail(`${k} must be a uuid`); };
const needText = (v, name, max = 120) => { if (typeof v !== 'string' || !v.trim() || v.length > max) fail(`${name} must be 1 to ${max} characters`); };

// ── the server ────────────────────────────────────────────────────────────────────────────────

/** deps.rpc(fn, params) → { data, error }; deps.log optional. */
export function createDeepDiveMcp(deps) {
  const log = deps.log || (() => {});
  const byName = new Map(TOOLS.map((t) => [t.name, t]));

  async function db(fn, params) {
    const { data, error } = await deps.rpc(fn, params);
    if (error) {
      if (error.code === '42501' && /invalid or revoked token/.test(error.message || '')) throw Object.assign(new Error(TOKEN_ERROR), { unauthorised: true });
      if (!PASS_CODES.has(error.code)) { log('deep-dive-mcp: database error', fn, error.code); fail(GENERAL_ERROR); }
      fail(String(error.message || GENERAL_ERROR).slice(0, 300));
    }
    return data;
  }

  async function callTool(tokenSha, name, args) {
    const tool = byName.get(name);
    if (!tool) fail(`unknown tool: ${name}`);
    if (!isObject(args)) fail('arguments must be an object');
    const extra = Object.keys(args).filter((k) => !(k in tool.inputSchema.properties));
    if (extra.length) fail(`unknown arguments: ${extra.join(', ')}`);
    const t = { p_token_sha256: tokenSha };
    if (name === 'list_engagements') return db(tool.rpc, t);
    needText(args.engagement, 'engagement', 40);
    const e = { ...t, p_engagement: args.engagement };
    const problems = (list) => { if (list.length) fail(`Fix these and try again:\n- ${list.join('\n- ')}`); };
    const save = (kind, title, payload) => {
      needUuid(args, ['run_id', 'agent_id']);
      if (args.draft_id != null) {
        needUuid(args, ['draft_id']);
        if (!Number.isInteger(args.expected_version) || args.expected_version < 1) fail('expected_version must be the version you last read');
      } else if (args.expected_version != null) fail('expected_version goes with draft_id');
      return db('mcp_save_draft', { ...e, p_run_id: args.run_id, p_agent_id: args.agent_id, p_draft_id: args.draft_id ?? null,
        p_expected_version: args.expected_version ?? null, p_kind: kind, p_title: title, p_payload: payload });
    };

    switch (name) {
      case 'get_engagement':
      case 'list_interview_questions':
      case 'list_drafts':
        return db(tool.rpc, e);
      case 'list_records':
        needText(args.sheet_id, 'sheet_id', 200);
        return db(tool.rpc, { ...e, p_sheet_id: args.sheet_id, p_limit: args.limit ?? 100, p_offset: args.offset ?? 0 });
      case 'get_draft':
        needUuid(args, ['draft_id']);
        return db(tool.rpc, { ...e, p_draft_id: args.draft_id });
      case 'log_interview': {
        problems(checkInterview(args.interview));
        const i = args.interview;
        const saved = await save('interview_log', `${i.meeting_title} (${i.held_on})`.slice(0, LIMITS.title), i);
        const counts = Object.fromEntries(ANSWER_STATUSES.map((s) => [s, i.items.filter((x) => x.status === s).length]));
        return { ...saved, counts, outside_notes: i.outside_notes?.length || 0,
          next_step: 'Saved as a DRAFT. Nothing is final until John or Ben approves it in the portal. Put the draft id and the counts on your task.' };
      }
      case 'propose_record': {
        needText(args.sheet_id, 'sheet_id', 200);
        needText(args.title, 'title', LIMITS.title);
        problems(checkValues(args.values));
        const saved = await save('record', args.title, { sheet_id: args.sheet_id, values: args.values });
        return { ...saved, next_step: 'Saved as a DRAFT. The row is added to the sheet only when a facilitator approves it.' };
      }
      default:
        return fail(`unknown tool: ${name}`);
    }
  }

  const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
  const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  const reply = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json', ...headers }, body: body == null ? null : JSON.stringify(body) });
  const unauthorised = (id) => reply(401, rpcError(id, -32001, 'A valid Deep Dive token is needed (Authorization: Bearer gsdd_...).'), { 'www-authenticate': 'Bearer realm="greatstone-deep-dive"' });

  /** One HTTP request: { method, headers: { get(name) }, text } → { status, headers, body }. */
  async function handle({ method, headers, text: body }) {
    if (method !== 'POST') return reply(405, rpcError(null, -32000, 'POST JSON-RPC to this endpoint.'), { allow: 'POST' });
    const token = (headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!TOKEN_RE.test(token)) return unauthorised(null);
    if ((body || '').length > MAX_BODY_BYTES) return reply(413, rpcError(null, -32600, 'The request is too large.'));
    let msg;
    try { msg = JSON.parse(body); } catch { return reply(400, rpcError(null, -32700, 'Parse error')); }
    if (!isObject(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return reply(400, rpcError(msg?.id, -32600, 'Invalid request (one JSON-RPC 2.0 message per POST).'));
    }
    const { id, method: m, params } = msg;
    if (id === undefined) return reply(202, null);
    const tokenSha = await sha256Hex(token);

    switch (m) {
      case 'initialize': {
        try { await db('mcp_list_engagements', { p_token_sha256: tokenSha }); } catch (e) {
          if (e?.unauthorised) return unauthorised(id);
          return reply(200, rpcError(id, -32603, GENERAL_ERROR));
        }
        const asked = params?.protocolVersion;
        return reply(200, rpcResult(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: 'Greatstone Deep Dive portal. Read the engagement freely; every write is a DRAFT that John or Ben approves in the portal. Log an interview only when someone asks you to. Pass run_id and agent_id on every write. Call list_engagements first.',
        }));
      }
      case 'ping':
        return reply(200, rpcResult(id, {}));
      case 'tools/list':
        return reply(200, rpcResult(id, { tools: publicTools() }));
      case 'tools/call': {
        try {
          const data = await callTool(tokenSha, params?.name, params?.arguments ?? {});
          const structured = Array.isArray(data) ? { items: data } : data;
          return reply(200, rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: structured }));
        } catch (e) {
          if (e?.unauthorised) return unauthorised(id);
          if (e instanceof ToolError) return reply(200, rpcResult(id, { content: [{ type: 'text', text: e.message }], isError: true }));
          log('deep-dive-mcp: unexpected', String(e?.name || e));
          return reply(200, rpcResult(id, { content: [{ type: 'text', text: GENERAL_ERROR }], isError: true }));
        }
      }
      default:
        return reply(200, rpcError(id, -32601, `Method not found: ${m}`));
    }
  }

  return { handle, callTool };
}
