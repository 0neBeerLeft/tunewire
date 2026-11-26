-- Accounts v2: replies to shared songs, pinned songs, a public profile page,
-- settings and followed artists on every device, and listening history from
-- every device (for stats, Wrapped and mixes).

-- Replies to songs friends send you -------------------------------------------------------------
alter table public.song_shares add column reply text check (reply is null or char_length(reply) between 1 and 200);
alter table public.song_shares add column replied_at timestamptz;
grant update (reply) on public.song_shares to authenticated;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('follow_request', 'follow_accepted', 'playlist_activity', 'jam_started', 'song_shared', 'share_reply'));

-- The sender hears about a reply (once per share; editing it doesn't notify again).
create function public.song_share_reply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reply is distinct from old.reply then
    new.replied_at := case when new.reply is null then null else now() end;
    if new.reply is not null and old.reply is null then
      perform public.notify(new.from_user, 'share_reply', new.to_user,
        jsonb_build_object('share', new.id, 'title', left(coalesce(new.track->>'title', ''), 200), 'reply', new.reply));
    end if;
  end if;
  return new;
end $$;
create trigger song_share_reply before update on public.song_shares for each row execute function public.song_share_reply();

-- Profiles: pinned songs and the public page -------------------------------------------------------
alter table public.profiles add column pinned jsonb not null default '[]'::jsonb
  check (jsonb_typeof(pinned) = 'array' and jsonb_array_length(pinned) <= 5 and octet_length(pinned::text) < 20000);
-- Off until you turn it on: then anyone with the link sees your page (name,
-- picture, bio, pinned songs, badges, and your top artists if you share stats).
alter table public.profiles add column public_page boolean not null default false;
grant update (pinned, public_page) on public.profiles to authenticated;

create function public.public_profile(uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when p.public_page then jsonb_build_object(
    'id', p.id, 'name', p.name, 'avatar', p.avatar, 'banner', p.banner, 'accent_color', p.accent_color,
    'bio', p.bio, 'pronouns', p.pronouns, 'pinned', p.pinned,
    'badges', to_jsonb(public.profile_badges(p.id)),
    'followers', (select count(*) from follows f where f.followee = p.id and f.status = 'accepted'),
    'top_artists', case when p.share_stats then (select s.top_artists from profile_stats s where s.user_id = p.id) end,
    'top_tracks', case when p.share_stats then (select s.top_tracks from profile_stats s where s.user_id = p.id) end,
    'playlists', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title) order by l.updated_at desc), '[]'::jsonb)
      from (select id, title, updated_at from playlists where owner = p.id and visibility = 'public' and deleted_at is null order by updated_at desc limit 12) l)
  ) end
  from profiles p where p.id = uid
$$;
revoke execute on function public.public_profile(uuid) from public;
grant execute on function public.public_profile(uuid) to anon, authenticated;

-- Your settings and followed artists, the same on every device -------------------------------------
create table public.user_sync (
  user_id uuid primary key default auth.uid() references public.profiles on delete cascade,
  -- Look and sound: theme, equalizer, playback options (not device things like folders).
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) < 200000),
  -- [{name, thumbnail}]
  artists jsonb not null default '[]'::jsonb check (jsonb_typeof(artists) = 'array' and octet_length(artists::text) < 200000),
  updated_at timestamptz not null default now()
);
alter table public.user_sync enable row level security;
create policy "own sync data" on public.user_sync for all using (user_id = auth.uid() and public.signed_in()) with check (user_id = auth.uid());

-- Listening history from every device -----------------------------------------------------------------
create table public.listen_history (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  -- Which device played it (so a device doesn't import its own plays back).
  device text not null check (char_length(device) between 1 and 64),
  played_at timestamptz not null,
  -- How long it was listened to.
  seconds integer not null check (seconds between 0 and 86400),
  track jsonb not null check (octet_length(track::text) < 8000),
  unique (user_id, device, played_at)
);
create index listen_history_user on public.listen_history (user_id, played_at desc);
alter table public.listen_history enable row level security;
create policy "own history" on public.listen_history for select using (user_id = auth.uid());
create policy "add own history" on public.listen_history for insert with check (user_id = auth.uid() and public.signed_in());
create policy "clear own history" on public.listen_history for delete using (user_id = auth.uid());

-- The newest 20,000 plays are kept (about a year of heavy listening).
create function public.listen_history_trim() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if random() < 0.02 then
    delete from listen_history where user_id = new.user_id and id < (
      select id from listen_history where user_id = new.user_id order by id desc offset 20000 limit 1);
  end if;
  return new;
end $$;
create trigger listen_history_trim after insert on public.listen_history for each row execute function public.listen_history_trim();
