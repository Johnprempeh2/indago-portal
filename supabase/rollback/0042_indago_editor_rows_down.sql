-- Run before rolling back 0041. Existing editor-created rows remain in place;
-- export them before rolling back 0041, which drops the whole schema.
drop trigger if exists audit_new_record on indago.records;
drop trigger if exists stamp_new_record on indago.records;
drop function if exists indago.audit_new_record();
drop function if exists indago.stamp_new_record();
drop policy if exists editors_insert_project_rows on indago.records;
revoke insert (id, sheet_id, position, source_values) on indago.records from authenticated;
-- The original guard function is restored by reapplying 0041 in an isolated database.
