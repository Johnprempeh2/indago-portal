-- Deep Dive MCP (GRE-4341). Agents read the Deep Dive record and write DRAFTS only.
-- The MCP function runs as indago_mcp, which may call the mcp_* functions below and nothing else.
-- Each function checks the caller's token hash and its engagement before it reads or writes.
-- A facilitator approves or rejects a draft through the portal; an agent never can.
DO $$ BEGIN CREATE ROLE indago_mcp NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT indago_mcp TO CURRENT_USER;
GRANT USAGE ON SCHEMA indago TO indago_mcp;

-- This database holds one engagement. When the schema moves to the website hub, rows gain an
-- engagement column and the check in mcp_caller compares against it instead.
CREATE FUNCTION indago.engagement_key() RETURNS text LANGUAGE sql IMMUTABLE
  SET search_path = '' AS $$ SELECT 'indago'::text $$;

CREATE TABLE indago.mcp_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 120),
  engagement text NOT NULL CHECK (engagement ~ '^[a-z0-9-]{1,40}$'),
  token_sha256 text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
ALTER TABLE indago.mcp_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE indago.mcp_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('interview_log', 'record')),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND length(payload::text) <= 200000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected')),
  version integer NOT NULL DEFAULT 1,
  token_id uuid NOT NULL REFERENCES indago.mcp_tokens(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text NOT NULL DEFAULT '' CHECK (length(review_note) <= 2000),
  record_id text REFERENCES indago.records(id) ON DELETE RESTRICT
);
CREATE INDEX mcp_drafts_engagement ON indago.mcp_drafts(engagement, updated_at DESC);
ALTER TABLE indago.mcp_drafts ENABLE ROW LEVEL SECURITY;
-- Facilitators review drafts in the portal; nobody else sees them.
CREATE POLICY facilitator_reads_drafts ON indago.mcp_drafts FOR SELECT TO indago_app
  USING (indago.is_facilitator() AND engagement = indago.engagement_key());
CREATE POLICY facilitator_decides_drafts ON indago.mcp_drafts FOR UPDATE TO indago_app
  USING (indago.is_facilitator() AND status = 'draft' AND engagement = indago.engagement_key())
  WITH CHECK (indago.is_facilitator() AND status IN ('approved', 'rejected'));
GRANT SELECT, UPDATE(status, reviewed_by, reviewed_at, review_note, record_id) ON indago.mcp_drafts TO indago_app;

