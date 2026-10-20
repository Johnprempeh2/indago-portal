-- GRE-1683. Apply only after checking production backups and reviewing with Flint.
-- All project data is private. Invitation rows are provisioned by an administrator,
-- never by the browser. The API role gets no membership or audit write privilege.
create schema if not exists indago;
grant usage on schema indago to authenticated;

create table indago.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('editor', 'viewer')),
  invited_at timestamptz not null default now(),
  invited_by uuid references auth.users(id)
);
alter table indago.members enable row level security;
create policy member_reads_self on indago.members for select to authenticated
  using (user_id = (select auth.uid()));
grant select on indago.members to authenticated;

create function indago.is_member() returns boolean language sql stable security definer
  set search_path = '' as $$
  select exists (select 1 from indago.members where user_id = auth.uid())
$$;
create function indago.can_edit() returns boolean language sql stable security definer
  set search_path = '' as $$
  select exists (select 1 from indago.members where user_id = auth.uid() and role = 'editor')
$$;
revoke all on function indago.is_member() from public;
revoke all on function indago.can_edit() from public;
grant execute on function indago.is_member(), indago.can_edit() to authenticated;

-- One row per source sheet. The column names and their lock boundary are data,
-- so imports and screen mapping use one stable contract.
create table indago.sheets (
  id text primary key,
  title text not null,
  source_name text not null,
  columns jsonb not null check (jsonb_typeof(columns) = 'array'),
  locked_columns jsonb not null check (jsonb_typeof(locked_columns) = 'array'),
  position integer not null unique
);
alter table indago.sheets enable row level security;
create policy invited_reads_sheets on indago.sheets for select to authenticated
  using (indago.is_member());
grant select on indago.sheets to authenticated;

create table indago.records (
  id text primary key,
  sheet_id text not null references indago.sheets(id) on delete restrict,
  position integer not null,
  source_values jsonb not null check (jsonb_typeof(source_values) = 'array'),
  edits jsonb not null default '{}'::jsonb check (jsonb_typeof(edits) = 'object'),
  changed_by uuid references auth.users(id),
  changed_at timestamptz,
  version integer not null default 1,
  unique (sheet_id, position)
);
create index indago_records_sheet_position on indago.records (sheet_id, position);
alter table indago.records enable row level security;
create policy invited_reads_records on indago.records for select to authenticated
  using (indago.is_member());
create policy editors_update_records on indago.records for update to authenticated
  using (indago.can_edit()) with check (indago.can_edit());
grant select on indago.records to authenticated;
grant update (edits) on indago.records to authenticated;

create table indago.history (
  id bigint generated always as identity primary key,
  record_id text not null references indago.records(id) on delete restrict,
  actor_id uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  before_edits jsonb not null,
  after_edits jsonb not null,
  version integer not null
);
create index indago_history_record on indago.history (record_id, id desc);
alter table indago.history enable row level security;
create policy invited_reads_history on indago.history for select to authenticated
  using (indago.is_member());
grant select on indago.history to authenticated;

create function indago.guard_record_update() returns trigger language plpgsql security definer
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
create trigger guard_record_update before update on indago.records
  for each row execute function indago.guard_record_update();

-- Only migrations or service-role import may add source rows. No authenticated
-- INSERT or DELETE grants exist, and history has no authenticated write grant.
