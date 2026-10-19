\set ON_ERROR_STOP on
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
\ir ../migrations/0041_indago_schema.sql

insert into auth.users values
 ('00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000003');
insert into indago.members (user_id, role) values
 ('00000000-0000-0000-0000-000000000001', 'editor'),
 ('00000000-0000-0000-0000-000000000002', 'viewer');
insert into indago.sheets values ('test:Findings','Findings','test','["Client text","Status"]','[0]',-1);
insert into indago.records (id,sheet_id,position,source_values)
 values ('finding-1','test:Findings',1,'["Original statement","Open"]');

grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
do $$ begin
  if (select count(*) from indago.records) <> 0 then raise exception 'uninvited user read records'; end if;
  if (select count(*) from indago.sheets) <> 0 then raise exception 'uninvited user read sheets'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$ declare affected integer; begin
  if (select count(*) from indago.records) <> 1 then raise exception 'viewer cannot read'; end if;
  update indago.records set edits = '{"1":"Complete"}' where id = 'finding-1';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'viewer changed record'; end if;
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
do $$ begin
  if (select count(*) from indago.history) <> 1 then raise exception 'audit missing'; end if;
  if (select version from indago.records where id='finding-1') <> 2 then raise exception 'version missing'; end if;
end $$;
reset role;
select 'Indago RLS, locked fields and audit passed' as result;
