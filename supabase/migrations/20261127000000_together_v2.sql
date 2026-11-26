-- Listen together v2: guest controls, taking turns, upvotes, and a host who
-- vanishes (app closed, phone died) is replaced automatically.

-- Options the host sets (only the host may update a session, see "host controls").
alter table public.jams add column guest_controls boolean not null default false;
alter table public.jams add column take_turns boolean not null default false;
-- When the host's app last wrote to the session (stamped by the server).
alter table public.jams add column host_seen timestamptz not null default now();
grant update (guest_controls, take_turns) on public.jams to authenticated;

-- upvote: {key}, a song in the session queue; control: {op, key?, to?}, a
-- guest asking the host's app to change the queue (only obeyed while the
-- host has guest controls on).
alter table public.jam_events drop constraint jam_events_kind_check;
alter table public.jam_events add constraint jam_events_kind_check
  check (kind in ('suggest', 'chat', 'vote_skip', 'upvote', 'control'));

create or replace function public.jam_event_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from jam_events where code = new.code and user_id = new.user_id and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'slow down a little';
  end if;
  if new.kind = 'chat' then
    if char_length(coalesce(new.payload->>'text', '')) not between 1 and 300 then raise exception 'messages are 1-300 characters'; end if;
    new.payload := jsonb_build_object('text', new.payload->>'text');
  end if;
  if new.kind in ('vote_skip', 'upvote') then
    new.payload := jsonb_build_object('key', left(coalesce(new.payload->>'key', ''), 300));
  end if;
  if new.kind = 'control' then
    if coalesce(new.payload->>'op', '') not in ('skip', 'remove', 'move', 'play') then raise exception 'unknown control'; end if;
    new.payload := jsonb_strip_nulls(jsonb_build_object(
      'op', new.payload->>'op',
      'key', left(new.payload->>'key', 300),
      'to', case when jsonb_typeof(new.payload->'to') = 'number' then least(greatest((new.payload->>'to')::numeric, 0), 500)::int end));
  end if;
  delete from jam_events where code = new.code and created_at < now() - interval '1 day';
  return new;
end $$;

-- Every write by the host marks the host as present.
create or replace function public.jam_touch() returns trigger
language plpgsql as $$
begin
  if new.state is distinct from old.state then new.state_at := clock_timestamp(); end if;
  if auth.uid() is not null and auth.uid() = new.host then new.host_seen := now(); end if;
  new.updated_at := now();
  return new;
end $$;

-- A member takes over hosting when the host has been silent for 25 s (the
-- host's app writes at least every 10 s). The first member to ask wins.
create function public.jam_claim_host(jam_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare j jams;
begin
  if not public.signed_in() then raise exception 'sign in first'; end if;
  select * into j from jams where code = jam_code and active for update;
  if not found then return false; end if;
  if j.host = auth.uid() then return true; end if;
  if not exists (select 1 from jam_members where code = jam_code and user_id = auth.uid()) then return false; end if;
  if j.host_seen > now() - interval '25 seconds' then return false; end if;
  update jams set host = auth.uid(), host_seen = now(), updated_at = now() where code = jam_code;
  return true;
end $$;
revoke execute on function public.jam_claim_host(text) from public, anon;
grant execute on function public.jam_claim_host(text) to authenticated;

-- A hand-over counts as the new host being present.
create or replace function public.jam_handoff(jam_code text, new_host uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from jams where code = jam_code and host = auth.uid()) then raise exception 'only the host can do that'; end if;
  if not exists (select 1 from jam_members where code = jam_code and user_id = new_host) then raise exception 'they are not in the session'; end if;
  update jams set host = new_host, host_seen = now(), updated_at = now() where code = jam_code;
end $$;
