begin;

create table public.paper_v25_profiles (
  user_id uuid not null references auth.users(id) on delete cascade,
  edition text not null check (edition ~ '^[a-z0-9_-]{1,64}$'),
  state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 2097152),
  primary key (user_id, edition)
);

alter table public.paper_v25_profiles enable row level security;
alter table public.paper_v25_profiles force row level security;
revoke all on public.paper_v25_profiles from public, anon, authenticated;
grant select, insert, update on public.paper_v25_profiles to authenticated;

create policy paper_v25_select_own on public.paper_v25_profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy paper_v25_insert_own on public.paper_v25_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy paper_v25_update_own on public.paper_v25_profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Only the authenticated subject is used as owner. The caller cannot choose
-- a user ID. Independent keys merge atomically under the per-account row lock.
create function public.paper_v25_sync(edition_key text, changes jsonb, guest_import jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  who uuid := auth.uid();
  result jsonb;
begin
  if who is null then raise insufficient_privilege using message = 'Login required'; end if;
  if edition_key is null or edition_key !~ '^[a-z0-9_-]{1,64}$' or
    changes is null or guest_import is null or
    jsonb_typeof(changes) <> 'object' or jsonb_typeof(guest_import) <> 'object' or
    octet_length(changes::text) + octet_length(guest_import::text) > 2097152 then
    raise invalid_parameter_value using message = 'Invalid sync records';
  end if;
  if exists (
    select 1 from (
      select * from jsonb_each(changes)
      union all select * from jsonb_each(guest_import)
    ) as entry
    where entry.key !~ '^[a-zA-Z0-9:~_@.–-]{1,240}$'
      or right(entry.key, length(edition_key) + 1) <> (':' || edition_key)
      or entry.key !~ '^(paper-bible-position-v1:|paper-bible-(v25-(compare-)?trails|reading-history)-v1:|paper-bible-highlights-v1:)'
      or jsonb_typeof(entry.value) <> 'string' or octet_length(entry.value::text) > 393216
  ) then raise invalid_parameter_value using message = 'Invalid sync key or value'; end if;

  if changes = '{}'::jsonb and guest_import = '{}'::jsonb then
    select profiles.state into result from public.paper_v25_profiles as profiles
      where profiles.user_id = who and profiles.edition = edition_key;
  else
    insert into public.paper_v25_profiles as profiles (user_id, edition, state)
      values (who, edition_key, guest_import || changes)
    on conflict (user_id, edition) do update set state = guest_import || profiles.state || changes
    returning profiles.state into result;
  end if;
  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function public.paper_v25_sync(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.paper_v25_sync(text, jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
