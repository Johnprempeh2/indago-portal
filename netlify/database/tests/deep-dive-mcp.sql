-- Run only against a local database after every migration. Invented data; rolls back.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO indago.members(email, user_id, role, facilitator) VALUES
  ('mcp-facilitator@example.test', 'mcp-facilitator', 'editor', true),
  ('mcp-editor@example.test', 'mcp-editor', 'editor', false);
INSERT INTO indago.sheets(id, title, source_name, columns, locked_columns, position)
  SELECT 'mcp-evidence', 'New Deep Dive Evidence', 'test', '["ID","Evidence","Source"]', '[0]',
    coalesce(max(position), 0) + 1 FROM indago.sheets;
INSERT INTO indago.records(id, sheet_id, position, source_values, edits)
  VALUES ('mcp-ev-1', 'mcp-evidence', 1, '["EV-1","Original text","Workshop"]', '{"1":"Edited text"}');

-- Token A belongs to this engagement; token B to another engagement; token C is revoked.
SELECT indago.mcp_register_token('agent A', 'indago', repeat('a', 64)) AS token_a \gset
SELECT indago.mcp_register_token('agent B', 'other-client', repeat('b', 64)) AS token_b \gset
SELECT indago.mcp_revoke_token(indago.mcp_register_token('agent C', 'indago', repeat('c', 64)));
-- A draft that belongs to another engagement, as if the schema already held two.
INSERT INTO indago.mcp_drafts(engagement, kind, title, payload, token_id, run_id, agent_id)
  VALUES ('other-client', 'interview_log', 'Other client interview', '{"items":[]}', :'token_b',
    gen_random_uuid(), gen_random_uuid());
SELECT set_config('test.other_draft', id::text, true) FROM indago.mcp_drafts WHERE engagement = 'other-client';

