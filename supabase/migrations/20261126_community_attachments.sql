-- ============================================================
-- PROJECT EXTREME++ — public chat attachments
-- Apply after 20261126_community_replies_notifications.sql.
--
-- Adds:
--   * one attachment per public chat message (photo, video or any file)
--   * a 2 MB hard limit enforced by Postgres and Supabase Storage
--   * a public Storage bucket with authenticated, owner-scoped uploads
--   * server-owned attachment metadata so clients cannot forge paths
--   * attachment forwarding and attachment-aware reply excerpts
--   * a release-watcher fix so server-side announcements bypass the
--     interactive ban/rate-limit triggers safely
--
-- Security model:
--   * Attachments are only accepted in public channels.
--   * A client may upload only into its own Storage folder.
--   * The database stores the object path, never a client-supplied URL.
--   * Staff can delete any attachment; authors can clean up their own.
--   * No service_role key is shipped to the browser.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Message attachment metadata
-- ------------------------------------------------------------
alter table public.chat_messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text,
  add column if not exists attachment_size bigint,
  add column if not exists attachment_kind text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_messages_attachment_check'
      and conrelid = 'public.chat_messages'::regclass
  ) then
    alter table public.chat_messages
      add constraint chat_messages_attachment_check
      check (
        (
          attachment_path is null
          and attachment_name is null
          and attachment_type is null
          and attachment_size is null
          and attachment_kind is null
        )
        or (
          attachment_path is not null
          and attachment_name is not null
          and attachment_type is not null
          and attachment_size between 1 and 2097152
          and attachment_kind in ('image', 'video', 'file')
          and char_length(attachment_path) between 38 and 180
          and char_length(attachment_name) between 1 and 160
          and char_length(attachment_type) between 1 and 120
        )
      );
  end if;
end $$;

alter table public.chat_messages
  alter column body set default '';

alter table public.chat_messages
  drop constraint if exists chat_messages_body_check;

alter table public.chat_messages
  add constraint chat_messages_body_check
  check (
    char_length(body) <= 500
    and (char_length(btrim(body)) >= 1 or attachment_path is not null)
  );

create index if not exists chat_messages_attachment_idx
  on public.chat_messages (attachment_path)
  where attachment_path is not null;

