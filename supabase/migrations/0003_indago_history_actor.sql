-- GRE-1683. Show who made an audited change without exposing auth.users to browsers.
-- The caller must still be an invited member; only emails for actors in history leave this function.
create function indago.recent_history(p_record_id text default null)
returns table (
  id bigint,
  record_id text,
  actor_id uuid,
  actor_email text,
  changed_at timestamptz,
  before_edits jsonb,
  after_edits jsonb,
  version integer
) language sql stable security definer set search_path = '' as $$
  select h.id, h.record_id, h.actor_id, u.email::text, h.changed_at,
         h.before_edits, h.after_edits, h.version
  from indago.history h
  join auth.users u on u.id = h.actor_id
  where indago.is_member()
    and (p_record_id is null or h.record_id = p_record_id)
  order by h.id desc
  limit 50
$$;
revoke all on function indago.recent_history(text) from public;
grant execute on function indago.recent_history(text) to authenticated;
