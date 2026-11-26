-- ============================================================
-- PROJECT EXTREME++ — profile activity shows chat attachments
-- Apply after 20261126_community_attachments.sql.
--
-- The public profile feed keeps returning only safe fields, but now
-- includes attachment metadata so attachment-only messages do not render
-- as blank cards.
-- ============================================================

create or replace function public.community_get_profile(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  p public.community_profiles%rowtype;
begin
  if p_username is null or btrim(p_username) = '' then
    return null;
  end if;

  select * into p
  from public.community_profiles
  where lower(username) = lower(btrim(p_username))
  limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'username', p.username,
    'display_name', p.display_name,
    'bio', p.bio,
    'avatar_url', p.avatar_url,
    'provider', p.provider,
    'joined_at', p.created_at,
    'online', (p.last_seen_at is not null and p.last_seen_at > now() - interval '15 minutes'),
    'reviews', (select count(*) from public.reviews where user_id = p.user_id),
    'chat_messages', (select count(*) from public.chat_messages where user_id = p.user_id),
    'recent_reviews', coalesce((
      select jsonb_agg(x)
      from (
        select id, rating, body, rom, root_flavor, build, created_at
        from public.reviews
        where user_id = p.user_id
        order by created_at desc
        limit 5
      ) x
    ), '[]'::jsonb),
    'recent_chat', coalesce((
      select jsonb_agg(x)
      from (
        select id, body, attachment_name, attachment_kind, created_at
        from public.chat_messages
        where user_id = p.user_id
        order by created_at desc
        limit 5
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.community_get_profile(text) from public;
grant execute on function public.community_get_profile(text) to anon, authenticated;
