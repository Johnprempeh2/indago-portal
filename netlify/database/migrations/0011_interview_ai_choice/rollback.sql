REVOKE INSERT(ai_assisted) ON indago.client_interviews FROM indago_app;
ALTER TABLE indago.client_interviews DROP COLUMN ai_assisted;
