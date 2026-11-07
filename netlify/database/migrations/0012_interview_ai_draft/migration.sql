-- After submit, a background function replaces the guided draft with the AI draft (GRE-3641).
-- NULL: no AI draft for this session. pending: waiting to start. running: claimed. done or failed: final.
ALTER TABLE indago.client_interviews ADD COLUMN ai_draft text
  CHECK (ai_draft IS NULL OR ai_draft IN ('pending', 'running', 'done', 'failed'));
GRANT UPDATE(ai_draft) ON indago.client_interviews TO indago_app;
-- The owner's submitted session stays read only, except while its AI draft is pending or running.
CREATE POLICY interview_ai_draft ON indago.client_interviews FOR UPDATE TO indago_app
  USING (owner_id = nullif(current_setting('indago.user_id', true), '') AND status = 'submitted'
    AND ai_draft IN ('pending', 'running'))
  WITH CHECK (owner_id = nullif(current_setting('indago.user_id', true), '') AND status = 'submitted');
