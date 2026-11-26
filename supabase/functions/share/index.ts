// Link previews for shared Tunewire links.
//
// Chat apps (Discord, WhatsApp, iMessage, Slack…) read Open Graph tags from
// the page a link points to, and the GitHub Pages landing page can't vary
// them per playlist (its routes are #fragments). Links made through this
// function get a real title, description and cover in the preview; people
// who click are sent on to the landing page right away.
//
//   <base>/p/<playlist id>   <base>/s/<song code>   <base>/u/<user id>
//   (a person who turned on their public page gets a real page at /u/)
//   <base>/j/<code>          <base>/c/<code>        <base>/img/p/<id>
//
// Supabase rewrites text/html from *.supabase.co to text/plain, so this must
// be served from a custom domain (or any Deno host; it has no Supabase-only
// code). Set SHARE_PUBLIC_URL to the address it's served at, and build the
// app with TUNEWIRE_SHARE_URL set to the same.

const LANDING = "https://yuhron.site/tunewire/";
const DEFAULT_IMAGE = `${LANDING}og.png`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE = /^[A-Za-z0-9_-]{1,4000}$/;

export interface Env {
  supabaseUrl?: string;
  anonKey?: string;
  /** Where this function is reachable, e.g. https://share.tunewire.app */
  publicUrl?: string;
}

export interface Preview {
  kind: string;
  title: string;
  description: string;
  image: string;
  /** Where people who click end up. */
  target: string;
  large: boolean;
}

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Only web images can be preview images. */
const httpsImage = (u: unknown) => (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : "");
// A profile picture or banner: Discord's address, or "media:<user id>/<file>"
// (an upload in the public profile-media bucket).
const profileImage = (u: unknown, env: Env) => {
  const m = typeof u === "string" && u.match(/^media:([0-9a-f-]{36}\/[0-9a-f]{16,64}\.(png|jpg|webp|gif))$/);
  return m ? `${env.supabaseUrl}/storage/v1/object/public/profile-media/${m[1]}` : httpsImage(u);
};

