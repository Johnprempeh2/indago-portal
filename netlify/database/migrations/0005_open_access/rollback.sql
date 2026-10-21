-- Disable INDAGO_OPEN_ACCESS before rolling back this migration.
CREATE OR REPLACE FUNCTION indago.is_member() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM indago.members
    WHERE user_id = nullif(current_setting('indago.user_id', true), ''))
$$;
CREATE OR REPLACE FUNCTION indago.can_edit() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM indago.members
    WHERE user_id = nullif(current_setting('indago.user_id', true), '') AND role = 'editor')
$$;

CREATE OR REPLACE FUNCTION indago.guard_record_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
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

CREATE OR REPLACE FUNCTION indago.audit_new_record() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = '' AS $$
BEGIN
  IF new.changed_by IS NOT NULL THEN
    INSERT INTO indago.history(record_id, actor_id, actor_email, before_edits, after_edits, version)
      SELECT new.id, new.changed_by, m.email, '{}'::jsonb, new.edits, new.version
      FROM indago.members m WHERE m.user_id = new.changed_by;
  END IF;
  RETURN new;
END $$;