CREATE TABLE indago.mcp_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_id uuid NOT NULL REFERENCES indago.mcp_tokens(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  action text NOT NULL,
  draft_id uuid,
  at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE indago.mcp_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY facilitator_reads_mcp_audit ON indago.mcp_audit FOR SELECT TO indago_app
  USING (indago.is_facilitator());
GRANT SELECT ON indago.mcp_audit TO indago_app;

-- Owner only: register a token made outside the database (its hash only) or stop one.
CREATE FUNCTION indago.mcp_register_token(p_label text, p_engagement text, p_token_sha256 text)
  RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO indago.mcp_tokens(label, engagement, token_sha256)
    VALUES (p_label, p_engagement, p_token_sha256) RETURNING id
$$;
CREATE FUNCTION indago.mcp_revoke_token(p_token_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER
  SET search_path = '' AS $$
  UPDATE indago.mcp_tokens SET revoked_at = now() WHERE id = p_token_id AND revoked_at IS NULL RETURNING true
$$;
REVOKE ALL ON FUNCTION indago.mcp_register_token(text, text, text), indago.mcp_revoke_token(uuid)
  FROM PUBLIC, indago_app, indago_mcp;

-- The one gate every tool passes: a live token, for this engagement, asking about this engagement.
CREATE FUNCTION indago.mcp_caller(p_token_sha256 text, p_engagement text) RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t indago.mcp_tokens;
BEGIN
  SELECT * INTO t FROM indago.mcp_tokens WHERE token_sha256 = p_token_sha256 AND revoked_at IS NULL;
  IF t.id IS NULL THEN RAISE EXCEPTION 'invalid or revoked token' USING errcode = '42501'; END IF;
  IF p_engagement IS DISTINCT FROM t.engagement OR t.engagement <> indago.engagement_key() THEN
    RAISE EXCEPTION 'this token is not for engagement %', coalesce(p_engagement, '(none)') USING errcode = '42501';
  END IF;
  RETURN t.id;
END $$;

CREATE FUNCTION indago.mcp_list_engagements(p_token_sha256 text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t indago.mcp_tokens;
BEGIN
  SELECT * INTO t FROM indago.mcp_tokens WHERE token_sha256 = p_token_sha256 AND revoked_at IS NULL;
  IF t.id IS NULL THEN RAISE EXCEPTION 'invalid or revoked token' USING errcode = '42501'; END IF;
  RETURN CASE WHEN t.engagement = indago.engagement_key()
    THEN jsonb_build_array(jsonb_build_object('engagement', t.engagement, 'token_label', t.label))
    ELSE '[]'::jsonb END;
END $$;

CREATE FUNCTION indago.mcp_get_engagement(p_token_sha256 text, p_engagement text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM indago.mcp_caller(p_token_sha256, p_engagement);
  RETURN jsonb_build_object(
    'engagement', p_engagement,
    'sheets', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'title', trim(s.title),
      'columns', s.columns, 'locked_columns', s.locked_columns,
      'rows', (SELECT count(*) FROM indago.records r WHERE r.sheet_id = s.id)) ORDER BY s.position)
      FROM indago.sheets s), '[]'::jsonb),
    'drafts', (SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM indago.mcp_drafts
      WHERE engagement = p_engagement GROUP BY status) d));
END $$;

-- Records as the portal shows them: source values with editors' edits on top, keyed by column.
CREATE FUNCTION indago.mcp_list_records(p_token_sha256 text, p_engagement text, p_sheet_id text,
  p_limit integer, p_offset integer) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cols jsonb;
BEGIN
  PERFORM indago.mcp_caller(p_token_sha256, p_engagement);
  SELECT columns INTO cols FROM indago.sheets WHERE id = p_sheet_id;
  IF cols IS NULL THEN RAISE EXCEPTION 'no sheet %', p_sheet_id USING errcode = 'P0002'; END IF;
  RETURN jsonb_build_object('sheet_id', p_sheet_id, 'columns', cols,
    'total', (SELECT count(*) FROM indago.records WHERE sheet_id = p_sheet_id),
    'records', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'position', r.position, 'version', r.version,
      'changed_at', r.changed_at, 'values', (SELECT jsonb_object_agg(c.name,
        coalesce(r.edits ->> (c.i - 1)::text, r.source_values ->> (c.i - 1)::int))
        FROM jsonb_array_elements_text(cols) WITH ORDINALITY AS c(name, i))) ORDER BY r.position)
      FROM (SELECT * FROM indago.records WHERE sheet_id = p_sheet_id ORDER BY position
        LIMIT least(greatest(coalesce(p_limit, 100), 1), 500) OFFSET greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb));
END $$;

CREATE FUNCTION indago.mcp_interview_questions(p_token_sha256 text, p_engagement text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM indago.mcp_caller(p_token_sha256, p_engagement);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('instrument', t.id, 'section', sec.value ->> 'heading',
      'ref', t.id || '.' || (sec.i - 1) || '.' || (item.j - 1), 'question', item.q) ORDER BY sec.i, item.j)
    FROM indago.north_star_template t,
      jsonb_array_elements(t.content -> 'questions') WITH ORDINALITY AS sec(value, i),
      jsonb_array_elements_text(sec.value -> 'items') WITH ORDINALITY AS item(q, j)), '[]'::jsonb);
END $$;

