CREATE TABLE indago.deliverables (
  id uuid PRIMARY KEY,
  record_id text NOT NULL REFERENCES indago.records(id) ON DELETE RESTRICT,
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 180),
  file_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 52428800),
  chunk_count integer NOT NULL CHECK (chunk_count BETWEEN 1 AND 17),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'active', 'deleted')),
  uploaded_by text,
  uploaded_at timestamptz,
  removed_by text,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deliverables_record_status ON indago.deliverables(record_id, status);
ALTER TABLE indago.deliverables ENABLE ROW LEVEL SECURITY;
CREATE POLICY invited_reads_deliverables ON indago.deliverables FOR SELECT TO indago_app
  USING (indago.is_member());
CREATE POLICY editors_insert_deliverables ON indago.deliverables FOR INSERT TO indago_app
  WITH CHECK (indago.can_edit() AND status = 'uploading');
CREATE POLICY editors_update_deliverables ON indago.deliverables FOR UPDATE TO indago_app
  USING (indago.can_edit()) WITH CHECK (indago.can_edit());
GRANT SELECT, INSERT, UPDATE(status, uploaded_by, uploaded_at, removed_by, removed_at)
  ON indago.deliverables TO indago_app;

CREATE TABLE indago.deliverable_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deliverable_id uuid NOT NULL REFERENCES indago.deliverables(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('uploaded', 'removed')),
  actor text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE indago.deliverable_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY invited_reads_deliverable_history ON indago.deliverable_history FOR SELECT TO indago_app
  USING (indago.is_member());
GRANT SELECT ON indago.deliverable_history TO indago_app;

CREATE FUNCTION indago.audit_deliverable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = '' AS $$
DECLARE actor_label text;
BEGIN
  IF old.status = new.status THEN RETURN new; END IF;
  IF NOT ((old.status = 'uploading' AND new.status = 'active') OR
          (old.status = 'active' AND new.status = 'deleted')) THEN
    RAISE EXCEPTION 'invalid deliverable transition' USING errcode = '23514';
  END IF;
  IF current_setting('indago.open_access', true) = 'on' THEN
    actor_label := 'Open access';
  ELSE
    SELECT email INTO actor_label FROM indago.members
      WHERE user_id = nullif(current_setting('indago.user_id', true), '');
  END IF;
  IF actor_label IS NULL THEN RAISE EXCEPTION 'actor required' USING errcode = '42501'; END IF;
  IF new.status = 'active' THEN
    new.uploaded_by := actor_label; new.uploaded_at := now();
  ELSE
    new.removed_by := actor_label; new.removed_at := now();
  END IF;
  INSERT INTO indago.deliverable_history(deliverable_id, action, actor)
    VALUES (new.id, CASE WHEN new.status = 'active' THEN 'uploaded' ELSE 'removed' END, actor_label);
  RETURN new;
END $$;
CREATE TRIGGER audit_deliverable BEFORE UPDATE ON indago.deliverables
  FOR EACH ROW EXECUTE FUNCTION indago.audit_deliverable();
