-- ============================================================
-- PROJECT EXTREME++ — replies, pins, notifications & release watch
-- Apply after 20261125_community_channels_forwarding.sql.
--
-- Adds:
--   * reply-to metadata and a reply notification trigger
--   * one pinned message per public channel, staff controlled
--   * a private notifications inbox for replies and stable releases
--   * a release ledger + pg_cron/pg_net watcher for GitHub releases
--   * a staff-only release announcement RPC
--
-- Security model:
--   * Notifications and release tables are never exposed directly.
--   * RLS stays enabled; only security-definer RPCs touch these tables.
--   * Reply metadata, pin ownership and release fields are server-owned.
--   * The release watcher runs inside Postgres; no service_role key is
--     shipped to the browser.
-- ============================================================

create schema if not exists extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ------------------------------------------------------------
-- 1. Message metadata
-- ------------------------------------------------------------
alter table public.chat_messages
  add column if not exists reply_to_message_id uuid,
  add column if not exists reply_to_author_name text,
  add column if not exists reply_to_author_username text,
  add column if not exists reply_to_excerpt text,
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid references auth.users (id) on delete set null,
  add column if not exists is_release_announcement boolean not null default false,
  add column if not exists release_tag text,
  add column if not exists release_name text,
  add column if not exists release_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_messages_reply_fk'
      and conrelid = 'public.chat_messages'::regclass
  ) then
    alter table public.chat_messages
      add constraint chat_messages_reply_fk
      foreign key (reply_to_message_id)
      references public.chat_messages (id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_messages_pin_by_fk'
      and conrelid = 'public.chat_messages'::regclass
  ) then
    alter table public.chat_messages
      add constraint chat_messages_pin_by_fk
      foreign key (pinned_by)
      references auth.users (id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_messages_reply_meta_check'
      and conrelid = 'public.chat_messages'::regclass
  ) then
    alter table public.chat_messages
      add constraint chat_messages_reply_meta_check
      check (
        (reply_to_message_id is null or char_length(coalesce(reply_to_excerpt, '')) <= 240)
        and (reply_to_author_name is null or char_length(reply_to_author_name) <= 80)
        and (reply_to_author_username is null or char_length(reply_to_author_username) <= 20)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_messages_release_check'
      and conrelid = 'public.chat_messages'::regclass
  ) then
    alter table public.chat_messages
      add constraint chat_messages_release_check
      check (
        (release_tag is null or char_length(release_tag) <= 120)
        and (release_name is null or char_length(release_name) <= 160)
        and (release_url is null or char_length(release_url) <= 500)
      );
  end if;
end $$;

create index if not exists chat_messages_pinned_idx
  on public.chat_messages (channel, pinned_at desc)
  where pinned_at is not null;

create index if not exists chat_messages_reply_idx
  on public.chat_messages (reply_to_message_id)
  where reply_to_message_id is not null;

-- ------------------------------------------------------------
-- 2. Private notifications inbox
-- ------------------------------------------------------------
create table if not exists public.community_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('reply', 'release', 'system')),
  title text not null,
  body text not null default '',
  link text not null default './community.html',
  channel text,
  message_id uuid references public.chat_messages (id) on delete set null,
  actor_name text,
  actor_username text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists community_notifications_user_created_idx
  on public.community_notifications (user_id, created_at desc);

create index if not exists community_notifications_user_unread_idx
  on public.community_notifications (user_id)
  where read_at is null;

alter table public.community_notifications enable row level security;
revoke all on public.community_notifications from anon, authenticated;

