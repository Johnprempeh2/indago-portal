-- The participant chooses AI help or guided questions at the start; the choice is fixed for the session.
ALTER TABLE indago.client_interviews ADD COLUMN ai_assisted boolean NOT NULL DEFAULT false;
GRANT INSERT(ai_assisted) ON indago.client_interviews TO indago_app;
