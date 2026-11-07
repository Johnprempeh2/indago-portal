-- Restoring one answer per move fails while any session has more than one answer in a move. Export those
-- sessions for the facilitator first; this rollback does not delete answers.
REVOKE UPDATE(next_turn) ON indago.client_interviews FROM indago_app;
ALTER TABLE indago.client_interviews DROP COLUMN next_turn;
REVOKE INSERT(question, asked_by, ai_reason, ai_covered, source_check) ON indago.client_interview_answers FROM indago_app;
DROP INDEX indago.client_interview_answers_session;
DROP INDEX indago.client_interview_answers_one_source_check;
ALTER TABLE indago.client_interview_answers
  DROP COLUMN source_check, DROP COLUMN ai_covered, DROP COLUMN ai_reason, DROP COLUMN asked_by, DROP COLUMN question;
ALTER TABLE indago.client_interview_answers ADD CONSTRAINT client_interview_answers_session_id_move_key UNIQUE(session_id, move);
