-- ============================================================
-- PROJECT EXTREME++ — fix admin removal audit
-- Apply after 20261125_community_moderation.sql.
--
-- PostgreSQL does not assign NEW in a DELETE trigger. The original
-- audit function read NEW.user_id before checking TG_OP, which could
-- abort "Remove admin" with "record new is not assigned yet".
-- ============================================================

create or replace function public.log_community_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_username text;
  v_action text;
  v_role text;
  v_note text;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
    v_action := 'admin_removed';
    v_role := old.role;
    v_note := old.note;
  else
    v_user_id := new.user_id;
    v_action := case when tg_op = 'INSERT' then 'admin_added' else 'admin_updated' end;
    v_role := new.role;
    v_note := new.note;
  end if;

  select username into v_username
  from public.community_profiles
  where user_id = v_user_id;

  insert into public.community_moderation_log (
    actor_id, action, target_user_id, target_table, target_id, details
  )
  values (
    auth.uid(),
    v_action,
    v_user_id,
    'community_admins',
    v_user_id::text,
    jsonb_build_object(
      'username', v_username,
      'role', v_role,
      'note', v_note
    )
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.log_community_admin_change()
  from public, anon, authenticated;
