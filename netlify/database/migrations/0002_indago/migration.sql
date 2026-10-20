-- Indago owns this schema. Netlify Database applies this migration on deploy.
CREATE SCHEMA indago;
DO $$ BEGIN CREATE ROLE indago_app NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT indago_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA indago TO indago_app;

CREATE TABLE indago.members (
  email text PRIMARY KEY CHECK (email = lower(email)),
  user_id text UNIQUE,
  role text NOT NULL CHECK (role IN ('editor', 'viewer')),
  invited_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE indago.members ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_reads_self ON indago.members FOR SELECT TO indago_app
  USING (user_id = nullif(current_setting('indago.user_id', true), ''));
GRANT SELECT ON indago.members TO indago_app;

CREATE FUNCTION indago.is_member() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM indago.members
    WHERE user_id = nullif(current_setting('indago.user_id', true), ''))
$$;
CREATE FUNCTION indago.can_edit() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM indago.members
    WHERE user_id = nullif(current_setting('indago.user_id', true), '') AND role = 'editor')
$$;
REVOKE ALL ON FUNCTION indago.is_member(), indago.can_edit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION indago.is_member(), indago.can_edit() TO indago_app;

CREATE TABLE indago.sheets (
  id text PRIMARY KEY,
  title text NOT NULL UNIQUE,
  source_name text NOT NULL,
  columns jsonb NOT NULL CHECK (jsonb_typeof(columns) = 'array'),
  locked_columns jsonb NOT NULL CHECK (
    jsonb_typeof(locked_columns) = 'array' AND
    NOT jsonb_path_exists(locked_columns, '$[*] ? (@.type() != "number" || @ != @.floor())')
  ),
  position integer NOT NULL UNIQUE
);
ALTER TABLE indago.sheets ENABLE ROW LEVEL SECURITY;
CREATE POLICY invited_reads_sheets ON indago.sheets FOR SELECT TO indago_app USING (indago.is_member());
GRANT SELECT ON indago.sheets TO indago_app;

CREATE TABLE indago.records (
  id text PRIMARY KEY,
  sheet_id text NOT NULL REFERENCES indago.sheets(id) ON DELETE RESTRICT,
  position integer NOT NULL,
  source_values jsonb NOT NULL CHECK (jsonb_typeof(source_values) = 'array'),
  edits jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(edits) = 'object'),
  changed_by text,
  changed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (sheet_id, position)
);
CREATE INDEX records_sheet_position ON indago.records(sheet_id, position);
ALTER TABLE indago.records ENABLE ROW LEVEL SECURITY;
CREATE POLICY invited_reads_records ON indago.records FOR SELECT TO indago_app USING (indago.is_member());
CREATE POLICY editors_update_records ON indago.records FOR UPDATE TO indago_app
  USING (indago.can_edit()) WITH CHECK (indago.can_edit());
CREATE POLICY editors_insert_project_rows ON indago.records FOR INSERT TO indago_app
  WITH CHECK (indago.can_edit() AND sheet_id IN (
    SELECT id FROM indago.sheets WHERE title IN
    ('Risks & Issues', 'New Deep Dive Evidence', 'Service Processes', 'Commercial Baseline',
     'Findings', 'Opportunities', 'Decisions', 'GDXP Traceability', 'Validation Log')
  ));
GRANT SELECT, UPDATE(edits), INSERT(id, sheet_id, position, source_values) ON indago.records TO indago_app;

CREATE TABLE indago.history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id text NOT NULL REFERENCES indago.records(id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  actor_email text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  before_edits jsonb NOT NULL,
  after_edits jsonb NOT NULL,
  version integer NOT NULL
);
CREATE INDEX history_record ON indago.history(record_id, id DESC);
ALTER TABLE indago.history ENABLE ROW LEVEL SECURITY;
CREATE POLICY invited_reads_history ON indago.history FOR SELECT TO indago_app USING (indago.is_member());
GRANT SELECT ON indago.history TO indago_app;

