-- Accounts v2: replies, pinned songs, the public page, synced settings and
-- history. Runs after test_policies.sql (which creates the people).
\set A '''00000000-0000-0000-0000-00000000000a'''
\set B '''00000000-0000-0000-0000-00000000000b'''
\set C '''00000000-0000-0000-0000-00000000000c'''

-- Replies: only the recipient replies; the sender is told once.
reset role;
insert into song_shares (from_user, to_user, track) values (:A, :B, '{"key":"a::song","title":"Song"}');
select tests.act(:A);
update song_shares set reply = 'from the sender' where to_user = :B;
select tests.check((select reply is null from song_shares where to_user = :B), 'the sender cannot write the reply');
select tests.act(:B);
update song_shares set reply = 'love it' where to_user = :B;
select tests.check((select reply = 'love it' and replied_at is not null from song_shares where to_user = :B), 'the recipient replies');
select tests.fails($$update song_shares set reply = repeat('x', 201) where to_user = '00000000-0000-0000-0000-00000000000b'$$, 'check');
update song_shares set reply = 'love it!!' where to_user = :B;
select tests.act(:A);
select tests.check(tests.count($$select 1 from notifications where kind = 'share_reply'$$) = 1, 'the sender is told once');
select tests.check((select data->>'reply' from notifications where kind = 'share_reply') = 'love it', 'with the reply');
select tests.act(:C);
select tests.check(tests.count($$select 1 from notifications where kind = 'share_reply'$$) = 0, 'nobody else sees it');

-- Pinned songs: your own, at most five.
select tests.act(:A);
update profiles set pinned = '[{"key":"a::1"},{"key":"a::2"}]' where id = :A;
select tests.check((select jsonb_array_length(pinned) from profiles where id = :A) = 2, 'pin songs');
select tests.fails($$update profiles set pinned = '[{},{},{},{},{},{}]' where id = '00000000-0000-0000-0000-00000000000a'$$, 'check');
select tests.act(:B);
update profiles set pinned = '[]' where id = :A;
select tests.check((select jsonb_array_length(pinned) from profiles where id = :A) = 2, 'nobody else changes your pins');

-- The public page: nothing until it's turned on; stats only if shared.
select tests.act(null);
select tests.check(public_profile(:A) is null, 'no public page by default');
select tests.act(:A);
update profiles set public_page = true, share_stats = false where id = :A;
select tests.act(null);
select tests.check(public_profile(:A)->>'name' = 'Alex', 'public page: anyone sees the name');
select tests.check(jsonb_array_length(public_profile(:A)->'pinned') = 2, 'and the pinned songs');
select tests.check(public_profile(:A)->'top_artists' = 'null'::jsonb or public_profile(:A)->'top_artists' is null, 'no stats unless shared');
select tests.check(public_profile(:B) is null, 'others stay private');

-- Synced settings: yours only.
select tests.act(:A);
insert into user_sync (settings, artists) values ('{"theme":"midnight"}', '[{"name":"Daft Punk"}]');
select tests.check(tests.count('select 1 from user_sync') = 1, 'save your settings');
select tests.act(:B);
select tests.check(tests.count('select 1 from user_sync') = 0, 'others cannot see them');
select tests.fails($$insert into user_sync (user_id, settings) values ('00000000-0000-0000-0000-00000000000a', '{}')$$, 'row-level security');
update user_sync set settings = '{"theme":"evil"}';
select tests.act(:A);
select tests.check((select settings->>'theme' from user_sync) = 'midnight', 'nobody else changes them');

-- History from every device: yours only, one row per play.
select tests.act(:A);
insert into listen_history (device, played_at, seconds, track) values ('pc', '2026-11-28 10:00+00', 200, '{"key":"a::1"}');
insert into listen_history (device, played_at, seconds, track) values ('pc', '2026-11-28 10:00+00', 200, '{"key":"a::1"}') on conflict do nothing;
insert into listen_history (device, played_at, seconds, track) values ('phone', '2026-11-28 10:00+00', 100, '{"key":"a::1"}');
select tests.check(tests.count('select 1 from listen_history') = 2, 'a play is stored once per device');
select tests.act(:B);
select tests.check(tests.count('select 1 from listen_history') = 0, 'others see none of it');
select tests.fails($$insert into listen_history (user_id, device, played_at, seconds, track) values ('00000000-0000-0000-0000-00000000000a', 'x', now(), 1, '{}')$$, 'row-level security');
reset role;
