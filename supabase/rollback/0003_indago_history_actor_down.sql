-- Remove actor email lookup; audit rows remain intact.
drop function if exists indago.recent_history(text);
