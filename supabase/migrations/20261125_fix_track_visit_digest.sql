-- Fix: pgcrypto lives in the extensions schema on Supabase.
-- This replaces the visit tracker with the schema-qualified digest call.

create or replace function public.community_track_visit(
  p_visitor_id text,
  p_path text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_path text;
  v_hash text;
begin
  if p_visitor_id is null
    or char_length(p_visitor_id) < 16
    or char_length(p_visitor_id) > 64 then
    return;
  end if;

  v_path := left(coalesce(nullif(btrim(p_path), ''), '/'), 200);
  if left(v_path, 1) <> '/' then
    v_path := '/' || v_path;
  end if;

  v_hash := encode(
    extensions.digest(p_visitor_id || '|' || current_date::text, 'sha256'),
    'hex'
  );

  if exists (
    select 1
    from public.site_visits
    where visitor_hash = v_hash
      and path = v_path
      and created_at > now() - interval '30 minutes'
  ) then
    return;
  end if;

  insert into public.site_visits (visitor_hash, path, user_id)
  values (v_hash, v_path, auth.uid());
end;
$$;

revoke all on function public.community_track_visit(text, text) from public;
grant execute on function public.community_track_visit(text, text) to anon, authenticated;
