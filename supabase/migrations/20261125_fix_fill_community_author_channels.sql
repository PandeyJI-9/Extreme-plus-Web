-- ============================================================
-- PROJECT EXTREME++ — restore username author metadata on channel chat
-- The channels migration replaced fill_community_author() with a version
-- that read raw auth metadata. This restores the profile-backed version
-- while keeping server-owned channels and forwarding attribution.
-- ============================================================

create or replace function public.fill_community_author()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  profile record;
  v_forwarding boolean := coalesce(current_setting('app.community_forward', true), '') = 'on';
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  perform public.ensure_community_profile(auth.uid());

  select
    p.username,
    p.display_name,
    p.avatar_url,
    p.provider,
    u.email
  into profile
  from public.community_profiles p
  join auth.users u on u.id = p.user_id
  where p.user_id = auth.uid();

  if not found then
    raise exception 'Community profile was not found.' using errcode = '42501';
  end if;

  -- Identity, author metadata and timestamps remain server-owned.
  new.user_id := auth.uid();
  new.created_at := now();

  if tg_table_name = 'chat_messages' then
    new.channel := coalesce(nullif(btrim(new.channel), ''), 'general');
    if new.channel not in ('general', 'releases', 'off-topic') then
      raise exception 'That chat channel does not exist.' using errcode = 'PT400';
    end if;

    -- Forward attribution is only writable through community_forward_message().
    if v_forwarding then
      new.forwarded_at := now();
    else
      new.forwarded_from_message_id := null;
      new.forwarded_from_name := null;
      new.forwarded_from_username := null;
      new.forwarded_from_channel := null;
      new.forwarded_at := null;
    end if;
  end if;

  new.author_name := left(coalesce(nullif(profile.display_name, ''), 'Rider'), 80);
  new.author_username := profile.username;
  new.provider := profile.provider;

  if tg_table_name = 'bug_reports' then
    new.author_email := profile.email;
    new.status := 'open';
    new.updated_at := now();
  else
    new.author_avatar := profile.avatar_url;
  end if;

  return new;
end;
$$;

revoke all on function public.fill_community_author()
  from public, anon, authenticated;
