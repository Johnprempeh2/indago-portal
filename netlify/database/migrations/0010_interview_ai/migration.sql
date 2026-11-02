ALTER TABLE indago.client_interviews
  ADD COLUMN next_question text CHECK (next_question IS NULL OR length(next_question) BETWEEN 1 AND 500);
GRANT UPDATE(next_question) ON indago.client_interviews TO indago_app;
