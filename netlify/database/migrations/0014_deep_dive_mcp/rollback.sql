-- Export indago.mcp_drafts and indago.mcp_audit before rollback; this deletes them.
-- Approved record drafts have already become normal records and stay.
DROP FUNCTION indago.mcp_save_draft(text, text, uuid, uuid, uuid, integer, text, text, jsonb);
DROP FUNCTION indago.mcp_get_draft(text, text, uuid);
DROP FUNCTION indago.mcp_list_drafts(text, text);
DROP FUNCTION indago.mcp_interview_questions(text, text);
DROP FUNCTION indago.mcp_list_records(text, text, text, integer, integer);
DROP FUNCTION indago.mcp_get_engagement(text, text);
DROP FUNCTION indago.mcp_list_engagements(text);
DROP FUNCTION indago.mcp_caller(text, text);
DROP FUNCTION indago.mcp_revoke_token(uuid);
DROP FUNCTION indago.mcp_register_token(text, text, text);
DROP TABLE indago.mcp_audit;
DROP TABLE indago.mcp_drafts;
DROP TABLE indago.mcp_tokens;
DROP FUNCTION indago.engagement_key();
-- The NOLOGIN role indago_mcp stays: roles are cluster-wide and it can do nothing once these are gone.
REVOKE USAGE ON SCHEMA indago FROM indago_mcp;
