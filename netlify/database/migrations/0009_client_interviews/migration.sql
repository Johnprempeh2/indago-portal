-- Private client sessions belong to the Indago database, not the website database.
CREATE FUNCTION indago.is_facilitator() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM indago.members
    WHERE user_id = nullif(current_setting('indago.user_id', true), '') AND facilitator = true)
$$;
REVOKE ALL ON FUNCTION indago.is_facilitator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION indago.is_facilitator() TO indago_app;

CREATE TABLE indago.client_interviews (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  record_id text NOT NULL DEFAULT 'IND-NS-001' CHECK (record_id = 'IND-NS-001'),
  gate text NOT NULL DEFAULT 'G2' CHECK (gate = 'G2'),
  consented_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted')),
  corrected_summary text NOT NULL DEFAULT '' CHECK (length(corrected_summary) <= 20000),
  draft jsonb CHECK (draft IS NULL OR jsonb_typeof(draft) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_interviews_owner ON indago.client_interviews(owner_id, updated_at DESC);
ALTER TABLE indago.client_interviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY interview_read ON indago.client_interviews FOR SELECT TO indago_app
  USING (owner_id = nullif(current_setting('indago.user_id', true), '') OR indago.is_facilitator());
CREATE POLICY interview_insert ON indago.client_interviews FOR INSERT TO indago_app
  WITH CHECK (owner_id = nullif(current_setting('indago.user_id', true), '') AND indago.is_member()
    AND current_setting('indago.open_access', true) IS DISTINCT FROM 'on');
CREATE POLICY interview_update ON indago.client_interviews FOR UPDATE TO indago_app
  USING (owner_id = nullif(current_setting('indago.user_id', true), '') AND status = 'in_progress')
  WITH CHECK (owner_id = nullif(current_setting('indago.user_id', true), ''));
GRANT SELECT, INSERT(id, owner_id, consented_at), UPDATE(corrected_summary, draft, status, updated_at)
  ON indago.client_interviews TO indago_app;

CREATE TABLE indago.client_interview_answers (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES indago.client_interviews(id) ON DELETE RESTRICT,
  move text NOT NULL CHECK (move IN ('ambition','value','futures','economics','boundaries','convergence')),
  original text NOT NULL CHECK (length(trim(original)) > 0 AND length(original) <= 20000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, move)
);
ALTER TABLE indago.client_interview_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY answer_read ON indago.client_interview_answers FOR SELECT TO indago_app
  USING (EXISTS (SELECT 1 FROM indago.client_interviews s WHERE s.id = session_id));
CREATE POLICY answer_insert ON indago.client_interview_answers FOR INSERT TO indago_app
  WITH CHECK (EXISTS (SELECT 1 FROM indago.client_interviews s WHERE s.id = session_id
    AND s.owner_id = nullif(current_setting('indago.user_id', true), '') AND s.status = 'in_progress'));
GRANT SELECT, INSERT(id, session_id, move, original) ON indago.client_interview_answers TO indago_app;

CREATE TABLE indago.client_interview_challenges (
  id uuid PRIMARY KEY,
  answer_id uuid NOT NULL REFERENCES indago.client_interview_answers(id) ON DELETE RESTRICT,
  question text NOT NULL CHECK (length(question) BETWEEN 1 AND 500),
  reply text NOT NULL DEFAULT '' CHECK (length(reply) <= 20000),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE indago.client_interview_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY challenge_read ON indago.client_interview_challenges FOR SELECT TO indago_app
  USING (EXISTS (SELECT 1 FROM indago.client_interview_answers a
    JOIN indago.client_interviews s ON s.id = a.session_id WHERE a.id = answer_id));
CREATE POLICY challenge_insert ON indago.client_interview_challenges FOR INSERT TO indago_app
  WITH CHECK (EXISTS (SELECT 1 FROM indago.client_interview_answers a
    JOIN indago.client_interviews s ON s.id = a.session_id WHERE a.id = answer_id
      AND s.owner_id = nullif(current_setting('indago.user_id', true), '') AND s.status = 'in_progress'));
CREATE POLICY challenge_update ON indago.client_interview_challenges FOR UPDATE TO indago_app
  USING (reply = '' AND EXISTS (SELECT 1 FROM indago.client_interview_answers a
    JOIN indago.client_interviews s ON s.id = a.session_id WHERE a.id = answer_id
      AND s.owner_id = nullif(current_setting('indago.user_id', true), '') AND s.status = 'in_progress'))
  WITH CHECK (EXISTS (SELECT 1 FROM indago.client_interview_answers a
    JOIN indago.client_interviews s ON s.id = a.session_id WHERE a.id = answer_id
      AND s.owner_id = nullif(current_setting('indago.user_id', true), '')));
GRANT SELECT, INSERT(id, answer_id, question), UPDATE(reply) ON indago.client_interview_challenges TO indago_app;
