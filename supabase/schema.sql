-- ============================================================
-- PROJECT EXTREME++ — community schema (Supabase / PostgreSQL)
-- ------------------------------------------------------------
-- Run this once in the Supabase SQL editor for a new project.
--
-- What this creates
--   * public.reviews        public, signed-in reviews
--   * public.bug_reports    private reports (author + community admins)
--   * public.chat_messages  public, signed-in general chat
--   * public.community_admins  optional moderator allowlist
--
-- Security model
--   * The site only ever receives the public "anon" / publishable key.
--   * Row Level Security is the boundary. Never ship a service_role key.
--   * Author name, avatar and provider are filled by a trigger from
--     auth.users, not trusted from the browser.
--   * The developer can read every bug report through the Supabase
--     dashboard (service role) without an extra policy. To read them
--     through the API while signed in, add yourself to community_admins.
--
-- After running this file:
--   1. Authentication → Providers → enable Google and/or GitHub.
--   2. Authentication → URL Configuration:
--        Site URL:      https://pandeyji-9.github.io/Extreme-plus-Web/
--        Redirect URLs: https://pandeyji-9.github.io/Extreme-plus-Web/
--                       http://localhost:8080/  (only if testing locally)
--   3. Paste the project URL and anon/publishable key into
--      assets/js/config.js → community.supabase.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Optional moderator allowlist
-- ------------------------------------------------------------
create table if not exists public.community_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

alter table public.community_admins enable row level security;
revoke all on public.community_admins from anon, authenticated;

-- Security-definer helper: avoids exposing the allowlist through RLS.
create or replace function public.is_community_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.community_admins
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_community_admin() from public;
grant execute on function public.is_community_admin() to authenticated;

-- Add the developer after signing in once:
--   insert into public.community_admins (user_id, note)
--   select id, 'developer'
--   from auth.users
--   where email = 'you@example.com'
--   on conflict (user_id) do nothing;

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text not null default 'Rider',
  author_avatar text,
  provider text,
  rating smallint not null check (rating between 1 and 5),
  body text not null check (char_length(btrim(body)) between 20 and 1200),
  rom text not null check (char_length(btrim(rom)) between 1 and 80),
  root_flavor text not null check (char_length(btrim(root_flavor)) between 1 and 40),
  build text not null check (char_length(btrim(build)) between 1 and 64),
  created_at timestamptz not null default now()
);

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text not null default 'Rider',
  author_email text,
  provider text,
  title text not null check (char_length(btrim(title)) between 8 and 120),
  device text not null check (char_length(btrim(device)) between 2 and 80),
  rom text not null check (char_length(btrim(rom)) between 1 and 80),
  root_flavor text not null check (char_length(btrim(root_flavor)) between 1 and 40),
  build text not null check (char_length(btrim(build)) between 1 and 64),
  description text not null check (char_length(btrim(description)) between 30 and 3000),
  logs text check (logs is null or char_length(logs) <= 4000),
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text not null default 'Rider',
  author_avatar text,
  provider text,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists reviews_created_at_idx
  on public.reviews (created_at desc);
create index if not exists reviews_user_created_idx
  on public.reviews (user_id, created_at desc);

create index if not exists bug_reports_created_at_idx
  on public.bug_reports (created_at desc);
create index if not exists bug_reports_user_created_idx
  on public.bug_reports (user_id, created_at desc);

create index if not exists chat_messages_created_at_idx
  on public.chat_messages (created_at desc);
create index if not exists chat_messages_user_created_idx
  on public.chat_messages (user_id, created_at desc);

