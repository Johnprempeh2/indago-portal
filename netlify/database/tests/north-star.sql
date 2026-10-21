-- Run only against a local database after migrations 0001 to 0007.
BEGIN;
INSERT INTO indago.members(email, user_id, role) VALUES
  ('ns-editor@example.test', 'ns-editor', 'editor'),
  ('ns-viewer@example.test', 'ns-viewer', 'viewer');

SET LOCAL ROLE indago_app;
SELECT set_config('indago.user_id', 'ns-editor', true);
INSERT INTO indago.north_star_fields(record_id, field_key, value)
  VALUES ('IND-NS-001', 'question.0.verbatim', 'Invented words');
INSERT INTO indago.north_star_fields(record_id, field_key, value)
  VALUES ('IND-NS-001', 'question.0.interpretation', 'Invented interpretation');
UPDATE indago.north_star_fields SET value = 'Revised invented words'
  WHERE record_id = 'IND-NS-001' AND field_key = 'question.0.verbatim';
DO $$ BEGIN
  IF (SELECT version FROM indago.north_star_fields WHERE field_key = 'question.0.verbatim') <> 2 THEN
    RAISE EXCEPTION 'field version did not increment';
  END IF;
  IF (SELECT version FROM indago.north_star_fields WHERE field_key = 'question.0.interpretation') <> 1 THEN
    RAISE EXCEPTION 'separate field version changed';
  END IF;
  IF (SELECT count(*) FROM indago.north_star_history WHERE field_key = 'question.0.verbatim') <> 2 THEN
    RAISE EXCEPTION 'field history incomplete';
  END IF;
  BEGIN
    UPDATE indago.north_star_fields SET value = 'Approved'
      WHERE record_id = 'IND-NS-001' AND field_key = 'approval.status';
    RAISE EXCEPTION 'approval gate failed to refuse';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
INSERT INTO indago.north_star_fields(record_id, field_key, value)
  VALUES ('IND-NS-001', 'convergence.6.answer', 'Yes');
UPDATE indago.north_star_fields SET value = 'Approved'
  WHERE record_id = 'IND-NS-001' AND field_key = 'approval.status';
DO $$ BEGIN
  IF (SELECT value FROM indago.north_star_fields WHERE field_key = 'approval.status') <> 'Approved' THEN
    RAISE EXCEPTION 'approved state not saved';
  END IF;
  BEGIN
    UPDATE indago.north_star_fields SET value = 'No'
      WHERE record_id = 'IND-NS-001' AND field_key = 'convergence.6.answer';
    RAISE EXCEPTION 'acceptance revocation was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

SELECT set_config('indago.user_id', 'ns-viewer', true);
DO $$ BEGIN
  BEGIN
    INSERT INTO indago.north_star_fields(record_id, field_key, value)
      VALUES ('IND-NS-001', 'draft.verbatim', 'Viewer should not edit');
    RAISE EXCEPTION 'viewer edit was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
