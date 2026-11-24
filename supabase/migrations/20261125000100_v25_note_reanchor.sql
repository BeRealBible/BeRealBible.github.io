begin;
-- Keep v1 for cached readers. In v2 the existing note key is a stable ID,
-- while the location is replaced atomically under the same owner and revision.
create function public.paper_v25_note_write_v2(
  anchor_key text, anchors jsonb, note_body text, expected_revision integer, mutation_id uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  who uuid := auth.uid();
  saved public.paper_v25_notes%rowtype;
  ref jsonb;
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
  if expected_revision = 0 then
    insert into public.paper_v25_notes(user_id,note_key,refs,body,revision,last_mutation)
      values (who,anchor_key,anchors,note_body,1,mutation_id)
      on conflict (user_id,note_key) do nothing returning * into saved;
  else
    update public.paper_v25_notes as n
      set refs=anchors,body=note_body,revision=n.revision+1,last_mutation=mutation_id
      where n.user_id=who and n.note_key=anchor_key and n.revision=expected_revision
      returning * into saved;
  end if;
  if found then return jsonb_build_object('ok',true,'revision',saved.revision); end if;
  select * into saved from public.paper_v25_notes as n where n.user_id=who and n.note_key=anchor_key;
  if saved.last_mutation=mutation_id and saved.revision=expected_revision+1 and saved.body=note_body and saved.refs=anchors then
    return jsonb_build_object('ok',true,'revision',saved.revision);
  end if;
  return jsonb_build_object('ok',false,'revision',coalesce(saved.revision,0),'body',coalesce(saved.body,''),'refs',saved.refs);
end;
$$;
revoke all on function public.paper_v25_note_write_v2(text,jsonb,text,integer,uuid) from public, anon, authenticated;
grant execute on function public.paper_v25_note_write_v2(text,jsonb,text,integer,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