CREATE FUNCTION indago.mcp_list_drafts(p_token_sha256 text, p_engagement text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM indago.mcp_caller(p_token_sha256, p_engagement);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'title', d.title,
      'status', d.status, 'version', d.version, 'updated_at', d.updated_at, 'review_note', d.review_note)
      ORDER BY d.updated_at DESC)
    FROM indago.mcp_drafts d WHERE d.engagement = p_engagement), '[]'::jsonb);
END $$;

CREATE FUNCTION indago.mcp_get_draft(p_token_sha256 text, p_engagement text, p_draft_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d indago.mcp_drafts;
BEGIN
  PERFORM indago.mcp_caller(p_token_sha256, p_engagement);
  SELECT * INTO d FROM indago.mcp_drafts WHERE id = p_draft_id AND engagement = p_engagement;
  IF d.id IS NULL THEN RAISE EXCEPTION 'no draft % in this engagement', p_draft_id USING errcode = 'P0002'; END IF;
  RETURN jsonb_build_object('id', d.id, 'kind', d.kind, 'title', d.title, 'status', d.status, 'version', d.version,
    'payload', d.payload, 'created_at', d.created_at, 'updated_at', d.updated_at,
    'reviewed_at', d.reviewed_at, 'review_note', d.review_note, 'record_id', d.record_id);
END $$;

CREATE FUNCTION indago.mcp_save_draft(p_token_sha256 text, p_engagement text, p_run_id uuid, p_agent_id uuid,
  p_draft_id uuid, p_expected_version integer, p_kind text, p_title text, p_payload jsonb) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE token uuid; d indago.mcp_drafts;
BEGIN
  token := indago.mcp_caller(p_token_sha256, p_engagement);
  IF p_kind = 'record' AND NOT EXISTS (SELECT 1 FROM indago.sheets WHERE id = p_payload ->> 'sheet_id') THEN
    RAISE EXCEPTION 'no sheet %', p_payload ->> 'sheet_id' USING errcode = 'P0002';
  END IF;
  IF p_draft_id IS NULL THEN
    INSERT INTO indago.mcp_drafts(engagement, kind, title, payload, token_id, run_id, agent_id)
      VALUES (p_engagement, p_kind, p_title, p_payload, token, p_run_id, p_agent_id) RETURNING * INTO d;
  ELSE
    UPDATE indago.mcp_drafts SET title = p_title, payload = p_payload, version = version + 1,
        token_id = token, run_id = p_run_id, agent_id = p_agent_id, updated_at = now()
      WHERE id = p_draft_id AND engagement = p_engagement AND kind = p_kind
        AND status = 'draft' AND version = p_expected_version RETURNING * INTO d;
    IF d.id IS NULL THEN
      RAISE EXCEPTION 'draft % is not an open % draft at version % in this engagement; read it again',
        p_draft_id, p_kind, p_expected_version USING errcode = '40001';
    END IF;
  END IF;
  INSERT INTO indago.mcp_audit(token_id, run_id, agent_id, action, draft_id)
    VALUES (token, p_run_id, p_agent_id, CASE WHEN p_draft_id IS NULL THEN 'create ' ELSE 'update ' END || p_kind, d.id);
  RETURN jsonb_build_object('id', d.id, 'kind', d.kind, 'status', d.status, 'version', d.version);
END $$;

REVOKE ALL ON FUNCTION indago.mcp_caller(text, text), indago.mcp_list_engagements(text),
  indago.mcp_get_engagement(text, text), indago.mcp_list_records(text, text, text, integer, integer),
  indago.mcp_interview_questions(text, text), indago.mcp_list_drafts(text, text),
  indago.mcp_get_draft(text, text, uuid),
  indago.mcp_save_draft(text, text, uuid, uuid, uuid, integer, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION indago.mcp_list_engagements(text),
  indago.mcp_get_engagement(text, text), indago.mcp_list_records(text, text, text, integer, integer),
  indago.mcp_interview_questions(text, text), indago.mcp_list_drafts(text, text),
  indago.mcp_get_draft(text, text, uuid),
  indago.mcp_save_draft(text, text, uuid, uuid, uuid, integer, text, text, jsonb) TO indago_mcp;
