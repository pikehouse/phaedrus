//! Minimal UPnP SOAP client for Sonos ZonePlayers.

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::time::Duration;

use super::error::{Error, Result};
use super::xml;

#[derive(Debug, Clone, Copy)]
pub enum Service {
    AVTransport,
    RenderingControl,
    GroupRenderingControl,
    ContentDirectory,
    ZoneGroupTopology,
    MusicServices,
    DeviceProperties,
}

impl Service {
    fn path(self) -> &'static str {
        match self {
            Service::AVTransport => "/MediaRenderer/AVTransport/Control",
            Service::RenderingControl => "/MediaRenderer/RenderingControl/Control",
            Service::GroupRenderingControl => "/MediaRenderer/GroupRenderingControl/Control",
            Service::ContentDirectory => "/MediaServer/ContentDirectory/Control",
            Service::ZoneGroupTopology => "/ZoneGroupTopology/Control",
            Service::MusicServices => "/MusicServices/Control",
            Service::DeviceProperties => "/DeviceProperties/Control",
        }
    }
    fn urn(self) -> &'static str {
        match self {
            Service::AVTransport => "urn:schemas-upnp-org:service:AVTransport:1",
            Service::RenderingControl => "urn:schemas-upnp-org:service:RenderingControl:1",
            Service::GroupRenderingControl => "urn:schemas-upnp-org:service:GroupRenderingControl:1",
            Service::ContentDirectory => "urn:schemas-upnp-org:service:ContentDirectory:1",
            Service::ZoneGroupTopology => "urn:schemas-upnp-org:service:ZoneGroupTopology:1",
            Service::MusicServices => "urn:schemas-upnp-org:service:MusicServices:1",
            Service::DeviceProperties => "urn:schemas-upnp-org:service:DeviceProperties:1",
        }
    }
}

/// Flat map of the response's child elements (e.g. CurrentTransportState → "PLAYING").
#[derive(Debug, Default, Clone)]
pub struct SoapResponse {
    pub fields: HashMap<String, String>,
}

impl SoapResponse {
    pub fn get(&self, key: &str) -> Option<&str> {
        self.fields.get(key).map(|s| s.as_str())
    }
    pub fn get_or_empty(&self, key: &str) -> &str {
        self.get(key).unwrap_or("")
    }
    pub fn get_u32(&self, key: &str) -> Option<u32> {
        self.get(key).and_then(|v| v.trim().parse().ok())
    }
}

#[derive(Clone, Default)]
pub struct SoapClient {
    http: reqwest::Client,
}

impl SoapClient {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_millis(2500))
            .timeout(Duration::from_secs(6))
            .tcp_nodelay(true)
            .pool_max_idle_per_host(4)
            .build()
            .expect("reqwest client");
        Self { http }
    }
    // Default derives to reqwest's default client; new() is what the app uses.

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    /// Perform a SOAP action. `args` are rendered as `<Key>value</Key>` in order.
    pub async fn call(
        &self,
        ip: &str,
        service: Service,
        action: &str,
        args: &[(&str, &str)],
    ) -> Result<SoapResponse> {
        let mut body = String::with_capacity(256);
        for (k, v) in args {
            body.push('<');
            body.push_str(k);
            body.push('>');
            body.push_str(&xml::escape(v));
            body.push_str("</");
            body.push_str(k);
            body.push('>');
        }
        let envelope = format!(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
             <s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" \
             s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">\
             <s:Body><u:{action} xmlns:u=\"{urn}\">{body}</u:{action}></s:Body></s:Envelope>",
            action = action,
            urn = service.urn(),
            body = body
        );
        let ip = check_ip(ip)?;
        let url = format!("http://{}:1400{}", ip, service.path());
        let resp = self
            .http
            .post(&url)
            .header("Content-Type", "text/xml; charset=\"utf-8\"")
            .header("SOAPACTION", format!("\"{}#{}\"", service.urn(), action))
            .body(envelope)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            if let Some(code) = extract_upnp_error(&text) {
                return Err(Error::Upnp { code, action: action.to_string() });
            }
            return Err(Error::status(status.as_u16(), &text));
        }
        parse_response(&text, action)
    }
}

/// Speaker addresses come from the webview; only a plain IPv4 address may be
/// pasted into a URL.
pub fn check_ip(ip: &str) -> Result<Ipv4Addr> {
    ip.parse().map_err(|_| Error::other(format!("not a speaker address: {ip:?}")))
}

/// Catalog ids pasted into URIs and URLs (Apple Music track/album/artist ids).
pub fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// TuneIn station ids ("s10001").
pub fn is_alnum(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric())
}

fn extract_upnp_error(text: &str) -> Option<u32> {
    let doc = xml::parse(text).ok()?;
    xml::descendant_text(doc.root(), "errorCode")?.trim().parse().ok()
}

fn parse_response(text: &str, action: &str) -> Result<SoapResponse> {
    let doc = xml::parse(text)?;
    let response_name = format!("{}Response", action);
    let node = xml::descendant(doc.root(), &response_name)
        .or_else(|| xml::descendant(doc.root(), "Body").and_then(|b| b.children().find(|c| c.is_element())))
        .ok_or_else(|| Error::parse(format!("no {} in reply", response_name)))?;
    let mut fields = HashMap::new();
    for child in node.children().filter(|c| c.is_element()) {
        fields.insert(child.tag_name().name().to_string(), child.text().unwrap_or("").to_string());
    }
    Ok(SoapResponse { fields })
}

/// Parse "0:03:40" → 220. Sonos also returns "NOT_IMPLEMENTED".
pub fn parse_hms(s: &str) -> Option<u32> {
    let s = s.trim();
    if s.is_empty() || !s.contains(':') {
        return None;
    }
    let mut total: u32 = 0;
    for part in s.split(':') {
        // handle "0:03:40.500"
        let whole = part.split('.').next().unwrap_or("0");
        let n: u32 = whole.trim().parse().ok()?;
        total = total.checked_mul(60)?.checked_add(n)?;
    }
    Some(total)
}

pub fn format_hms(secs: u32) -> String {
    format!("{}:{:02}:{:02}", secs / 3600, (secs / 60) % 60, secs % 60)
}
