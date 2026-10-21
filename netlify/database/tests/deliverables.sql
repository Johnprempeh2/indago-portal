BEGIN;
INSERT INTO indago.members(email, user_id, role) VALUES
  ('editor@example.test', 'editor-1', 'editor'),
  ('viewer@example.test', 'viewer-1', 'viewer');
INSERT INTO indago.sheets(id, title, source_name, columns, locked_columns, position)
  VALUES ('plan', 'Work Breakdown', 'test', '["WBS"]', '[]', 1);
INSERT INTO indago.records(id, sheet_id, position, source_values)
  VALUES ('plan:1', 'plan', 1, '["1.01"]');
SET LOCAL ROLE indago_app;
SELECT set_config('indago.user_id', 'editor-1', true);
INSERT INTO indago.deliverables(id, record_id, file_name, file_type, byte_size, chunk_count, sha256)
  VALUES ('f33f1e68-3637-4b8f-b56d-263e78d87fce', 'plan:1', 'Demo.pdf', 'application/pdf', 11, 1,
    repeat('a', 64));
UPDATE indago.deliverables SET status = 'active'
  WHERE id = 'f33f1e68-3637-4b8f-b56d-263e78d87fce';
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.deliverable_history WHERE action = 'uploaded' AND actor = 'editor@example.test') <> 1
  THEN RAISE EXCEPTION 'upload audit missing'; END IF;
END $$;
SELECT set_config('indago.user_id', 'viewer-1', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.deliverables WHERE status = 'active') <> 1 THEN RAISE EXCEPTION 'viewer cannot read file'; END IF;
  BEGIN
    UPDATE indago.deliverables SET status = 'deleted';
    IF FOUND THEN RAISE EXCEPTION 'viewer removed file'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('indago.user_id', 'editor-1', true);
UPDATE indago.deliverables SET status = 'deleted'
  WHERE id = 'f33f1e68-3637-4b8f-b56d-263e78d87fce';
SELECT set_config('indago.user_id', 'viewer-1', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.deliverable_history WHERE action = 'removed' AND actor = 'editor@example.test') <> 1
  THEN RAISE EXCEPTION 'removal audit missing'; END IF;
END $$;
ROLLBACK;
SELECT 'Deliverable RLS and audit checks passed' AS result;