SET LOCAL ROLE indago_mcp;
DO $$
DECLARE draft jsonb; got jsonb;
BEGIN
  -- the MCP role reaches no table directly
  BEGIN PERFORM 1 FROM indago.records; RAISE EXCEPTION 'mcp role read records';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM indago.mcp_drafts; RAISE EXCEPTION 'mcp role read drafts';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM indago.mcp_register_token('x', 'indago', repeat('d', 64)); RAISE EXCEPTION 'mcp role registered a token';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM indago.mcp_caller(repeat('a', 64), 'indago'); RAISE EXCEPTION 'mcp role called the gate directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- token A reads its own engagement, with edits on top of source values
  got := indago.mcp_list_records(repeat('a', 64), 'indago', 'mcp-evidence', 10, 0);
  IF got #>> '{records,0,values,Evidence}' <> 'Edited text' THEN RAISE EXCEPTION 'edits not applied: %', got; END IF;
  IF got #>> '{records,0,values,Source}' <> 'Workshop' THEN RAISE EXCEPTION 'source value missing'; END IF;
  IF jsonb_array_length(indago.mcp_interview_questions(repeat('a', 64), 'indago')) <> 26 THEN
    RAISE EXCEPTION 'NS-01 questions missing';
  END IF;
  IF jsonb_array_length(indago.mcp_list_engagements(repeat('a', 64))) <> 1 THEN RAISE EXCEPTION 'A lost its engagement'; END IF;

  -- one engagement cannot read another
  BEGIN PERFORM indago.mcp_list_records(repeat('a', 64), 'other-client', 'mcp-evidence', 10, 0);
    RAISE EXCEPTION 'A read another engagement';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM indago.mcp_list_records(repeat('b', 64), 'indago', 'mcp-evidence', 10, 0);
    RAISE EXCEPTION 'B read this engagement';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM indago.mcp_list_drafts(repeat('b', 64), 'other-client');
    RAISE EXCEPTION 'B used a database that does not hold its engagement';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF jsonb_array_length(indago.mcp_list_engagements(repeat('b', 64))) <> 0 THEN RAISE EXCEPTION 'B sees an engagement'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(indago.mcp_list_drafts(repeat('a', 64), 'indago')) d
      WHERE d ->> 'title' = 'Other client interview') THEN RAISE EXCEPTION 'A listed another engagement draft'; END IF;
  BEGIN PERFORM indago.mcp_get_draft(repeat('a', 64), 'indago',
      current_setting('test.other_draft')::uuid); RAISE EXCEPTION 'A read another engagement draft';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN PERFORM indago.mcp_list_drafts(repeat('c', 64), 'indago'); RAISE EXCEPTION 'revoked token worked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM indago.mcp_list_drafts(repeat('e', 64), 'indago'); RAISE EXCEPTION 'unknown token worked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- drafts: create, update at the right version only, never into another engagement
  draft := indago.mcp_save_draft(repeat('a', 64), 'indago', gen_random_uuid(), gen_random_uuid(), NULL, NULL,
    'record', 'Evidence note', '{"sheet_id":"mcp-evidence","values":{"ID":"EV-2","Evidence":"Said outside the questions","Source":"Interview"}}');
  IF draft ->> 'status' <> 'draft' THEN RAISE EXCEPTION 'not saved as draft'; END IF;
  PERFORM indago.mcp_save_draft(repeat('a', 64), 'indago', gen_random_uuid(), gen_random_uuid(), (draft ->> 'id')::uuid, 1,
    'record', 'Evidence note v2', '{"sheet_id":"mcp-evidence","values":{"ID":"EV-2","Evidence":"Said outside","Source":"Interview"}}');
  BEGIN PERFORM indago.mcp_save_draft(repeat('a', 64), 'indago', gen_random_uuid(), gen_random_uuid(), (draft ->> 'id')::uuid, 1,
      'record', 'stale', '{"sheet_id":"mcp-evidence","values":{}}'); RAISE EXCEPTION 'stale update accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN PERFORM indago.mcp_save_draft(repeat('a', 64), 'indago', gen_random_uuid(), gen_random_uuid(),
      current_setting('test.other_draft')::uuid, 1,
      'interview_log', 'hijack', '{"items":[]}'); RAISE EXCEPTION 'A changed another engagement draft';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN PERFORM indago.mcp_save_draft(repeat('a', 64), 'indago', gen_random_uuid(), gen_random_uuid(), NULL, NULL,
      'record', 'x', '{"sheet_id":"nope","values":{}}'); RAISE EXCEPTION 'unknown sheet accepted';
  EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.mcp_audit) <> 2 THEN RAISE EXCEPTION 'writes not audited'; END IF;
  IF (SELECT count(*) FROM indago.records WHERE sheet_id = 'mcp-evidence') <> 1 THEN RAISE EXCEPTION 'draft reached the record'; END IF;
END $$;

-- Only a facilitator sees and decides drafts, and only drafts of this engagement.
SET LOCAL ROLE indago_app;
SELECT set_config('indago.user_id', 'mcp-editor', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.mcp_drafts) <> 0 THEN RAISE EXCEPTION 'non-facilitator saw drafts'; END IF;
END $$;
SELECT set_config('indago.user_id', 'mcp-facilitator', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.mcp_drafts) <> 1 THEN RAISE EXCEPTION 'facilitator should see one draft of this engagement'; END IF;
  UPDATE indago.mcp_drafts SET status = 'approved', reviewed_by = 'mcp-facilitator', reviewed_at = now();
  BEGIN UPDATE indago.mcp_drafts SET status = 'draft';
    IF FOUND THEN RAISE EXCEPTION 'decided draft reopened'; END IF;
  END;
  BEGIN UPDATE indago.mcp_drafts SET payload = '{}'; RAISE EXCEPTION 'facilitator rewrote agent payload';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('indago.open_access', 'on', true);
SELECT set_config('indago.user_id', 'open-access', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.mcp_drafts) <> 0 THEN RAISE EXCEPTION 'open access saw drafts'; END IF;
END $$;
ROLLBACK;
