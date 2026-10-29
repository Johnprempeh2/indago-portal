-- Export session, answer and challenge rows before rollback; this deletes them.
DROP TABLE indago.client_interview_challenges;
DROP TABLE indago.client_interview_answers;
DROP TABLE indago.client_interviews;
DROP FUNCTION indago.is_facilitator();
