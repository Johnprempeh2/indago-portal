\set ON_ERROR_STOP on
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
\ir ../migrations/0041_indago_schema.sql
\ir ../migrations/0042_indago_editor_rows.sql
\ir ../migrations/0043_indago_history_actor.sql

insert into auth.users values
 ('00000000-0000-0000-0000-000000000001', 'editor@example.test'),
 ('00000000-0000-0000-0000-000000000002', 'viewer@example.test'),
 ('00000000-0000-0000-0000-000000000003', 'outsider@example.test');
insert into indago.members (user_id, role) values
 ('00000000-0000-0000-0000-000000000001', 'editor'),
 ('00000000-0000-0000-0000-000000000002', 'viewer');
insert into indago.sheets values ('test:Findings','Client Findings','test','["Client text","Status"]','[0]',-1);
insert into indago.records (id,sheet_id,position,source_values)
 values ('finding-1','test:Findings',1,'["Original statement","Open"]');
insert into indago.sheets values ('test:Risks','Risks & Issues','test','["ID","Risk"]','[0]',0);
insert into indago.sheets values ('test:Settings','Portal Settings','test','["Setting"]','[0]',1);
insert into indago.records (id,sheet_id,position,source_values)
 values ('settings','test:Settings',1,'["settings"]');

grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
do $$ begin
  if (select count(*) from indago.records) <> 0 then raise exception 'uninvited user read records'; end if;
  if (select count(*) from indago.sheets) <> 0 then raise exception 'uninvited user read sheets'; end if;
  if (select count(*) from indago.recent_history()) <> 0 then raise exception 'uninvited user read actor emails'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$ declare affected integer; begin
  if (select count(*) from indago.records) <> 2 then raise exception 'viewer cannot read'; end if;
  update indago.records set edits = '{"1":"Complete"}' where id = 'finding-1';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'viewer changed record'; end if;
end $$;
do $$ begin
  begin
    insert into indago.records (id,sheet_id,position,source_values)
      values ('risk-viewer','test:Risks',1,'["R01","text"]');
    raise exception 'viewer inserted project row';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin
  begin
    update indago.records set edits = '{"0":"Changed"}' where id = 'finding-1';
    raise exception 'locked client text changed';
  exception when check_violation then null;
  end;
end $$;
update indago.records set edits = '{"1":"Complete"}' where id = 'finding-1';
update indago.records set edits = '{"kickoff":"2026-10-20","check0":"true"}' where id = 'settings';
insert into indago.records (id,sheet_id,position,source_values)
  values ('risk-1','test:Risks',1,'["R01","Example risk"]');
do $$ begin
  begin
    insert into indago.records (id,sheet_id,position,source_values)
      values ('finding-2','test:Findings',2,'["Changed client text","Open"]');
    raise exception 'editor inserted into client source register';
  exception when insufficient_privilege then null;
  end;
end $$;
do $$ begin
  if (select count(*) from indago.history) <> 3 then raise exception 'audit missing'; end if;
  if (select count(*) from indago.recent_history() where actor_email = 'editor@example.test') <> 3 then raise exception 'actor email missing'; end if;
  if (select version from indago.records where id='finding-1') <> 2 then raise exception 'version missing'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
do $$ begin
  if (select count(*) from indago.recent_history()) <> 0 then
    raise exception 'uninvited user read actor email after changes';
  end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$ begin
  if (select count(*) from indago.recent_history() where actor_email = 'editor@example.test') <> 3 then
    raise exception 'viewer cannot identify history actor';
  end if;
end $$;
reset role;
\ir ../rollback/0043_indago_history_actor_down.sql
\ir ../rollback/0042_indago_editor_rows_down.sql
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin
  begin
    update indago.records set edits = '{"kickoff":"2026-10-21"}' where id = 'settings';
    raise exception '0042 rollback left overlay edits enabled';
  exception when check_violation then null;
  end;
end $$;
update indago.records set edits = '{"1":"Reviewed"}' where id = 'finding-1';
do $$ begin
  if (select version from indago.records where id='finding-1') <> 3 then
    raise exception '0041 numeric edit guard was not restored';
  end if;
end $$;
reset role;
select 'Indago RLS, locked fields and audit passed' as result;
