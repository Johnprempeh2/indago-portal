-- Run before rolling back 0001. Existing editor-created rows remain in place;
-- export them before rolling back 0001, which drops the whole schema.
drop trigger if exists audit_new_record on indago.records;
drop trigger if exists stamp_new_record on indago.records;
drop function if exists indago.audit_new_record();
drop function if exists indago.stamp_new_record();
drop policy if exists editors_insert_project_rows on indago.records;
revoke insert (id, sheet_id, position, source_values) on indago.records from authenticated;
-- Restore the 0001 guard in place. Reapplying 0001 would recreate the schema.
create or replace function indago.guard_record_update() returns trigger language plpgsql security definer
  set search_path = '' as $$
declare
  locked jsonb;
  key text;
  col integer;
begin
  if auth.uid() is null or not indago.can_edit() then
    raise exception 'editor invitation required' using errcode = '42501';
  end if;
  if (new.id, new.sheet_id, new.position, new.source_values) is distinct from
     (old.id, old.sheet_id, old.position, old.source_values) then
    raise exception 'source record is immutable' using errcode = '23514';
  end if;
  select locked_columns into locked from indago.sheets where id = old.sheet_id;
  for key in select jsonb_object_keys(new.edits) loop
    if key !~ '^(0|[1-9][0-9]*)$' then
      raise exception 'invalid column index' using errcode = '23514';
    end if;
    col := key::integer;
    if col >= jsonb_array_length(old.source_values) or locked @> to_jsonb(col) then
      raise exception 'client source field is locked' using errcode = '23514';
    end if;
    if jsonb_typeof(new.edits -> key) <> 'string' then
      raise exception 'edit must be text' using errcode = '23514';
    end if;
  end loop;
  if new.edits = old.edits then return old; end if;
  new.changed_by := auth.uid();
  new.changed_at := now();
  new.version := old.version + 1;
  insert into indago.history (record_id, actor_id, before_edits, after_edits, version)
    values (old.id, auth.uid(), old.edits, new.edits, new.version);
  return new;
end $$;
