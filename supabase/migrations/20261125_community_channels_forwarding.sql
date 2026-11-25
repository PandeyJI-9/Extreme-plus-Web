-- ============================================================
-- PROJECT EXTREME++ — community channels, forwarding & public members
-- Apply after 20261125_community_moderation.sql.
--
-- Adds:
--   * channel-scoped chat (general / releases / off-topic)
--   * server-validated message forwarding with attribution
--   * public member directory for the Telegram-style members panel
--   * per-channel totals and slow-mode hints in public stats
--   * self-service deletion for your own chat messages
--
-- Bug hunting is intentionally NOT a chat channel. Bug reports stay in the
-- private bug_reports table and are visible only to the author and staff.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Chat channels
-- ------------------------------------------------------------
alter table public.chat_messages
  add column if not exists channel text not null default 'general';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_messages_channel_check'
      and conrelid = 'public.chat_messages'::regclass
  ) then
    alter table public.chat_messages
      add constraint chat_messages_channel_check
      check (channel in ('general', 'releases', 'off-topic'));
  end if;
end $$;

create index if not exists chat_messages_channel_created_idx
  on public.chat_messages (channel, created_at desc);

-- ------------------------------------------------------------
-- 2. Forward metadata
-- ------------------------------------------------------------
alter table public.chat_messages
  add column if not exists forwarded_from_message_id uuid,
  add column if not exists forwarded_from_name text,
  add column if not exists forwarded_from_username text,
  add column if not exists forwarded_from_channel text,
  add column if not exists forwarded_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_messages_forwarded_check'
      and conrelid = 'public.chat_messages'::regclass
  ) then
    alter table public.chat_messages
      add constraint chat_messages_forwarded_check
      check (
        (forwarded_from_channel is null or forwarded_from_channel in ('general', 'releases', 'off-topic'))
        and (forwarded_from_name is null or char_length(forwarded_from_name) <= 80)
        and (forwarded_from_username is null or char_length(forwarded_from_username) <= 20)
      );
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. Keep forward attribution server-owned
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 4. Forward a public message to another public channel
-- ------------------------------------------------------------
create or replace function public.community_forward_message(
  p_message_id uuid,
  p_channel text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_channel text := lower(btrim(coalesce(p_channel, '')));
  v_src public.chat_messages%rowtype;
  v_row public.chat_messages%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  if v_channel not in ('general', 'releases', 'off-topic') then
    raise exception 'Choose a public chat channel.' using errcode = 'PT400';
  end if;

  select * into v_src
  from public.chat_messages
  where id = p_message_id;

  if not found then
    raise exception 'That message no longer exists.' using errcode = 'PT404';
  end if;

  if v_src.channel not in ('general', 'releases', 'off-topic') then
    raise exception 'That message cannot be forwarded.' using errcode = 'PT400';
  end if;

  perform set_config('app.community_forward', 'on', true);

  insert into public.chat_messages (
    channel,
    body,
    forwarded_from_message_id,
    forwarded_from_name,
    forwarded_from_username,
    forwarded_from_channel,
    forwarded_at
  )
  values (
    v_channel,
    v_src.body,
    v_src.id,
    left(coalesce(nullif(v_src.author_name, ''), 'Rider'), 80),
    nullif(left(coalesce(v_src.author_username, ''), 20), ''),
    v_src.channel,
    now()
  )
  returning * into v_row;

  perform set_config('app.community_forward', 'off', true);

  return jsonb_build_object(
    'id', v_row.id,
    'channel', v_row.channel,
    'body', v_row.body,
    'author_name', v_row.author_name,
    'author_avatar', v_row.author_avatar,
    'author_username', v_row.author_username,
    'provider', v_row.provider,
    'created_at', v_row.created_at,
    'forwarded_from_message_id', v_row.forwarded_from_message_id,
    'forwarded_from_name', v_row.forwarded_from_name,
    'forwarded_from_username', v_row.forwarded_from_username,
    'forwarded_from_channel', v_row.forwarded_from_channel,
    'forwarded_at', v_row.forwarded_at
  );
exception
  when others then
    perform set_config('app.community_forward', 'off', true);
    raise;
end;
$$;

revoke all on function public.community_forward_message(uuid, text) from public;
grant execute on function public.community_forward_message(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 5. Public stats: channel totals + slow-mode hints
-- ------------------------------------------------------------
create or replace function public.community_public_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select jsonb_build_object(
    'members', (select count(*) from public.community_profiles),
    'online', (
      select count(*)
      from public.community_profiles
      where last_seen_at > now() - interval '15 minutes'
    ),
    'visits', (select count(*) from public.site_visits),
    'unique_visitors', (select count(distinct visitor_hash) from public.site_visits),
    'visits_today', (
      select count(*) from public.site_visits where created_at >= current_date
    ),
    'logins', (select count(*) from public.community_login_events),
    'logins_today', (
      select count(*) from public.community_login_events where created_at >= current_date
    ),
    'reviews', (select count(*) from public.reviews),
    'chat', (select count(*) from public.chat_messages),
    'channels', (
      select coalesce(jsonb_object_agg(channel, n), '{}'::jsonb)
      from (
        select channel, count(*)::integer as n
        from public.chat_messages
        group by channel
      ) c
    ),
    'chat_slow_seconds', coalesce((
      select chat_slow_seconds from public.community_settings where id = 1
    ), 5),
    'chat_hourly_limit', coalesce((
      select chat_hourly_limit from public.community_settings where id = 1
    ), 40),
    'updated_at', now()
  );
$$;

revoke all on function public.community_public_stats() from public;
grant execute on function public.community_public_stats() to anon, authenticated;

-- ------------------------------------------------------------
-- 6. Public member directory (no emails, IDs or private fields)
-- ------------------------------------------------------------
create or replace function public.community_public_members(p_limit integer default 24)
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    jsonb_agg(m order by online desc, last_seen_at desc nulls last, created_at desc),
    '[]'::jsonb
  )
  from (
    select
      jsonb_build_object(
        'username', p.username,
        'display_name', p.display_name,
        'avatar_url', p.avatar_url,
        'provider', p.provider,
        'online', p.last_seen_at > now() - interval '15 minutes',
        'role', coalesce(a.role, 'member'),
        'joined_at', p.created_at
      ) as m,
      (p.last_seen_at > now() - interval '15 minutes') as online,
      p.last_seen_at,
      p.created_at
    from public.community_profiles p
    left join public.community_admins a on a.user_id = p.user_id
    order by
      (p.last_seen_at > now() - interval '15 minutes') desc,
      p.last_seen_at desc nulls last,
      p.created_at desc
    limit greatest(1, least(coalesce(p_limit, 24), 60))
  ) s;
$$;

revoke all on function public.community_public_members(integer) from public;
grant execute on function public.community_public_members(integer) to anon, authenticated;

-- ------------------------------------------------------------
-- 7. Authors may delete their own chat messages
-- ------------------------------------------------------------
drop policy if exists "authors can delete own chat messages" on public.chat_messages;
create policy "authors can delete own chat messages"
  on public.chat_messages
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 8. Verify default channel for any older rows
-- ------------------------------------------------------------
update public.chat_messages
set channel = 'general'
where channel is null or channel = '';