function b64urlJson(code: string): Record<string, unknown> | null {
  try {
    const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const o = JSON.parse(new TextDecoder().decode(bytes));
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

/** /share/p/<id> or /functions/v1/share/p/<id> → ["p", "<id>"] */
export function route(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean);
  const i = parts.indexOf("share");
  return i >= 0 ? parts.slice(i + 1) : parts;
}

async function rest(env: Env, path: string, f: typeof fetch, body?: unknown) {
  const r = await f(`${env.supabaseUrl}/rest/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: { apikey: env.anonKey!, Authorization: `Bearer ${env.anonKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function preview(kind: string, code: string, env: Env, f: typeof fetch = fetch): Promise<Preview> {
  const base = (env.publicUrl || "").replace(/\/$/, "");
  const target = `${LANDING}#${kind}=${encodeURIComponent(code)}`;
  const generic: Preview = { kind, title: "Tunewire", description: "A free music player for YouTube Music, SoundCloud, YouTube and Spotify.", image: DEFAULT_IMAGE, target, large: true };

  if (kind === "p" && UUID.test(code)) {
    const [p] = await rest(env, "rpc/playlist_preview", f, { pid: code }).catch(() => []);
    if (!p) return { ...generic, title: "Playlist on Tunewire", description: "This playlist is private or no longer shared." };
    const by = p.owner_name ? ` · by ${p.owner_name}` : "";
    const desc = p.description ? ` · ${p.description}` : "";
    const image = p.has_cover && base ? `${base}/img/p/${code}` : httpsImage(p.thumbnail) || DEFAULT_IMAGE;
    return { kind, title: clip(p.title, 100), description: clip(`Playlist · ${p.songs} song${p.songs === 1 ? "" : "s"}${by}${desc}`, 200), image, target, large: false };
  }
  if (kind === "s" && CODE.test(code)) {
    const o = b64urlJson(code);
    if (!o || typeof o.t !== "string") return generic;
    return { kind, title: clip(o.t, 100), description: clip(`Song${typeof o.a === "string" && o.a ? ` · ${o.a}` : ""} · Listen on Tunewire`, 200), image: httpsImage(o.i) || DEFAULT_IMAGE, target, large: false };
  }
  if (kind === "u" && UUID.test(code)) {
    // Signed out, profiles are readable only through this (a few public fields).
    const [p] = await rest(env, "rpc/profile_preview", f, { uid: code }).catch(() => []);
    if (!p) return generic;
    const banner = profileImage(p.banner, env);
    return { kind, title: clip(`${p.name} on Tunewire`, 100), description: "See their public playlists, followers and who they follow.", image: banner || profileImage(p.avatar, env) || DEFAULT_IMAGE, target, large: !!banner };
  }
  if (kind === "j") return { ...generic, title: "Listen together on Tunewire", description: "You're invited to a listening session: everyone hears the same song at the same moment." };
  if (kind === "c") return { ...generic, title: "Join a collaborative playlist", description: "You're invited to add songs to a playlist together on Tunewire." };
  return generic;
}

/** A public profile (public_profile() returns null unless the person turned it on). */
export interface PublicProfile {
  id: string;
  name: string;
  avatar?: string | null;
  banner?: string | null;
  accent_color?: number | null;
  bio?: string;
  pronouns?: string;
  pinned?: Array<Record<string, unknown>>;
  badges?: string[];
  followers?: number;
  top_artists?: Array<{ name?: string; thumbnail?: string }> | null;
  top_tracks?: Array<Record<string, unknown>> | null;
  playlists?: Array<{ id: string; title: string }>;
}

const BADGES: Record<string, [string, string]> = {
  developer: ["🛠️", "Tunewire developer"], early: ["🌱", "Early adopter"], social: ["🤝", "Social"], curator: ["📀", "Curator"],
  host: ["🎧", "Host"], connector: ["💌", "Connector"], streak7: ["🔥", "7-day streak"], streak30: ["☄️", "30-day streak"],
  night_owl: ["🦉", "Night owl"], early_bird: ["🐦", "Early bird"], explorer: ["🧭", "Explorer"],
};

/** A song as a /s/ link code (the same format the app makes). */
function songCode(t: Record<string, unknown>): string {
  const versions = Array.isArray(t.versions) ? t.versions : [];
  const v = versions
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as Record<string, unknown>).url === "string" && /^https:\/\//.test((x as Record<string, unknown>).url as string))
    .slice(0, 3).map((x) => [x.platform, x.url]);
  const o = { t: t.title, a: t.artist, d: t.duration, i: t.thumbnail, v };
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function profilePage(pp: PublicProfile, env: Env, selfUrl: string): string {
  const base = (env.publicUrl || "").replace(/\/$/, "");
  const link = (kind: string, code: string) => (base ? `${base}/${kind}/${encodeURIComponent(code)}` : `${LANDING}#${kind}=${encodeURIComponent(code)}`);
  const name = clip(String(pp.name || "Someone"), 40);
  const avatar = profileImage(pp.avatar, env);
  const banner = profileImage(pp.banner, env);
  const accent = typeof pp.accent_color === "number" && pp.accent_color >= 0 && pp.accent_color <= 0xffffff ? `#${pp.accent_color.toString(16).padStart(6, "0")}` : "#4d8dff";
  const song = (t: Record<string, unknown>) => {
    if (!t || typeof t.title !== "string") return "";
    const img = httpsImage(t.thumbnail);
    return `<a class="song" href="${esc(link("s", songCode(t)))}">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<span class="ph">♪</span>`}<span><b>${esc(clip(t.title, 100))}</b><small>${esc(clip(String(t.artist || ""), 100))}</small></span></a>`;
  };
  const pinned = (pp.pinned || []).slice(0, 5).map(song).join("");
  const tops = (pp.top_tracks || []).slice(0, 6).map(song).join("");
  const artists = (pp.top_artists || []).slice(0, 8).filter((a) => a && typeof a.name === "string")
    .map((a) => `<span class="artist">${httpsImage(a.thumbnail) ? `<img src="${esc(httpsImage(a.thumbnail))}" alt="" loading="lazy">` : ""}${esc(clip(a.name!, 60))}</span>`).join("");
  const badges = (pp.badges || []).filter((b) => BADGES[b]).map((b) => `<span class="badge">${BADGES[b][0]} ${esc(BADGES[b][1])}</span>`).join("");
  const lists = (pp.playlists || []).filter((l) => l && UUID.test(l.id)).slice(0, 12)
    .map((l) => `<a class="list" href="${esc(link("p", l.id))}">${esc(clip(String(l.title || "Playlist"), 80))}</a>`).join("");
  const section = (title: string, html: string, cls = "") => (html ? `<section><h2>${title}</h2><div class="${cls}">${html}</div></section>` : "");
  const followers = typeof pp.followers === "number" ? pp.followers : 0;
  const desc = clip(pp.bio || `${name} on Tunewire: pinned songs, top artists and playlists.`, 200);
  const image = banner || avatar || DEFAULT_IMAGE;
  const open = `${LANDING}#u=${encodeURIComponent(pp.id)}`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} · Tunewire</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:site_name" content="Tunewire">
<meta property="og:type" content="profile">
<meta property="og:title" content="${esc(`${name} on Tunewire`)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(selfUrl)}">
<meta name="twitter:card" content="${banner ? "summary_large_image" : "summary"}">
<meta name="theme-color" content="${accent}">
<style>
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;background:#0b0b0d;color:#eee}
a{color:inherit;text-decoration:none}main{max-width:760px;margin:0 auto;padding:0 18px 48px}
.banner{height:200px;background:${banner ? `center/cover url("${esc(banner)}")` : `linear-gradient(135deg,${accent},#16161a)`}}
.head{display:flex;gap:18px;align-items:flex-end;margin-top:-56px;flex-wrap:wrap}
.avatar{width:120px;height:120px;border-radius:50%;border:5px solid #0b0b0d;background:#222;object-fit:cover;flex:none}
h1{margin:0;font-size:34px;line-height:1.1;overflow-wrap:anywhere}.pron{font-size:15px;color:#aaa;font-weight:500;margin-left:8px}
.meta{color:#aaa;font-size:14px}.bio{margin:16px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
.open{display:inline-block;margin-top:18px;padding:11px 20px;border-radius:999px;background:${accent};color:#fff;font-weight:700}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}.badge{font-size:12.5px;padding:4px 10px;border-radius:999px;background:#1d1d22}
section{margin-top:30px}h2{font-size:19px;margin:0 0 10px}
.songs{display:flex;flex-direction:column;gap:4px}.song{display:flex;gap:12px;align-items:center;padding:6px;border-radius:10px}.song:hover{background:#1a1a1f}
.song img,.song .ph{width:48px;height:48px;border-radius:6px;object-fit:cover;flex:none;background:#222;display:grid;place-items:center;color:#777}
.song b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.song small{color:#aaa}.song span{min-width:0}
.artists{display:flex;flex-wrap:wrap;gap:10px}.artist{display:flex;align-items:center;gap:8px;padding:4px 12px 4px 4px;border-radius:999px;background:#17171b}
.artist img{width:32px;height:32px;border-radius:50%;object-fit:cover}
.lists{display:flex;flex-wrap:wrap;gap:8px}.list{padding:8px 14px;border-radius:10px;background:#17171b}.list:hover{background:#222228}
footer{margin-top:40px;color:#777;font-size:13px}footer a{color:#9cc0ff}
</style>
</head><body>
<div class="banner"></div>
<main>
<div class="head">${avatar ? `<img class="avatar" src="${esc(avatar)}" alt="">` : `<div class="avatar"></div>`}
<div><h1>${esc(name)}${pp.pronouns ? `<span class="pron">${esc(clip(pp.pronouns, 40))}</span>` : ""}</h1>
<div class="meta">${followers} follower${followers === 1 ? "" : "s"} on Tunewire</div></div></div>
${pp.bio ? `<p class="bio">${esc(clip(pp.bio, 300))}</p>` : ""}
${badges ? `<div class="badges">${badges}</div>` : ""}
<a class="open" href="${esc(open)}">Open in Tunewire</a>
${section("Pinned", pinned, "songs")}
${section("Top artists · last 4 weeks", artists, "artists")}
${section("Top songs · last 4 weeks", tops, "songs")}
${section("Playlists", lists, "lists")}
<footer>Tunewire is a free music player for YouTube Music, SoundCloud, YouTube and Spotify. <a href="${LANDING}">Get Tunewire</a></footer>
</main>
</body></html>`;
}

export function page(p: Preview, selfUrl: string): string {
  const t = esc(p.title), d = esc(p.description), img = esc(p.image), target = esc(p.target);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<meta name="description" content="${d}">
<meta property="og:site_name" content="Tunewire">
<meta property="og:type" content="${p.kind === "s" ? "music.song" : p.kind === "p" ? "music.playlist" : "website"}">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${img}">
<meta property="og:url" content="${esc(selfUrl)}">
<meta name="twitter:card" content="${p.large ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">
<meta name="theme-color" content="#4d8dff">
<link rel="canonical" href="${target}">
<meta http-equiv="refresh" content="0; url=${target}">
</head><body style="font:16px system-ui;background:#0d0d0f;color:#eee;display:grid;place-items:center;height:90vh">
<p><a style="color:#9cc0ff" href="${target}">Open ${t} in Tunewire</a></p>
</body></html>`;
}

/** The playlist's cover picture (data: URLs are served as images). */
export async function cover(code: string, env: Env, f: typeof fetch = fetch): Promise<Response> {
  if (!UUID.test(code)) return new Response("not found", { status: 404 });
  const c = await rest(env, "rpc/playlist_cover", f, { pid: code }).catch(() => null);
  if (typeof c === "string") {
    const m = c.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if (m) {
      const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
      return new Response(bytes, { headers: { "Content-Type": m[1], "Cache-Control": "public, max-age=3600" } });
    }
    if (httpsImage(c)) return Response.redirect(c, 302);
  }
  return Response.redirect(DEFAULT_IMAGE, 302);
}

export async function handle(req: Request, env: Env, f: typeof fetch = fetch): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("GET only", { status: 405 });
  const url = new URL(req.url);
  const [kind, a, b] = route(url.pathname);
  if (kind === "img" && a === "p" && b) return cover(b, env, f);
  if (!kind || !"pscju".includes(kind) || kind.length !== 1 || !a) return Response.redirect(LANDING, 302);
  let code: string;
  try {
    code = decodeURIComponent(a);
  } catch {
    return Response.redirect(LANDING, 302); // malformed %-escape
  }
  if (kind === "u" && UUID.test(code)) {
    const pp = await rest(env, "rpc/public_profile", f, { uid: code }).catch(() => null);
    if (pp && typeof pp === "object" && !Array.isArray(pp) && typeof pp.name === "string") {
      return new Response(profilePage({ ...pp, id: code }, env, url.toString()), {
        headers: {
          "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
        },
      });
    }
  }
  const p = await preview(kind, code, env, f);
  return new Response(page(p, url.toString()), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}

if (import.meta.main) {
  Deno.serve((req) => handle(req, {
    supabaseUrl: Deno.env.get("SUPABASE_URL"),
    anonKey: Deno.env.get("SUPABASE_ANON_KEY"),
    publicUrl: Deno.env.get("SHARE_PUBLIC_URL"),
  }));
}
