// Every MCP call runs in its own transaction as indago_mcp, which may only EXECUTE the indago.mcp_*
// functions. Those SECURITY DEFINER functions check the token hash and its engagement.
const SIGNATURES = Object.freeze({
  mcp_list_engagements: ['p_token_sha256:text'],
  mcp_get_engagement: ['p_token_sha256:text', 'p_engagement:text'],
  mcp_list_records: ['p_token_sha256:text', 'p_engagement:text', 'p_sheet_id:text', 'p_limit:integer', 'p_offset:integer'],
  mcp_interview_questions: ['p_token_sha256:text', 'p_engagement:text'],
  mcp_list_drafts: ['p_token_sha256:text', 'p_engagement:text'],
  mcp_get_draft: ['p_token_sha256:text', 'p_engagement:text', 'p_draft_id:uuid'],
  mcp_save_draft: ['p_token_sha256:text', 'p_engagement:text', 'p_run_id:uuid', 'p_agent_id:uuid', 'p_draft_id:uuid',
    'p_expected_version:integer', 'p_kind:text', 'p_title:text', 'p_payload:jsonb'],
});

export async function deepDiveMcpRpc(pool, name, params) {
  const signature = SIGNATURES[name];
  if (!signature || !params || Object.keys(params).length !== signature.length ||
      signature.some((part) => !Object.hasOwn(params, part.split(':')[0]))) {
    throw new RangeError('Invalid MCP call');
  }
  const values = signature.map((part) => {
    const [key, type] = part.split(':');
    return type === 'jsonb' ? JSON.stringify(params[key]) : params[key];
  });
  const args = signature.map((part, i) => `${part.split(':')[0]} => $${i + 1}::${part.split(':')[1]}`).join(', ');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE indago_mcp');
    const { rows } = await client.query(`SELECT indago.${name}(${args}) AS data`, values);
    await client.query('COMMIT');
    return { data: rows[0]?.data ?? null, error: null };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* disconnected */ }
    return { data: null, error: { code: error.code, message: error.message } };
  } finally {
    client.release();
  }
}
