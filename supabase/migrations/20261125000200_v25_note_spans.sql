begin;
-- Keep chapter projections in refs for older readers and chapter lookup.
-- Logical objects exist only when a note contains at least one cross-chapter span.
alter table public.paper_v25_notes add column anchor_objects jsonb
  check (anchor_objects is null or (jsonb_typeof(anchor_objects) = 'array' and jsonb_array_length(anchor_objects) between 1 and 256));

create function public.paper_v25_note_legacy_refs_change() returns trigger
language plpgsql set search_path = ''
as $$
begin
  -- A cached v2 client can still edit text. If it actually changes refs,
  -- discard the obsolete grouping instead of resurrecting old associations.
  if new.refs is distinct from old.refs and new.anchor_objects is not distinct from old.anchor_objects then
    new.anchor_objects := null;
  end if;
  return new;
end;
$$;
revoke all on function public.paper_v25_note_legacy_refs_change() from public, anon, authenticated;
create trigger paper_v25_note_legacy_refs_change before update of refs on public.paper_v25_notes
  for each row execute function public.paper_v25_note_legacy_refs_change();

create function public.paper_v25_note_list_v2() returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('note_key',n.note_key,'refs',n.refs,'anchor_objects',n.anchor_objects,
    'body',n.body,'revision',n.revision) order by n.note_key),'[]'::jsonb)
  from public.paper_v25_notes n where n.user_id = (select auth.uid());
$$;
revoke all on function public.paper_v25_note_list_v2() from public, anon, authenticated;
grant execute on function public.paper_v25_note_list_v2() to authenticated;

create function public.paper_v25_note_write_v3(
  anchor_key text, anchors jsonb, note_body text, expected_revision integer, mutation_id uuid, anchor_objects jsonb
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  who uuid := auth.uid();
  saved public.paper_v25_notes%rowtype;
  ref jsonb;
  has_span boolean := false;
begin
  if who is null then raise insufficient_privilege using message = 'Login required'; end if;
  if anchor_key is null or length(anchor_key) > 4096 or anchor_key !~ '^[A-Z0-9.:-]+([|][A-Z0-9.:-]+)*$'
    or anchors is null or jsonb_typeof(anchors) <> 'array'
    or note_body is null or octet_length(note_body) > 400000
    or expected_revision is null or expected_revision < 0 or mutation_id is null then
    raise invalid_parameter_value using message = 'Invalid note';
  end if;
  if jsonb_array_length(anchors) not between 1 and 256 or octet_length(anchors::text) > 32768 then
    raise invalid_parameter_value using message = 'Invalid note anchors';
  end if;
  for ref in select value from jsonb_array_elements(anchors) loop
    if jsonb_typeof(ref) <> 'array' then raise invalid_parameter_value using message = 'Invalid note anchor'; end if;
    if jsonb_array_length(ref) not in (2,4) or jsonb_typeof(ref->0) <> 'string' or ref->>0 !~ '^[A-Z0-9]{3}$'
      or jsonb_typeof(ref->1) <> 'number' or ref->>1 !~ '^[1-9][0-9]{0,2}$' then
      raise invalid_parameter_value using message = 'Invalid note anchor';
    end if;
    if jsonb_array_length(ref)=4 then
      if jsonb_typeof(ref->2) <> 'number' or jsonb_typeof(ref->3) <> 'number'
        or ref->>2 !~ '^[1-9][0-9]{0,2}$' or ref->>3 !~ '^[1-9][0-9]{0,2}$' then
        raise invalid_parameter_value using message = 'Invalid verse number';
      end if;
      if (ref->>2)::integer > (ref->>3)::integer then raise invalid_parameter_value using message = 'Invalid verse range'; end if;
    end if;
  end loop;
  if anchor_objects is not null then
    if jsonb_typeof(anchor_objects) <> 'array' then raise invalid_parameter_value using message = 'Invalid note objects'; end if;
    if jsonb_array_length(anchor_objects) not between 1 and 256 or octet_length(anchor_objects::text) > 32768 then
      raise invalid_parameter_value using message = 'Invalid note objects';
    end if;
    for ref in select value from jsonb_array_elements(anchor_objects) loop
      if jsonb_typeof(ref) <> 'array' then raise invalid_parameter_value using message = 'Invalid note object'; end if;
      if jsonb_array_length(ref) in (2,4) and anchors @> jsonb_build_array(ref) then continue; end if;
      if jsonb_array_length(ref) <> 5 or coalesce(ref->>0,'') !~ '^[A-Z0-9]{3}$'
        or jsonb_typeof(ref->0) <> 'string' then
        raise invalid_parameter_value using message = 'Invalid note span';
      end if;
      if exists (select 1 from jsonb_array_elements(ref) with ordinality as part(value, n)
          where n>1 and (jsonb_typeof(value) <> 'number' or value::text !~ '^[1-9][0-9]{0,2}$')) then
        raise invalid_parameter_value using message = 'Invalid note span boundaries';
      end if;
      if (ref->>1)::integer >= (ref->>3)::integer
        or not exists (select 1 from jsonb_array_elements(anchors) as a(value)
          where jsonb_array_length(value)=4 and value->0=ref->0 and value->1=ref->1 and value->2=ref->2)
        or not exists (select 1 from jsonb_array_elements(anchors) as a(value)
          where jsonb_array_length(value)=4 and value->0=ref->0 and value->1=ref->3 and value->3=ref->4) then
        raise invalid_parameter_value using message = 'Note span does not match chapter projections';
      end if;
      has_span:=true;
    end loop;
    if not has_span then raise invalid_parameter_value using message = 'No span in note objects'; end if;
  end if;
  if expected_revision = 0 then
    insert into public.paper_v25_notes(user_id,note_key,refs,body,revision,last_mutation,anchor_objects)
      values (who,anchor_key,anchors,note_body,1,mutation_id,anchor_objects)
      on conflict (user_id,note_key) do nothing returning * into saved;
  else
    update public.paper_v25_notes as n
      set refs=anchors,body=note_body,revision=n.revision+1,last_mutation=mutation_id,anchor_objects=paper_v25_note_write_v3.anchor_objects
      where n.user_id=who and n.note_key=anchor_key and n.revision=expected_revision
      returning * into saved;
  end if;
  if found then return jsonb_build_object('ok',true,'revision',saved.revision); end if;
  select * into saved from public.paper_v25_notes as n where n.user_id=who and n.note_key=anchor_key;
  if saved.last_mutation=mutation_id and saved.revision=expected_revision+1 and saved.body=note_body and saved.refs=anchors
    and saved.anchor_objects is not distinct from anchor_objects then
    return jsonb_build_object('ok',true,'revision',saved.revision);
  end if;
  return jsonb_build_object('ok',false,'revision',coalesce(saved.revision,0),'body',coalesce(saved.body,''),'refs',saved.refs,'anchor_objects',saved.anchor_objects);
end;
$$;
revoke all on function public.paper_v25_note_write_v3(text,jsonb,text,integer,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.paper_v25_note_write_v3(text,jsonb,text,integer,uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
