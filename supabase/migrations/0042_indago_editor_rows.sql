-- Editor-created project rows and portal controls. Run after 0041 and before import.
-- Reviewed source rows remain immutable; only overlay edits change after import.
create policy editors_insert_project_rows on indago.records for insert to authenticated
  with check (
    indago.can_edit() and sheet_id in (
      select id from indago.sheets where title in
      ('Risks & Issues', 'New Deep Dive Evidence', 'Service Processes', 'Commercial Baseline',
       'Findings', 'Opportunities', 'Decisions', 'GDXP Traceability', 'Validation Log')
    )
  );
grant insert (id, sheet_id, position, source_values) on indago.records to authenticated;

create function indago.stamp_new_record() returns trigger language plpgsql security definer
  set search_path = '' as $$
declare width integer;
begin
  -- Migration/service imports run without an end-user JWT. RLS still denies
  -- browser inserts unless the caller is an invited Editor.
  if auth.uid() is not null and not indago.can_edit() then
    raise exception 'editor invitation required' using errcode = '42501';
  end if;
  select jsonb_array_length(columns) into width from indago.sheets where id = new.sheet_id;
  if jsonb_array_length(new.source_values) <> width then
    raise exception 'column count mismatch' using errcode = '23514';
  end if;
  if auth.uid() is not null then
    new.changed_by := auth.uid();
    new.changed_at := now();
  end if;
  return new;
end $$;
create trigger stamp_new_record before insert on indago.records
  for each row execute function indago.stamp_new_record();

create function indago.audit_new_record() returns trigger language plpgsql security definer
  set search_path = '' as $$
begin
  if new.changed_by is null then return new; end if;
  insert into indago.history (record_id, actor_id, before_edits, after_edits, version)
    values (new.id, new.changed_by, '{}'::jsonb, new.edits, new.version);
  return new;
end $$;
create trigger audit_new_record after insert on indago.records
  for each row execute function indago.audit_new_record();

create or replace function indago.guard_record_update() returns trigger language plpgsql security definer
  set search_path = '' as $$
declare
  locked jsonb;
  title text;
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
  select locked_columns, sheets.title into locked, title from indago.sheets where id = old.sheet_id;
  for key in select jsonb_object_keys(new.edits) loop
    if key !~ '^(0|[1-9][0-9]*)$' then
      if not ((title = 'Work Breakdown' and key = 'person') or
              (title = 'Portal Settings' and (key = 'kickoff' or key ~ '^check[0-9]+$'))) then
        raise exception 'invalid edit field' using errcode = '23514';
      end if;
    else
      col := key::integer;
      if col >= jsonb_array_length(old.source_values) or locked @> to_jsonb(col) then
        raise exception 'source field is locked' using errcode = '23514';
      end if;
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
