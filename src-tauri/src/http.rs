//! One shared HTTP client (connection reuse) for every non-yt-dlp request:
//! streams, lyrics, Spotify embed pages, the yt-dlp self-installer.

use std::sync::OnceLock;
use std::time::Duration;

use ureq::unversioned::transport::{Buffers, ConnectionDetails, Connector, DefaultConnector, NextTimeout, Transport};

pub const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36";

/// Open connections are kept this long between uses (ureq's default is
/// 15 s): the next song then skips the TLS handshakes (~0.1 s each, two to
/// four per song). Servers close idle ones sooner; callers retry once.
const IDLE_AGE: Duration = Duration::from_secs(90);

/// Statuses are returned (not turned into errors) so callers can map them.
pub fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::config::Config::builder()
            .http_status_as_error(false)
            .timeout_connect(Some(Duration::from_secs(10)))
            .timeout_recv_response(Some(Duration::from_secs(15)))
            .timeout_recv_body(Some(Duration::from_secs(30)))
            .max_idle_age(IDLE_AGE)
            .build()
            .into()
    })
}

/// A stream connection that receives nothing for this long has stalled.
pub const STREAM_IDLE: Duration = Duration::from_secs(20);

/// For audio streams: no deadline for a whole body (on a slow line a song,
/// or a 4 MB chunk, may take minutes), but a read that waits longer than
/// `STREAM_IDLE` fails, and the downloader resumes where it stopped.
pub fn stream_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        let config = ureq::config::Config::builder()
            .http_status_as_error(false)
            .timeout_connect(Some(Duration::from_secs(10)))
            .timeout_recv_response(Some(Duration::from_secs(15)))
            .max_idle_age(IDLE_AGE)
            .max_idle_connections_per_host(6)
            .build();
        ureq::Agent::with_parts(config, IdleConnector(DefaultConnector::default()), PublicOnly::default())
    })
}

/// Marker in the error a refused address produces (see `stream::request`).
pub const LOCAL_REFUSED: &str = "stream points to a local network address";

/// Addresses on this computer or the local network (loopback, private,
/// link-local, CGNAT, unique-local IPv6, and IPv4-mapped versions of those).
pub fn is_local_ip(ip: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    let v4_local = |v4: std::net::Ipv4Addr| {
        let o = v4.octets();
        v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified() || v4.is_broadcast() || (o[0] == 100 && (64..128).contains(&o[1]))
    };
    match ip {
        IpAddr::V4(v4) => v4_local(v4),
        IpAddr::V6(v6) => {
            let seg = v6.segments();
            v6.is_loopback() || v6.is_unspecified() || (seg[0] & 0xfe00) == 0xfc00 || (seg[0] & 0xffc0) == 0xfe80 || v6.to_ipv4_mapped().is_some_and(v4_local)
        }
    }
}

/// Name resolution that refuses local addresses. Checking the URL's host
/// text isn't enough: a public name can resolve to 127.0.0.1, and a stream
/// server can redirect anywhere; every connection (redirects included) goes
/// through here.
#[derive(Debug, Default)]
struct PublicOnly(ureq::unversioned::resolver::DefaultResolver);

impl ureq::unversioned::resolver::Resolver for PublicOnly {
    fn resolve(&self, uri: &ureq::http::Uri, config: &ureq::config::Config, timeout: NextTimeout) -> Result<ureq::unversioned::resolver::ResolvedSocketAddrs, ureq::Error> {
        let addrs = self.0.resolve(uri, config, timeout)?;
        // Offline tests serve their streams from 127.0.0.1.
        if !cfg!(test) && addrs.iter().any(|a| is_local_ip(a.ip())) {
            return Err(ureq::Error::Io(std::io::Error::new(std::io::ErrorKind::PermissionDenied, LOCAL_REFUSED)));
        }
        Ok(addrs)
    }
}

/// The default connections, with every wait for input capped at `STREAM_IDLE`.
#[derive(Debug)]
struct IdleConnector(DefaultConnector);

impl Connector for IdleConnector {
    type Out = IdleTransport;

    fn connect(&self, details: &ConnectionDetails, chained: Option<()>) -> Result<Option<IdleTransport>, ureq::Error> {
        Ok(self.0.connect(details, chained)?.map(IdleTransport))
    }
}

#[derive(Debug)]
struct IdleTransport(Box<dyn Transport>);

impl Transport for IdleTransport {
    fn buffers(&mut self) -> &mut dyn Buffers {
        self.0.buffers()
    }

    fn transmit_output(&mut self, amount: usize, timeout: NextTimeout) -> Result<(), ureq::Error> {
        self.0.transmit_output(amount, timeout)
    }

    fn await_input(&mut self, timeout: NextTimeout) -> Result<bool, ureq::Error> {
        let idle = STREAM_IDLE.into();
        self.0.await_input(NextTimeout { after: timeout.after.min(idle), ..timeout })
    }

    fn is_open(&mut self) -> bool {
        self.0.is_open()
    }

    fn is_tls(&self) -> bool {
        self.0.is_tls()
    }
}
