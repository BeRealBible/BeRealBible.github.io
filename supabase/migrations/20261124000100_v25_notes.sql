begin;
-- Private notes are independent of the existing progress/highlights table.
create table public.paper_v25_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  note_key text not null check (length(note_key) between 1 and 4096),
  refs jsonb not null check (jsonb_typeof(refs) = 'array' and jsonb_array_length(refs) between 1 and 256),
  body text not null check (octet_length(body) <= 400000),
  revision integer not null check (revision > 0),
  last_mutation uuid not null,
  primary key (user_id, note_key)
);

alter table public.paper_v25_notes enable row level security;
alter table public.paper_v25_notes force row level security;
revoke all on public.paper_v25_notes from public, anon, authenticated;
grant select, insert, update on public.paper_v25_notes to authenticated;

create policy paper_v25_note_select_own on public.paper_v25_notes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy paper_v25_note_insert_own on public.paper_v25_notes for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy paper_v25_note_update_own on public.paper_v25_notes for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function public.paper_v25_note_list() returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('note_key',n.note_key,'refs',n.refs,'body',n.body,'revision',n.revision)
    order by n.note_key),'[]'::jsonb)
  from public.paper_v25_notes as n where n.user_id = (select auth.uid());
$$;

create function public.paper_v25_note_write(
  anchor_key text, anchors jsonb, note_body text, expected_revision integer, mutation_id uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  who uuid := auth.uid();
  saved public.paper_v25_notes%rowtype;
begin
  if who is null then raise insufficient_privilege using message = 'Login required'; end if;
  if anchor_key is null or anchor_key !~ '^[A-Z0-9.:-]+([|][A-Z0-9.:-]+)*$' or length(anchor_key) > 4096
    or anchors is null or jsonb_typeof(anchors) <> 'array'
    or note_body is null or octet_length(note_body) > 400000
    or expected_revision is null or expected_revision < 0 or mutation_id is null then
    raise invalid_parameter_value using message = 'Invalid note';
  end if;
  if jsonb_array_length(anchors) not between 1 and 256 or octet_length(anchors::text) > 32768 then
    raise invalid_parameter_value using message = 'Too many note anchors';
  end if;
  if expected_revision = 0 then
    insert into public.paper_v25_notes(user_id,note_key,refs,body,revision,last_mutation)
      values (who,anchor_key,anchors,note_body,1,mutation_id)
      on conflict (user_id,note_key) do nothing returning * into saved;
  else
    update public.paper_v25_notes as n
      set body=note_body,revision=n.revision+1,last_mutation=mutation_id
      where n.user_id=who and n.note_key=anchor_key and n.revision=expected_revision and n.refs=anchors
      returning * into saved;
  end if;
  if found then return jsonb_build_object('ok',true,'revision',saved.revision); end if;
  select * into saved from public.paper_v25_notes as n where n.user_id=who and n.note_key=anchor_key;
  if saved.last_mutation=mutation_id and saved.revision=expected_revision+1 and saved.body=note_body and saved.refs=anchors then
    return jsonb_build_object('ok',true,'revision',saved.revision);
  end if;
  return jsonb_build_object('ok',false,'revision',coalesce(saved.revision,0),'body',coalesce(saved.body,''));
end;
$$;

revoke all on function public.paper_v25_note_list() from public, anon, authenticated;
revoke all on function public.paper_v25_note_write(text,jsonb,text,integer,uuid) from public, anon, authenticated;
grant execute on function public.paper_v25_note_list() to authenticated;
grant execute on function public.paper_v25_note_write(text,jsonb,text,integer,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
