begin;
-- Count logical associations, not their per-chapter lookup projections.
-- Grandfather old notes: allow text edits and reductions without truncation.
create function public.paper_v25_note_max_places() returns trigger
language plpgsql set search_path = ''
as $$
declare
  next_count integer := jsonb_array_length(coalesce(new.anchor_objects,new.refs));
begin
  if next_count <= 10 then return new; end if;
  if tg_op = 'UPDATE' then
    if next_count <= jsonb_array_length(coalesce(old.anchor_objects,old.refs)) then return new; end if;
  end if;
  raise invalid_parameter_value using message = 'A note can have at most 10 scripture associations';
end;
$$;
revoke all on function public.paper_v25_note_max_places() from public, anon, authenticated;
-- Alphabetical trigger ordering: run after paper_v25_note_legacy_refs_change.
create trigger paper_v25_note_max_places before insert or update of refs, anchor_objects on public.paper_v25_notes
  for each row execute function public.paper_v25_note_max_places();
commit;