-- ------------------------------------------------------------
-- Trusted author metadata + simple abuse limits
-- ------------------------------------------------------------
create or replace function public.fill_community_author()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  profile record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  -- Identity, author metadata and timestamps are server-owned. A client
  -- cannot backdate a row to bypass rate limits or set its own status.
  new.user_id := auth.uid();
  new.created_at := now();

  select
    coalesce(
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(u.raw_user_meta_data ->> 'name', ''),
      nullif(u.raw_user_meta_data ->> 'user_name', ''),
      nullif(u.raw_user_meta_data ->> 'preferred_username', ''),
      nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
      'Rider'
    ) as display_name,
    coalesce(
      nullif(u.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(u.raw_user_meta_data ->> 'picture', '')
    ) as avatar,
    coalesce(
      (
        select i.provider
        from auth.identities i
        where i.user_id = u.id
        order by i.last_sign_in_at desc nulls last
        limit 1
      ),
      nullif(u.raw_app_meta_data ->> 'provider', '')
    ) as provider,
    u.email
  into profile
  from auth.users u
  where u.id = auth.uid();

  if not found then
    raise exception 'Authenticated user was not found.' using errcode = '42501';
  end if;

  new.author_name := left(coalesce(profile.display_name, 'Rider'), 80);
  new.provider := profile.provider;

  if tg_table_name = 'bug_reports' then
    new.author_email := profile.email;
    new.status := 'open';
    new.updated_at := now();
  else
    new.author_avatar := profile.avatar;
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
begin
  if tg_table_name = 'chat_messages' then
    select count(*) into recent_count
    from public.chat_messages
    where user_id = new.user_id
      and created_at > now() - interval '5 seconds';

    if recent_count >= 1 then
      raise exception 'Please wait a few seconds between chat messages.' using errcode = 'PT429';
    end if;

    select count(*) into recent_count
    from public.chat_messages
    where user_id = new.user_id
      and created_at > now() - interval '1 hour';

    if recent_count >= 40 then
      raise exception 'Hourly chat limit reached. Try again later.' using errcode = 'PT429';
    end if;

  elsif tg_table_name = 'reviews' then
    select count(*) into recent_count
    from public.reviews
    where user_id = new.user_id
      and created_at > now() - interval '24 hours';

    if recent_count >= 2 then
      raise exception 'Review limit reached. Try again tomorrow.' using errcode = 'PT429';
    end if;

  elsif tg_table_name = 'bug_reports' then
    select count(*) into recent_count
    from public.bug_reports
    where user_id = new.user_id
      and created_at > now() - interval '24 hours';

    if recent_count >= 5 then
      raise exception 'Bug report limit reached. Try again tomorrow.' using errcode = 'PT429';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Trigger names are deliberately ordered (a_ then b_): PostgreSQL fires
-- same-timing triggers in name order, so author data exists before the
-- rate-limit query runs.
drop trigger if exists a_fill_community_author_reviews on public.reviews;
create trigger a_fill_community_author_reviews
  before insert on public.reviews
  for each row execute function public.fill_community_author();

drop trigger if exists b_rate_limit_reviews on public.reviews;
create trigger b_rate_limit_reviews
  before insert on public.reviews
  for each row execute function public.enforce_community_rate_limit();

drop trigger if exists a_fill_community_author_bugs on public.bug_reports;
create trigger a_fill_community_author_bugs
  before insert on public.bug_reports
  for each row execute function public.fill_community_author();

drop trigger if exists b_rate_limit_bugs on public.bug_reports;
create trigger b_rate_limit_bugs
  before insert on public.bug_reports
  for each row execute function public.enforce_community_rate_limit();

drop trigger if exists c_touch_bug_updated_at on public.bug_reports;
create trigger c_touch_bug_updated_at
  before update on public.bug_reports
  for each row execute function public.touch_updated_at();

drop trigger if exists a_fill_community_author_chat on public.chat_messages;
create trigger a_fill_community_author_chat
  before insert on public.chat_messages
  for each row execute function public.fill_community_author();

drop trigger if exists b_rate_limit_chat on public.chat_messages;
create trigger b_rate_limit_chat
  before insert on public.chat_messages
  for each row execute function public.enforce_community_rate_limit();

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------
alter table public.reviews enable row level security;
alter table public.bug_reports enable row level security;
alter table public.chat_messages enable row level security;

-- Reviews: everyone can read; only signed-in users can add their own.
drop policy if exists "reviews are public" on public.reviews;
create policy "reviews are public"
  on public.reviews
  for select
  to anon, authenticated
  using (true);

drop policy if exists "signed-in users can publish reviews" on public.reviews;
create policy "signed-in users can publish reviews"
  on public.reviews
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Bug reports: private to the author and community admins.
drop policy if exists "authors and admins can read bug reports" on public.bug_reports;
create policy "authors and admins can read bug reports"
  on public.bug_reports
  for select
  to authenticated
  using (auth.uid() = user_id or public.is_community_admin());

drop policy if exists "signed-in users can send bug reports" on public.bug_reports;
create policy "signed-in users can send bug reports"
  on public.bug_reports
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Chat: everyone can read; only signed-in users can add messages.
drop policy if exists "chat is public" on public.chat_messages;
create policy "chat is public"
  on public.chat_messages
  for select
  to anon, authenticated
  using (true);

drop policy if exists "signed-in users can chat" on public.chat_messages;
create policy "signed-in users can chat"
  on public.chat_messages
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- API grants (RLS still applies)
-- ------------------------------------------------------------
revoke all on public.reviews from anon, authenticated;
grant select on public.reviews to anon, authenticated;
grant insert on public.reviews to authenticated;

revoke all on public.bug_reports from anon, authenticated;
grant select, insert on public.bug_reports to authenticated;

revoke all on public.chat_messages from anon, authenticated;
grant select on public.chat_messages to anon, authenticated;
grant insert on public.chat_messages to authenticated;

-- ------------------------------------------------------------
-- Optional realtime publication
-- ------------------------------------------------------------
-- The site polls, so this is not required. Uncomment if you later add a
-- realtime client. Wrapped so a missing publication does not fail the run.
-- do $$
-- begin
--   if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
--     alter publication supabase_realtime add table public.chat_messages;
--     alter publication supabase_realtime add table public.reviews;
--   end if;
-- exception
--   when duplicate_object then null;
-- end $$;