-- ------------------------------------------------------------
-- 3. Release ledger + watcher state
-- ------------------------------------------------------------
create table if not exists public.community_release_events (
  tag text primary key,
  name text not null,
  url text not null,
  body text,
  published_at timestamptz,
  message_id uuid references public.chat_messages (id) on delete set null,
  announced_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.community_release_events enable row level security;
revoke all on public.community_release_events from anon, authenticated;

create table if not exists public.community_release_watch_state (
  id smallint primary key default 1 check (id = 1),
  request_id bigint,
  requested_at timestamptz,
  processed_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

insert into public.community_release_watch_state (id)
values (1)
on conflict (id) do nothing;

alter table public.community_release_watch_state enable row level security;
revoke all on public.community_release_watch_state from anon, authenticated;

-- ------------------------------------------------------------
-- 4. Trusted author trigger: reply metadata + release-safe actor
-- ------------------------------------------------------------
create or replace function public.fill_community_author()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  profile record;
  v_actor uuid := auth.uid();
  v_forwarding boolean := coalesce(current_setting('app.community_forward', true), '') = 'on';
  v_release boolean := coalesce(current_setting('app.community_release', true), '') = 'on';
  v_parent record;
begin
  -- The release watcher has no JWT. It sets a transaction-local actor UUID
  -- from inside a security-definer function; browsers cannot set this GUC.
  if v_actor is null then
    v_actor := nullif(current_setting('app.community_release_actor', true), '')::uuid;
  end if;

  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  perform public.ensure_community_profile(v_actor);

  select
    p.username,
    p.display_name,
    p.avatar_url,
    p.provider,
    u.email
  into profile
  from public.community_profiles p
  join auth.users u on u.id = p.user_id
  where p.user_id = v_actor;

  if not found then
    raise exception 'Community profile was not found.' using errcode = '42501';
  end if;

  new.user_id := v_actor;
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

    -- Replies may only point at a message in the same public channel.
    if new.reply_to_message_id is not null then
      if new.reply_to_message_id = new.id then
        raise exception 'You cannot reply to the same message.' using errcode = 'PT400';
      end if;

      select
        m.user_id,
        m.author_name,
        m.author_username,
        m.channel,
        left(regexp_replace(coalesce(m.body, ''), '\s+', ' ', 'g'), 180) as excerpt
      into v_parent
      from public.chat_messages m
      where m.id = new.reply_to_message_id;

      if not found then
        raise exception 'That message no longer exists.' using errcode = 'PT404';
      end if;

      if v_parent.channel <> new.channel then
        raise exception 'Reply in the same channel as the original message.' using errcode = 'PT400';
      end if;

      new.reply_to_author_name := left(coalesce(nullif(v_parent.author_name, ''), 'Rider'), 80);
      new.reply_to_author_username := nullif(left(coalesce(v_parent.author_username, ''), 20), '');
      new.reply_to_excerpt := v_parent.excerpt;
    else
      new.reply_to_author_name := null;
      new.reply_to_author_username := null;
      new.reply_to_excerpt := null;
    end if;

    -- Release and pin fields are server-owned.
    if not v_release then
      new.is_release_announcement := false;
      new.release_tag := null;
      new.release_name := null;
      new.release_url := null;
      new.pinned_at := null;
      new.pinned_by := null;
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
-- 5. Reply notification trigger
-- ------------------------------------------------------------
create or replace function public.community_notify_reply()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_parent_user uuid;
  v_excerpt text;
begin
  if new.reply_to_message_id is null then
    return new;
  end if;

  select user_id
  into v_parent_user
  from public.chat_messages
  where id = new.reply_to_message_id;

  if v_parent_user is null or v_parent_user = new.user_id then
    return new;
  end if;

  v_excerpt := left(regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g'), 220);

  insert into public.community_notifications (
    user_id,
    type,
    title,
    body,
    link,
    channel,
    message_id,
    actor_name,
    actor_username
  )
  values (
    v_parent_user,
    'reply',
    left(coalesce(new.author_name, 'Rider') || ' replied to you', 160),
    v_excerpt,
    './community.html#' || new.channel,
    new.channel,
    new.id,
    left(coalesce(new.author_name, 'Rider'), 80),
    nullif(left(coalesce(new.author_username, ''), 20), '')
  );

  return new;
end;
$$;

revoke all on function public.community_notify_reply()
  from public, anon, authenticated;

drop trigger if exists c_notify_chat_reply on public.chat_messages;
create trigger c_notify_chat_reply
  after insert on public.chat_messages
  for each row execute function public.community_notify_reply();

-- ------------------------------------------------------------
-- 6. Pin / unpin one message per public channel
-- ------------------------------------------------------------
create or replace function public.community_pin_message(
  p_message_id uuid,
  p_pinned boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.chat_messages%rowtype;
  v_pinned_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  if not public.is_community_admin() then
    raise exception 'Only staff can pin messages.' using errcode = '42501';
  end if;

  select * into v_row
  from public.chat_messages
  where id = p_message_id;

  if not found then
    raise exception 'That message no longer exists.' using errcode = 'PT404';
  end if;

  if v_row.channel not in ('general', 'releases', 'off-topic') then
    raise exception 'Only public channel messages can be pinned.' using errcode = 'PT400';
  end if;

  if coalesce(p_pinned, true) then
    update public.chat_messages
    set pinned_at = null, pinned_by = null
    where channel = v_row.channel
      and pinned_at is not null
      and id <> v_row.id;

    update public.chat_messages
    set pinned_at = now(), pinned_by = v_uid
    where id = v_row.id
    returning pinned_at into v_pinned_at;
  else
    update public.chat_messages
    set pinned_at = null, pinned_by = null
    where id = v_row.id;
    v_pinned_at := null;
  end if;

  return jsonb_build_object(
    'pinned', coalesce(p_pinned, true),
    'message_id', v_row.id,
    'channel', v_row.channel,
    'pinned_at', v_pinned_at
  );
end;
$$;

revoke all on function public.community_pin_message(uuid, boolean) from public;
grant execute on function public.community_pin_message(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- 7. Public pinned-message read
-- ------------------------------------------------------------
create or replace function public.community_channel_pinned(p_channel text)
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select jsonb_build_object(
    'id', m.id,
    'user_id', m.user_id,
    'author_name', m.author_name,
    'author_avatar', m.author_avatar,
    'author_username', m.author_username,
    'provider', m.provider,
    'body', m.body,
    'channel', m.channel,
    'created_at', m.created_at,
    'forwarded_from_message_id', m.forwarded_from_message_id,
    'forwarded_from_name', m.forwarded_from_name,
    'forwarded_from_username', m.forwarded_from_username,
    'forwarded_from_channel', m.forwarded_from_channel,
    'forwarded_at', m.forwarded_at,
    'reply_to_message_id', m.reply_to_message_id,
    'reply_to_author_name', m.reply_to_author_name,
    'reply_to_author_username', m.reply_to_author_username,
    'reply_to_excerpt', m.reply_to_excerpt,
    'pinned_at', m.pinned_at,
    'is_release_announcement', m.is_release_announcement,
    'release_tag', m.release_tag,
    'release_name', m.release_name,
    'release_url', m.release_url
  )
  from public.chat_messages m
  where m.channel = lower(btrim(coalesce(p_channel, '')))
    and m.channel in ('general', 'releases', 'off-topic')
    and m.pinned_at is not null
  order by m.pinned_at desc
  limit 1;
$$;

revoke all on function public.community_channel_pinned(text) from public;
grant execute on function public.community_channel_pinned(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 8. Notifications inbox RPCs
-- ------------------------------------------------------------
create or replace function public.community_get_notifications(p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 50));
  v_items jsonb;
  v_unread integer;
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  select count(*)
  into v_unread
  from public.community_notifications
  where user_id = v_uid
    and read_at is null;

  select coalesce(jsonb_agg(n order by created_at desc), '[]'::jsonb)
  into v_items
  from (
    select
      jsonb_build_object(
        'id', id,
        'type', type,
        'title', title,
        'body', body,
        'link', link,
        'channel', channel,
        'message_id', message_id,
        'actor_name', actor_name,
        'actor_username', actor_username,
        'created_at', created_at,
        'read_at', read_at
      ) as n,
      created_at
    from public.community_notifications
    where user_id = v_uid
    order by created_at desc
    limit v_limit
  ) s;

  return jsonb_build_object(
    'unread', v_unread,
    'items', v_items
  );
end;
$$;

revoke all on function public.community_get_notifications(integer) from public;
grant execute on function public.community_get_notifications(integer) to authenticated;

create or replace function public.community_mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  if p_ids is null or cardinality(p_ids) = 0 then
    update public.community_notifications
    set read_at = now()
    where user_id = v_uid
      and read_at is null;
  else
    update public.community_notifications
    set read_at = now()
    where user_id = v_uid
      and id = any(p_ids)
      and read_at is null;
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.community_mark_notifications_read(uuid[]) from public;
grant execute on function public.community_mark_notifications_read(uuid[]) to authenticated;

-- ------------------------------------------------------------
-- 9. Internal release publisher
-- ------------------------------------------------------------
create or replace function public.community_publish_release_internal(
  p_tag text,
  p_name text,
  p_url text,
  p_body text,
  p_published_at timestamptz,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_tag text := left(btrim(coalesce(p_tag, '')), 120);
  v_title text;
  v_url text;
  v_notes text;
  v_body text;
  v_actor uuid := p_actor;
  v_event public.community_release_events%rowtype;
  v_message public.chat_messages%rowtype;
  v_notifications integer := 0;
  v_published_at timestamptz := coalesce(p_published_at, now());
begin
  if v_tag = '' then
    return jsonb_build_object('created', false, 'reason', 'missing_tag');
  end if;

  select * into v_event
  from public.community_release_events
  where tag = v_tag;

  if found then
    return jsonb_build_object(
      'created', false,
      'reason', 'already_announced',
      'tag', v_tag,
      'message_id', v_event.message_id
    );
  end if;

  if v_actor is null then
    select user_id into v_actor
    from public.community_admins
    where role = 'owner'
    order by created_at asc
    limit 1;

    if v_actor is null then
      select user_id into v_actor
      from public.community_admins
      order by created_at asc
      limit 1;
    end if;
  end if;

  if v_actor is null then
    return jsonb_build_object('created', false, 'reason', 'no_staff_actor');
  end if;

  v_title := left(coalesce(nullif(btrim(p_name), ''), v_tag), 140);
  v_url := left(coalesce(nullif(btrim(p_url), ''), 'https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/releases'), 500);
  if v_url !~* '^https?://' then
    v_url := 'https://github.com/PandeyJI-9/Extreme-PLUS-kernel-munch/releases';
  end if;

  v_notes := left(coalesce(p_body, ''), 1200);
  v_body := left(
    v_title || E'\n\n' || left(v_notes, 260) || E'\n\n' || v_url,
    500
  );

  insert into public.community_release_events (
    tag,
    name,
    url,
    body,
    published_at,
    announced_by
  )
  values (
    v_tag,
    v_title,
    v_url,
    v_notes,
    v_published_at,
    v_actor
  )
  on conflict (tag) do nothing
  returning * into v_event;

  if not found then
    return jsonb_build_object(
      'created', false,
      'reason', 'already_announced',
      'tag', v_tag
    );
  end if;

  begin
    perform set_config('app.community_release_actor', v_actor::text, true);

    insert into public.chat_messages (channel, body)
    values ('releases', v_body)
    returning * into v_message;

    perform set_config('app.community_release_actor', '', true);

    update public.chat_messages
    set pinned_at = null, pinned_by = null
    where channel = 'releases'
      and pinned_at is not null
      and id <> v_message.id;

    update public.chat_messages
    set pinned_at = now(),
        pinned_by = v_actor,
        is_release_announcement = true,
        release_tag = v_tag,
        release_name = v_title,
        release_url = v_url
    where id = v_message.id
    returning * into v_message;

    insert into public.community_notifications (
      user_id,
      type,
      title,
      body,
      link,
      channel,
      message_id,
      actor_name,
      actor_username,
      read_at
    )
    select
      p.user_id,
      'release',
      left('New stable release: ' || v_title, 180),
      left(
        case
          when v_notes <> '' then v_notes
          else 'Open the Releases channel for the download and changelog.'
        end,
        240
      ),
      './community.html#releases',
      'releases',
      v_message.id,
      v_message.author_name,
      v_message.author_username,
      case when p.user_id = v_actor then now() else null end
    from public.community_profiles p;

    get diagnostics v_notifications = row_count;

    update public.community_release_events
    set message_id = v_message.id
    where tag = v_tag;
  exception
    when others then
      perform set_config('app.community_release_actor', '', true);
      delete from public.community_release_events where tag = v_tag;
      raise;
  end;

  return jsonb_build_object(
    'created', true,
    'tag', v_tag,
    'title', v_title,
    'message_id', v_message.id,
    'notifications', v_notifications
  );
end;
$$;

revoke all on function public.community_publish_release_internal(text, text, text, text, timestamptz, uuid)
  from public, anon, authenticated;

-- ------------------------------------------------------------
-- 10. Staff release announcement
-- ------------------------------------------------------------
create or replace function public.community_announce_release(
  p_tag text,
  p_name text,
  p_url text,
  p_body text,
  p_published_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  if not public.is_community_admin() then
    raise exception 'Only staff can announce releases.' using errcode = '42501';
  end if;

  return public.community_publish_release_internal(
    p_tag,
    p_name,
    p_url,
    p_body,
    p_published_at,
    v_uid
  );
end;
$$;

revoke all on function public.community_announce_release(text, text, text, text, timestamptz) from public;
grant execute on function public.community_announce_release(text, text, text, text, timestamptz) to authenticated;

-- ------------------------------------------------------------
-- 11. GitHub release watcher
-- ------------------------------------------------------------
create or replace function public.community_release_watch()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_state public.community_release_watch_state%rowtype;
  v_response record;
  v_release jsonb;
  v_request_id bigint;
  v_result jsonb;
  v_error text;
begin
  select * into v_state
  from public.community_release_watch_state
  where id = 1
  for update;

  if not found then
    insert into public.community_release_watch_state (id) values (1);
    select * into v_state
    from public.community_release_watch_state
    where id = 1
    for update;
  end if;

  if v_state.request_id is not null and v_state.processed_at is null then
    select * into v_response
    from net._http_response
    where id = v_state.request_id
    order by created desc
    limit 1;

    if not found then
      return jsonb_build_object(
        'status', 'waiting',
        'request_id', v_state.request_id
      );
    end if;

    if v_response.status_code = 200 and v_response.content is not null then
      begin
        select value into v_release
        from jsonb_array_elements(v_response.content::jsonb) with ordinality as t(value, ord)
        where coalesce((value ->> 'draft')::boolean, false) = false
          and coalesce((value ->> 'prerelease')::boolean, false) = false
        order by ord
        limit 1;

        if v_release is not null then
          v_result := public.community_publish_release_internal(
            v_release ->> 'tag_name',
            coalesce(v_release ->> 'name', v_release ->> 'tag_name'),
            v_release ->> 'html_url',
            v_release ->> 'body',
            nullif(v_release ->> 'published_at', '')::timestamptz,
            null
          );
        else
          v_result := jsonb_build_object('status', 'no_stable_release');
        end if;
      exception
        when others then
          v_error := SQLERRM;
          v_result := jsonb_build_object('status', 'parse_error', 'error', v_error);
      end;
    else
      v_error := coalesce(
        v_response.error_msg,
        'HTTP ' || coalesce(v_response.status_code::text, '?')
      );
      v_result := jsonb_build_object('status', 'http_error', 'error', v_error);
    end if;

    update public.community_release_watch_state
    set processed_at = now(), last_error = v_error, updated_at = now()
    where id = 1;
  else
    v_result := jsonb_build_object('status', 'idle');
  end if;

  begin
    v_request_id := net.http_get(
      url := 'https://api.github.com/repos/PandeyJI-9/Extreme-PLUS-kernel-munch/releases?per_page=5',
      headers := '{"Accept":"application/vnd.github+json","User-Agent":"EXTREME-plus-release-watch"}'::jsonb,
      timeout_milliseconds := 8000
    );

    update public.community_release_watch_state
    set request_id = v_request_id,
        requested_at = now(),
        processed_at = null,
        updated_at = now()
    where id = 1;
  exception
    when others then
      v_error := SQLERRM;
      update public.community_release_watch_state
      set last_error = v_error, updated_at = now()
      where id = 1;
  end;

  return coalesce(v_result, '{}'::jsonb)
    || jsonb_build_object('enqueued', v_request_id);
end;
$$;

revoke all on function public.community_release_watch()
  from public, anon, authenticated;

-- Schedule the watcher. Two runs are needed per cycle because pg_net
-- sends HTTP requests after the calling transaction commits: the first
-- run enqueues, the next run consumes the response.
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'extreme-release-watch') then
    perform cron.unschedule('extreme-release-watch');
  end if;

  perform cron.schedule(
    'extreme-release-watch',
    '*/10 * * * *',
    $$select public.community_release_watch();$$
  );
end $do$;

-- ------------------------------------------------------------
-- 12. Grants for the public read/write surface
-- ------------------------------------------------------------
revoke all on function public.community_channel_pinned(text) from public;
grant execute on function public.community_channel_pinned(text) to anon, authenticated;

revoke all on function public.community_pin_message(uuid, boolean) from public;
grant execute on function public.community_pin_message(uuid, boolean) to authenticated;

revoke all on function public.community_get_notifications(integer) from public;
grant execute on function public.community_get_notifications(integer) to authenticated;

revoke all on function public.community_mark_notifications_read(uuid[]) from public;
grant execute on function public.community_mark_notifications_read(uuid[]) to authenticated;

revoke all on function public.community_announce_release(text, text, text, text, timestamptz) from public;
grant execute on function public.community_announce_release(text, text, text, text, timestamptz) to authenticated;
