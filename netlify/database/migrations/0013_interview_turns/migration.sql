-- NS-01 is a conversation (GRE-3641, Touchstone M1): a move can have up to 3 questions, and the AI may skip a
-- move it saw covered. Each answer keeps the question asked, who asked it (AI or guided), the AI's reason and the
-- moves it saw as covered, and whether it was the move 1 check of earlier source statements.
ALTER TABLE indago.client_interview_answers DROP CONSTRAINT client_interview_answers_session_id_move_key;
ALTER TABLE indago.client_interview_answers
  ADD COLUMN question text CHECK (question IS NULL OR length(question) BETWEEN 1 AND 500),
  ADD COLUMN asked_by text NOT NULL DEFAULT 'guided' CHECK (asked_by IN ('AI', 'guided')),
  ADD COLUMN ai_reason text CHECK (ai_reason IS NULL OR length(ai_reason) <= 200),
  ADD COLUMN ai_covered text[] NOT NULL DEFAULT '{}'
    CHECK (ai_covered <@ ARRAY['ambition','value','futures','economics','boundaries','convergence']),
  ADD COLUMN source_check boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX client_interview_answers_one_source_check ON indago.client_interview_answers(session_id) WHERE source_check;
CREATE INDEX client_interview_answers_session ON indago.client_interview_answers(session_id, created_at);
GRANT INSERT(question, asked_by, ai_reason, ai_covered, source_check) ON indago.client_interview_answers TO indago_app;
-- The AI's next turn (move, question, reason, covered). NULL means the guided turn.
ALTER TABLE indago.client_interviews ADD COLUMN next_turn jsonb;
GRANT UPDATE(next_turn) ON indago.client_interviews TO indago_app;