CREATE FUNCTION indago.guard_record_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = '' AS $$
DECLARE locked jsonb; title text; key text; col integer; actor text;
BEGIN
  actor := nullif(current_setting('indago.user_id', true), '');
  IF actor IS NULL OR NOT indago.can_edit() THEN
    RAISE EXCEPTION 'editor invitation required' USING errcode = '42501';
  END IF;
  IF (new.id, new.sheet_id, new.position, new.source_values) IS DISTINCT FROM
     (old.id, old.sheet_id, old.position, old.source_values) THEN
    RAISE EXCEPTION 'source record is immutable' USING errcode = '23514';
  END IF;
  SELECT s.locked_columns, s.title INTO locked, title FROM indago.sheets s WHERE s.id = old.sheet_id;
  FOR key IN SELECT jsonb_object_keys(new.edits) LOOP
    IF key !~ '^(0|[1-9][0-9]*)$' THEN
      IF NOT ((title = 'Work Breakdown' AND key = 'person') OR
              (title = 'Portal Settings' AND (key = 'kickoff' OR key ~ '^check[0-9]+$'))) THEN
        RAISE EXCEPTION 'invalid edit field' USING errcode = '23514';
      END IF;
    ELSE
      col := key::integer;
      IF col >= jsonb_array_length(old.source_values) OR locked @> to_jsonb(col) THEN
        RAISE EXCEPTION 'source field is locked' USING errcode = '23514';
      END IF;
    END IF;
    IF jsonb_typeof(new.edits -> key) <> 'string' THEN
      RAISE EXCEPTION 'edit must be text' USING errcode = '23514';
    END IF;
  END LOOP;
  IF new.edits = old.edits THEN RETURN old; END IF;
  new.changed_by := actor;
  new.changed_at := now();
  new.version := old.version + 1;
  INSERT INTO indago.history(record_id, actor_id, actor_email, before_edits, after_edits, version)
    SELECT old.id, actor, m.email, old.edits, new.edits, new.version
    FROM indago.members m WHERE m.user_id = actor;
  RETURN new;
END $$;
CREATE TRIGGER guard_record_update BEFORE UPDATE ON indago.records
  FOR EACH ROW EXECUTE FUNCTION indago.guard_record_update();

CREATE FUNCTION indago.stamp_new_record() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = '' AS $$
DECLARE width integer; actor text;
BEGIN
  actor := nullif(current_setting('indago.user_id', true), '');
  IF current_user = 'indago_app' AND (actor IS NULL OR NOT indago.can_edit()) THEN
    RAISE EXCEPTION 'editor invitation required' USING errcode = '42501';
  END IF;
  SELECT jsonb_array_length(columns) INTO width FROM indago.sheets WHERE id = new.sheet_id;
  IF jsonb_array_length(new.source_values) <> width THEN
    RAISE EXCEPTION 'column count mismatch' USING errcode = '23514';
  END IF;
  IF actor IS NOT NULL THEN new.changed_by := actor; new.changed_at := now(); END IF;
  RETURN new;
END $$;
CREATE TRIGGER stamp_new_record BEFORE INSERT ON indago.records
  FOR EACH ROW EXECUTE FUNCTION indago.stamp_new_record();

CREATE FUNCTION indago.audit_new_record() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = '' AS $$
BEGIN
  IF new.changed_by IS NOT NULL THEN
    INSERT INTO indago.history(record_id, actor_id, actor_email, before_edits, after_edits, version)
      SELECT new.id, new.changed_by, m.email, '{}'::jsonb, new.edits, new.version
      FROM indago.members m WHERE m.user_id = new.changed_by;
  END IF;
  RETURN new;
END $$;
CREATE TRIGGER audit_new_record AFTER INSERT ON indago.records
  FOR EACH ROW EXECUTE FUNCTION indago.audit_new_record();
