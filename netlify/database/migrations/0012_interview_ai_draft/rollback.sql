DROP POLICY interview_ai_draft ON indago.client_interviews;
REVOKE UPDATE(ai_draft) ON indago.client_interviews FROM indago_app;
ALTER TABLE indago.client_interviews DROP COLUMN ai_draft;
