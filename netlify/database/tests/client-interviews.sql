\set ON_ERROR_STOP on
BEGIN;
INSERT INTO indago.members(email,user_id,role,facilitator) VALUES
  ('interview-one@example.test','interview-one','viewer',false),
  ('interview-two@example.test','interview-two','viewer',false),
  ('interview-facilitator@example.test','interview-facilitator','editor',true);
SET LOCAL ROLE indago_app;
SELECT set_config('indago.user_id','interview-one',true);
INSERT INTO indago.client_interviews(id,owner_id,consented_at) VALUES
  ('00000000-0000-4000-8000-000000000001','interview-one',now());
INSERT INTO indago.client_interview_answers(id,session_id,move,original) VALUES
  ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','ambition','First words are immutable');
INSERT INTO indago.client_interview_challenges(id,answer_id,question) VALUES
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','What evidence would test this?');
-- NS-01: a move can hold follow-up answers, but a session has one check of the earlier source statements.
INSERT INTO indago.client_interview_answers(id,session_id,move,original,question,asked_by,ai_reason,ai_covered,source_check) VALUES
  ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','ambition','Confirm the first two',
   'Which of these earlier statements would you confirm, correct or drop?','guided',NULL,'{ambition}',true),
  ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','ambition','Independence',
   'Which parts of that are non-negotiable?','AI','Move 1 asks for non-negotiables.','{}',false);
DO $$ BEGIN
  BEGIN
    INSERT INTO indago.client_interview_answers(id,session_id,move,original,source_check) VALUES
      ('10000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','ambition','Again',true);
    RAISE EXCEPTION 'second source check was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO indago.client_interview_answers(id,session_id,move,original,ai_covered) VALUES
      ('10000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','value','Covered','{nowhere}');
    RAISE EXCEPTION 'unknown covered move was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
UPDATE indago.client_interviews SET next_turn = '{"move":"value","question":"Q?","askedBy":"AI"}'
  WHERE id = '00000000-0000-4000-8000-000000000001';
DO $$ BEGIN
  BEGIN
    UPDATE indago.client_interview_answers SET original = 'changed';
    RAISE EXCEPTION 'original answer was editable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('indago.user_id','interview-two',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.client_interviews) <> 0 THEN RAISE EXCEPTION 'second client read first session'; END IF;
  IF (SELECT count(*) FROM indago.client_interview_answers) <> 0 THEN RAISE EXCEPTION 'second client read first answer'; END IF;
  IF (SELECT count(*) FROM indago.client_interview_challenges) <> 0 THEN RAISE EXCEPTION 'second client read first challenge'; END IF;
END $$;
INSERT INTO indago.client_interviews(id,owner_id,consented_at) VALUES
  ('00000000-0000-4000-8000-000000000002','interview-two',now());
SELECT set_config('indago.user_id','outsider',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.client_interviews) <> 0 THEN RAISE EXCEPTION 'uninvited read sessions'; END IF;
END $$;
SELECT set_config('indago.user_id','interview-facilitator',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.client_interviews) <> 2 THEN RAISE EXCEPTION 'facilitator cannot review'; END IF;
  IF (SELECT count(*) FROM indago.client_interview_answers) <> 3 THEN RAISE EXCEPTION 'facilitator cannot read answers'; END IF;
END $$;
SELECT set_config('indago.user_id','open-access',true);
SELECT set_config('indago.open_access','on',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM indago.client_interviews) <> 0 THEN RAISE EXCEPTION 'open access read interviews'; END IF;
END $$;
SELECT set_config('indago.open_access','',true);
SELECT set_config('indago.user_id','interview-one',true);
UPDATE indago.client_interviews SET status = 'submitted', ai_draft = 'pending', draft = '{}'
  WHERE id = '00000000-0000-4000-8000-000000000001';
DO $$ BEGIN
  UPDATE indago.client_interviews SET ai_draft = 'running'
    WHERE id = '00000000-0000-4000-8000-000000000001' AND ai_draft = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'owner cannot claim the AI draft'; END IF;
  UPDATE indago.client_interviews SET draft = '{"processing":"AI"}', ai_draft = 'done'
    WHERE id = '00000000-0000-4000-8000-000000000001' AND ai_draft = 'running';
  IF NOT FOUND THEN RAISE EXCEPTION 'owner cannot write the AI draft'; END IF;
  UPDATE indago.client_interviews SET draft = '{}' WHERE id = '00000000-0000-4000-8000-000000000001';
  IF FOUND THEN RAISE EXCEPTION 'finished draft was editable'; END IF;
END $$;
SELECT set_config('indago.user_id','interview-two',true);
UPDATE indago.client_interviews SET status = 'submitted', draft = '{}' WHERE id = '00000000-0000-4000-8000-000000000002';
DO $$ BEGIN
  UPDATE indago.client_interviews SET ai_draft = 'running', draft = '{"processing":"AI"}'
    WHERE id = '00000000-0000-4000-8000-000000000002';
  IF FOUND THEN RAISE EXCEPTION 'guided submitted session was editable'; END IF;
END $$;
ROLLBACK;
SELECT 'Client interview invitation, ownership, facilitator, verbatim and AI draft checks passed' AS result;
