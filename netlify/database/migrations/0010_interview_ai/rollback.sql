REVOKE UPDATE(next_question) ON indago.client_interviews FROM indago_app;
ALTER TABLE indago.client_interviews DROP COLUMN next_question;