-- ------------------------------------------------------------
-- 2. Trusted author trigger: attachment validation + reply excerpts
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
  v_attachment_path text;
  v_attachment_type text;
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
        left(
          regexp_replace(
            coalesce(nullif(m.body, ''), m.attachment_name, 'Attachment'),
            '\s+', ' ', 'g'
          ),
          180
        ) as excerpt
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

    -- Attachment metadata is server-owned. Store only a Storage object path;
    -- clients never get to supply a URL or a path outside their own folder.
    v_attachment_path := nullif(btrim(coalesce(new.attachment_path, '')), '');
    if v_attachment_path is null then
      new.attachment_path := null;
      new.attachment_name := null;
      new.attachment_type := null;
      new.attachment_size := null;
      new.attachment_kind := null;
    else
      if v_forwarding then
        if v_attachment_path !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$' then
          raise exception 'Attachment path is not valid.' using errcode = 'PT400';
        end if;
      elsif v_attachment_path !~ ('^' || v_actor::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$') then
        raise exception 'Attachment path is not valid.' using errcode = 'PT400';
      end if;

      if new.attachment_size is null or new.attachment_size < 1 then
        raise exception 'Attachment size is missing.' using errcode = 'PT400';
      end if;
      if new.attachment_size > 2097152 then
        raise exception 'Attachments must be 2 MB or smaller.' using errcode = 'PT400';
      end if;

      new.attachment_path := v_attachment_path;
      new.attachment_name := left(
        coalesce(
          nullif(
            btrim(regexp_replace(coalesce(new.attachment_name, ''), '[\r\n\t]+', ' ', 'g')),
            ''
          ),
          'Attachment'
        ),
        160
      );

      v_attachment_type := lower(left(btrim(coalesce(new.attachment_type, '')), 120));
      if v_attachment_type = ''
        or v_attachment_type !~ '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$'
      then
        v_attachment_type := 'application/octet-stream';
      end if;

      new.attachment_type := v_attachment_type;
      new.attachment_kind := case
        when v_attachment_type in ('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif') then 'image'
        when v_attachment_type like 'video/%' then 'video'
        else 'file'
      end;
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
-- 3. Reply notification trigger: attachment-only replies
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

  v_excerpt := left(
    regexp_replace(
      coalesce(nullif(new.body, ''), new.attachment_name, 'Sent an attachment'),
      '\s+', ' ', 'g'
    ),
    220
  );

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

-- ------------------------------------------------------------
-- 4. Forwarding preserves attachments
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

  if btrim(coalesce(v_src.body, '')) = '' and v_src.attachment_path is null then
    raise exception 'That message has nothing to forward.' using errcode = 'PT400';
  end if;

  perform set_config('app.community_forward', 'on', true);

  insert into public.chat_messages (
    channel,
    body,
    attachment_path,
    attachment_name,
    attachment_type,
    attachment_size,
    forwarded_from_message_id,
    forwarded_from_name,
    forwarded_from_username,
    forwarded_from_channel,
    forwarded_at
  )
  values (
    v_channel,
    v_src.body,
    v_src.attachment_path,
    v_src.attachment_name,
    v_src.attachment_type,
    v_src.attachment_size,
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
    'attachment_path', v_row.attachment_path,
    'attachment_name', v_row.attachment_name,
    'attachment_type', v_row.attachment_type,
    'attachment_size', v_row.attachment_size,
    'attachment_kind', v_row.attachment_kind,
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
-- 5. Pinned message payload includes attachments
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
    'attachment_path', m.attachment_path,
    'attachment_name', m.attachment_name,
    'attachment_type', m.attachment_type,
    'attachment_size', m.attachment_size,
    'attachment_kind', m.attachment_kind,
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
-- 6. Server-side release inserts bypass interactive ban/rate checks
-- ------------------------------------------------------------
create or replace function public.enforce_community_ban()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    v_actor := nullif(current_setting('app.community_release_actor', true), '')::uuid;
  end if;

  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.community_bans
    where user_id = v_actor
      and active
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'Your account is restricted from posting in the community.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_community_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_count integer;
  v_chat_slow integer := 5;
  v_chat_hourly integer := 40;
  v_reviews integer := 2;
  v_bugs integer := 5;
begin
  -- Release announcements are generated by the trusted watcher, not a
  -- browser, so they must not consume or be blocked by chat slow mode.
  if coalesce(current_setting('app.community_release_actor', true), '') <> '' then
    return new;
  end if;

  select
    chat_slow_seconds,
    chat_hourly_limit,
    reviews_per_day,
    bugs_per_day
  into v_chat_slow, v_chat_hourly, v_reviews, v_bugs
  from public.community_settings
  where id = 1;

  if tg_table_name = 'chat_messages' then
    select count(*) into recent_count
    from public.chat_messages
    where user_id = new.user_id
      and created_at > now() - make_interval(secs => v_chat_slow);

    if recent_count >= 1 then
      raise exception 'Please wait a few seconds between chat messages.'
        using errcode = 'PT429';
    end if;

    select count(*) into recent_count
    from public.chat_messages
    where user_id = new.user_id
      and created_at > now() - interval '1 hour';

    if recent_count >= v_chat_hourly then
      raise exception 'Hourly chat limit reached. Try again later.'
        using errcode = 'PT429';
    end if;

  elsif tg_table_name = 'reviews' then
    if v_reviews <= 0 then
      raise exception 'Reviews are currently paused. Try again later.'
        using errcode = 'PT429';
    end if;

    select count(*) into recent_count
    from public.reviews
    where user_id = new.user_id
      and created_at > now() - interval '24 hours';

    if recent_count >= v_reviews then
      raise exception 'Review limit reached. Try again tomorrow.'
        using errcode = 'PT429';
    end if;

  elsif tg_table_name = 'bug_reports' then
    if v_bugs <= 0 then
      raise exception 'Bug reports are currently paused. Try again later.'
        using errcode = 'PT429';
    end if;

    select count(*) into recent_count
    from public.bug_reports
    where user_id = new.user_id
      and created_at > now() - interval '24 hours';

    if recent_count >= v_bugs then
      raise exception 'Bug report limit reached. Try again tomorrow.'
        using errcode = 'PT429';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_community_ban()
  from public, anon, authenticated;
revoke all on function public.enforce_community_rate_limit()
  from public, anon, authenticated;

-- ------------------------------------------------------------
-- 7. Public attachment bucket (2 MB, every file type)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-attachments', 'community-attachments', true, 2097152, null)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Community attachments read" on storage.objects;
create policy "Community attachments read"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'community-attachments');

drop policy if exists "Community attachments upload" on storage.objects;
create policy "Community attachments upload"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'community-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Community attachments delete" on storage.objects;
create policy "Community attachments delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'community-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_community_admin()
    )
  );

