# Deep Dive MCP

Agents read the Deep Dive record and write **drafts** through an MCP server at `/api/deep-dive-mcp` (GRE-4341). A named facilitator approves or rejects each draft in the portal. No tool can approve, publish or delete.

## Tools

| Tool | What it does |
| --- | --- |
| `list_engagements` | The engagement this token may act for. |
| `get_engagement` | Sheets (Evidence Register, Findings, Decisions, Work Breakdown and the rest), columns, row counts, drafts waiting. |
| `list_records` | Rows of one sheet as the portal shows them, keyed by column name. |
| `list_interview_questions` | The NS-01 interview questions held in the portal, with refs. |
| `list_drafts`, `get_draft` | Agent drafts and their review state. |
| `log_interview` | One interview as a draft: every question with `answered`, `unclear` or `not_answered`, a short verbatim quote, and talk outside the questions as notes. |
| `propose_record` | A new row for a sheet as a draft; added to the sheet only on approval. |

## Access

- One token per agent, scoped to one engagement. The database checks the token hash and the engagement on every call (`indago.mcp_caller`). A token for another engagement, a revoked token or an unknown token is refused.
- The function runs as `indago_mcp`, which can execute the `indago.mcp_*` functions and read no table.
- Every write is recorded in `indago.mcp_audit` with the token, GSAM run id and agent id.
- Drafts are visible only to facilitators (`indago.members.facilitator = true`), never to clients or in open access.

## Issue a token (John)

1. On your own machine: `node scripts/make-mcp-token.mjs "Deep Dive agent"`.
2. Keep the token in your password manager. Run the printed SQL (hash only) through the approved database operation.
3. In GSAM, Apps, add a custom MCP server: URL `https://<portal host>/api/deep-dive-mcp`, header `Authorization: Bearer <token>`. Assign it to the Deep Dive agents.
4. To stop a token: `SELECT indago.mcp_revoke_token('<token id>');`.

## Logging an interview from Notion

Run only when John or Ben asks on a task ("log interview X"); never on every Notion recording.

1. Read the Notion meeting note and transcript for X, and nothing else.
2. `list_interview_questions` (or the question document John or Ben named).
3. For each question asked, in order: `answered` with a short answer and a verbatim quote (two sentences at most), `unclear` if something was said that did not answer it, `not_answered` if it was skipped. Never guess.
4. Talk that answers no question goes in `outside_notes`.
5. `log_interview`, then put the draft id and the counts on the task.

If the MCP is not live, follow the fallback on GRE-4341: a draft answer sheet on the task, loaded with `log_interview` later.

## Review (facilitator)

`GET /api/indago/agent-drafts`, `GET /api/indago/agent-drafts/<id>`, and `POST /api/indago/agent-drafts/<id>/decision` with `{ "decision": "approve" | "reject", "version": <n>, "note": "..." }`. Approving a proposed row inserts it into its sheet as the facilitator, with the normal record history.

## Rollback

Export `indago.mcp_drafts` and `indago.mcp_audit`, then run `netlify/database/migrations/0010_deep_dive_mcp/rollback.sql`. Approved rows already in sheets stay.
