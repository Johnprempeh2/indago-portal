-- Export any facilitator assignments before rollback; this discards the flag.
ALTER TABLE indago.members DROP COLUMN facilitator;