-- ------------------------------------------------------------
-- 8. Report previews include attachment-only messages
-- ------------------------------------------------------------
create or replace function public.community_report_content(
  p_target_type text,
  p_target_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_target_user uuid;
  v_author text;
  v_excerpt text;
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  v_count integer;
  v_limit integer := 5;
  v_row public.community_reports%rowtype;
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.community_bans
    where user_id = v_uid
      and active
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'Your account is restricted from reporting content.'
      using errcode = '42501';
  end if;
  if char_length(v_reason) < 5 then
    raise exception 'Give a short reason of at least 5 characters.'
      using errcode = 'PT400';
  end if;

  if p_target_type = 'review' then
    select user_id, coalesce(nullif(author_username, ''), author_name), left(body, 240)
    into v_target_user, v_author, v_excerpt
    from public.reviews
    where id = p_target_id;
  elsif p_target_type = 'chat' then
    select user_id,
           coalesce(nullif(author_username, ''), author_name),
           left(coalesce(nullif(btrim(body), ''), attachment_name, ''), 240)
    into v_target_user, v_author, v_excerpt
    from public.chat_messages
    where id = p_target_id;
  else
    raise exception 'Invalid report target.' using errcode = 'PT400';
  end if;

  if not found then
    raise exception 'That content no longer exists.' using errcode = 'PT404';
  end if;
  if v_target_user = v_uid then
    raise exception 'You cannot report your own content.' using errcode = 'PT400';
  end if;

  select coalesce(reports_per_day, 5) into v_limit
  from public.community_settings
  where id = 1;

  select count(*) into v_count
  from public.community_reports
  where reporter_id = v_uid
    and created_at > now() - interval '24 hours';

  if v_count >= v_limit then
    raise exception 'Report limit reached. Try again tomorrow.'
      using errcode = 'PT429';
  end if;

  insert into public.community_reports (
    reporter_id, reporter_name, target_type, target_id, target_user_id,
    target_author, target_excerpt, reason
  )
  values (
    v_uid,
    coalesce((select username from public.community_profiles where user_id = v_uid), 'Rider'),
    p_target_type,
    p_target_id,
    v_target_user,
    v_author,
    v_excerpt,
    v_reason
  )
  on conflict (reporter_id, target_type, target_id) do update
    set reason = excluded.reason,
        status = 'open',
        created_at = now(),
        resolved_at = null,
        resolved_by = null
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'created_at', v_row.created_at
  );
end;
$$;

revoke all on function public.community_report_content(text, uuid, text) from public;
grant execute on function public.community_report_content(text, uuid, text) to authenticated;
