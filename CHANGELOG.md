# Changelog

Each release's section is used as its GitHub release notes and shown in the
app's update and "What's new" dialogs. Keep entries short and user-facing.

## Unreleased

**Songs start much faster**
- A YouTube song starts in about half a second instead of about 3 seconds: Tunewire now asks YouTube for the audio itself instead of starting yt-dlp for every song (yt-dlp stays as the fallback)
- Songs that were prepared ahead (next in the queue, the one you hover, the top search result) start almost at once, in about 0.05 s
- A Spotify song played for the first time starts in under a second (it was about 4.5 s)
- On Android the difference is even bigger: songs no longer wait for yt-dlp on the phone
- Connections stay open between songs, so the next one doesn't start from scratch

**Songs play reliably, start to finish**
- YouTube and YouTube Music songs no longer stop partway through: they play from YouTube's HLS audio, which plays to the end (YouTube now cuts off many direct links after about a minute)
- If a link stops working mid-song anyway, Tunewire fetches a new one and carries on
- No more 20-second waits: every Spotify song in our test of 20 played, the slowest in under 4 seconds (it used to be 20 s, and 1 in 4 didn't play at all)
- Skipping is instant more often: the next three songs are prepared while one plays, and links are kept as long as they're valid
- A source that keeps failing is skipped right away instead of holding things up

**Better matches**
- Spotify songs that are only on YouTube as a music video (like "Hotline Bling") play now
- A live recording is no longer played in place of the studio version
- Full Spotify albums, not just the first 50 songs
- yt-dlp keeps itself up to date and gets a JavaScript runtime, so YouTube works more reliably

**Looks**
- New artist page: a big header with the artist's photo, Popular next to their latest release, videos, related artists and an About card; the Videos section only shows the artist's own videos
- New sleep timer: a countdown ring, +15 min and Turn off, and it doesn't cover the player
- Hovering the song that's playing shows pause (and pauses it) instead of restarting it
- The playlist shuffle button works every time
- Songs without a cover get a generated one instead of a grey box
- Tidier player bar, window buttons, empty and error screens, and rounder corners that match everywhere

**Fixes**
- Phones with an older Android WebView: opening Settings no longer fills the screen with "Something went wrong" errors (the equalizer graph), and the graph stops working in the background when you leave Settings (saves battery)
- Your Library's Recents order is the playlists you played last, first, and it's kept after a restart; opening a playlist no longer makes the list jump
- The buttons in the player bar line up (every group is the same height)
- Android: no more "Songs can't play right now" warning at startup when songs play fine
- Settings → Tools → Clear cache frees the space used for cover images, song links and temporary song files (your library and settings stay)
- Opening a share link (playlist, song, Listen together) asks once instead of twice

**Your own server**
- Accounts, friends and Listen together run on Tunewire's own server now (sign in once more after updating)
- Downloads and updates come from yuhron.site/tunewire
- The Windows installer refreshes the app icon, so the old logo no longer shows up after updating

**Android (new)**
- Tunewire for Android: the same app with a phone layout and a full-screen player, playback that keeps going with the screen off, and controls on the lock screen and notification

## v2.3.0

**New design**
- A black-and-white glass look, with adjustable glass transparency and a Daily Mix banner on Home
- Colors from the cover is now an option you turn on (Settings → Appearance); the app starts black and white
- A black-and-white logo and app icon to match

**Equalizer**
- A new parametric-style equalizer: drag colored bands on a graph of the real curve; double-click resets a band, scroll fine-tunes
- While a song plays, its sound moves behind the curve

**Polish**
- Dropdowns and menus redone: every dropdown (presets, devices, settings) opens the app's own menu with a checkmark on the current choice; the device picker shows each output clearly
- Dialogs have a close button and clearer layout; less glare on panels, buttons, title boxes and dialogs
- Play buttons on playlist, album, mix and artist pages (and the Home banner) show pause while their music plays
- Big artwork comes alive while its song plays
- Home: Recently played as tidy tiles, even stat tiles, four Quick picks
- Stats: a proper listening-time chart (scale, empty days as dots, hover values) and a tidier layout
- Even spacing around the panels, the player bar and on playlist pages

- Friends and Listen together are pages in the sidebar (no longer tabs in the side panel)
- The bell is your notifications; bell, settings and account sit together in one bar; a new logo lockup
- Settings: each section is a card, with a bar to jump between them
- Dialogs are solid and easy to read; the first-start question gives you time to read it

**Backgrounds and Listen together**
- New animated backgrounds, all black and white: Rain on glass, Hyperspace (speeds up with the music) and Lava lamp
- Listen together: a new page to start or join a session and see friends who are live; while you're in a session it sits in the side panel next to the song; a Together button in the player bar shows who's listening
- A new sleep timer with a live countdown, presets and any length you like
- Page titles sit flat on the page; quieter song-list headers; pill-style source and range switches

- Emoji everywhere (reactions, badges, the leaderboard, chat) are crisp 3D Fluent emoji; reactions float up from where they're sent
- Listen together opens as its own panel in the right column; the Together button or × switches back to the song

**And more**
- Stars and Snow backgrounds redrawn: depth, twinkling and shooting stars, soft drifting snow; visible under the whole app, and lighter on the GPU
- The player bar is a floating glass dock
- The plugins page shows each plugin as a proper card with its settings
- At least three Daily Mixes, even when the artists you play are all close to each other


**The whole app matches the background**
- Panels, menus, text and highlights take their colors from the background: the playing song's cover, or your own picture, fading from song to song. Settings → Appearance → Colors from the background
- See-through panels: the background shows through the whole app, and the panels take the colors you actually see behind them (a black-and-white cover gives a grey app, a colorful one a colorful app)
- Dialogs and menus are frosted glass over a blurred backdrop

**New logo**
- A new app icon and logo: one wire drawn as sound waves. The logo in the title bar is sharp at any size and takes the app's colors

## v2.2.0

**New: Discover, made from your taste**
- A Discover page in the sidebar, built from the artists and songs you play most, your liked songs and the artists you follow
- Picked for you: songs that fit everything you like, new every day
- "Because you listened to…" rows, new releases from your artists and the artists closest to them, and artists you might like (with who they're like)
- New here? Pick a few artists you like and the page fills up right away
- Surprise me plays something new that fits your taste

**Sound**
- Fixed songs sometimes sounding distorted and "bass boosted". Songs with a quiet intro were turned up for their whole length; loudness is now measured on the loud part of the song, songs are turned up at most a little, and a smooth limiter replaces the hard clipping
- Crossfades keep an even volume through the middle, and pause along with the music
- The equalizer no longer adds low-end noise, and boosting bands leaves enough headroom
- YouTube songs no longer play in a low-quality format that sounded muffled

**Fixes**
- Songs no longer glitch or repeat a part when a server ignores seek requests
- SoundCloud songs ride out short network drops instead of stopping
- A crash in one background task no longer closes the app
- Arrow keys and Space work on focused sliders and checkboxes instead of seeking or pausing
- Pressing → several times quickly skips the full amount
- Clicking a song while the queue changes plays the song you clicked

## v2.1.0

**Your library on all your devices**
- Turn on Settings → Account → Sync my library: your playlists and Liked Songs (with their covers, folders and pins) show up on every computer you sign in to. The online copies are private.
- Changes made offline go out when you're back, even after closing the app
- Playlists you share or collaborate on now stay in sync between your own computers too
- New: a quick tour of what an account adds (Listen Together, friends, your library everywhere), shown once if you're not signed in

**Playback**
- Seeking in SoundCloud songs no longer waits for everything before that point
- After a seek, the old audio stops right away instead of playing on for a moment
- The progress bar stays right when a seek fails
- When headphones or a USB/Bluetooth device disappear, playback continues on the current output instead of sitting silent
- Songs keep starting fast if yt-dlp's helper process crashes
- YouTube songs start about a second sooner: Tunewire's own yt-dlp copy runs on Python when it's installed (Linux, macOS; switched automatically), and looking up a song skips loading its web page
- Songs no longer break off on slow connections

**Search and profiles**
- Search suggestions now show songs, artists and albums with their pictures while you type; Enter plays a song (Ctrl+Enter adds it to the queue)
- Set your own profile picture and banner, GIFs included. Your Discord picture and banner are only used when you join; after that they change only when you change them
- Songs whose YouTube picture is gone show a clean placeholder instead of a gray box

**Faster and sturdier**
- Searching All no longer waits about 2 seconds extra when YouTube has nothing to show for a song
- Searches with Spotify stay fast after the app sat idle for an hour
- Listen Together, listening along and notifications catch up on anything they missed while the connection was down
- Searching All shows its results within about 5 seconds even when one source is slow
- Liking songs, editing playlists and starting songs no longer wait for the disk
- Signed out, only names and pictures are visible: bios, pronouns and what you share need a signed-in account (share links still work)

## v2.0.1

A big one: a new social side, a safer online service, a Mac version, and a smoother, sturdier app.

**Friends**
- Profiles with your Discord banner, colors and avatar decoration, badges, a bio and pronouns, what you're playing, your top artists and songs (if you share them), mutual friends and a taste match
- Send a song to a friend with a note; it lands in their Inbox, where they can react
- Listen along with a friend: your player follows theirs, no session needed
- See who's online, what they're playing and how far in, plus a weekly leaderboard
- Notifications for follow requests, songs sent to you, changes to shared playlists and friends starting a session

**Listening together**
- Listen Together, rebuilt: only the host controls playback; the host can hand over, remove people and approve suggested songs; everyone can chat and vote to skip; you can keep your own room link
- Shared playlists show whether they're synced and who's editing, with a Retry when something didn't sync; renames and covers reach everyone

**Privacy and safety**
- Accounts sign in with Discord (guest accounts are gone)
- People need your approval to follow you; sharing what you play and your listening stats is off until you turn it on
- Links ask before joining a playlist or session or playing a song
- Error reports are off unless you turn them on

**New**
- Scrobble to Last.fm and ListenBrainz
- Back up your whole library to one file and restore it; a damaged library repairs itself from a daily copy
- Theme and plugin gallery
- Undo after deleting a playlist, removing songs or clearing history
- A new full-screen lyrics view with the cover and playback controls
- New app icon and website
- Tunewire for Mac (Apple Silicon and Intel)

**Smoother**
- No more flickering on Linux with NVIDIA graphics
- Smoother scrolling in long playlists; no blinking covers, menus or backgrounds
- Spotify import works again: sign-in no longer gets stuck, and your playlists and Liked Songs are read without hitting Spotify's rate limits
- Imported Spotify songs start sooner
- Keyboard navigation in song lists, screen reader labels, and a compact player bar in narrow windows

## v1.0.4

- Accounts: sign in (or continue as a guest) to share and listen together; your music still lives on your computer
- Share a song or a playlist with a link; people can open it, save it, or follow it to get your updates
- Collaborative playlists: invite friends, everyone adds, removes and reorders songs, changes show up live
- Listen Together: start a session, send the link, everyone hears the same song at the same moment; guests add songs and send reactions
- Friends: see what people you follow are playing, find people, profile pages, compare your Wrapped
- Much faster: search across all sources in about half a second, SoundCloud songs start in under half a second, artist and album pages in under a second
- Spotify imports: your whole library (Liked Songs and playlists) or someone's public playlists, now without developer keys
- Far less memory: right-sized covers, long lists load as you scroll, no live blur
- Smoother: no flicker when animations end or when reordering a playlist; download button fills up as a playlist downloads
- Error reports help fix problems faster (can be turned off in Settings → Privacy)
- Updates are checked every hour

## v1.0.3

- New look: your own title bar, Your Library sidebar (pins, folders, filters, sort), big playlist headers in the cover's color, Spotify-style song rows and player bar
- Now Playing view with a big cover, About the artist and what's next; full screen player
- Artist and album pages load in under a second, with Popular, Discography and Fans also like
- Search shows a top result, songs, artists, albums and playlists; Browse all moods and genres
- Import your whole Spotify library (Liked Songs + playlists, private ones too), Apple Music links and CSV files
- Imported Spotify songs are matched to YouTube Music in the background, so they start instantly
- Select several songs (Shift/Ctrl-click) and drag songs onto playlists, the queue, or to reorder
- Search and sort inside playlists, date added, smart shuffle, shuffle mode, sleep timer
- Edit playlist details: name, description and your own cover picture
- If yt-dlp is missing, one click installs it
- Linux builds are back (AppImage, .deb, .rpm)

## v1.0.2

- Home: a new start page with Daily Mixes, Discover Weekly (new songs every Monday), On Repeat and Forgotten favorites
- Your stats: minutes listened, top artists and songs, listening streaks, time of day, for 4 weeks, 6 months, this year or all time
- Wrapped: your year in music as a story, with a share image and a "top songs" playlist
- Media keys and the Windows media overlay now control Tunewire (play/pause, next, previous, seek)
- Updates download in the background and install when you restart
- Playlist recommendations, with "Because of …" reasons
- New Ambient look: soft background from the playing song's cover, panels and smoother motion
- Songs start much faster, often almost instantly
