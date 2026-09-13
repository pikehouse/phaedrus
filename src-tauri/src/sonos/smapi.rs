//! Sonos Music API (SMAPI) — the SOAP gateway every Sonos music service speaks.
//! We use it for search and for the one-time account link (AppLink flow).

use std::collections::HashMap;

use super::error::{Error, Result};
use super::soap::{Service, SoapClient};
use super::xml;

const NS: &str = "http://www.sonos.com/Services/1.1";
/// Services check for a Sonos-looking controller.
pub const USER_AGENT: &str = "Linux UPnP/1.0 Sonos/79.1-54130 (WDCR:Microsoft Windows NT 10.0.22621)";

#[derive(Debug, Clone)]
pub struct ServiceDesc {
    pub sid: u32,
    pub name: String,
    pub uri: String,
    pub auth: String,
    pub manifest_uri: Option<String>,
}

impl ServiceDesc {
    /// Sonos "service type" used in URIs and DIDL desc tokens.
    pub fn service_type(&self) -> u32 {
        self.sid * 256 + 7
    }
}

/// MusicServices#ListAvailableServices → descriptors.
pub async fn list_available_services(soap: &SoapClient, ip: &str) -> Result<Vec<ServiceDesc>> {
    let r = soap.call(ip, Service::MusicServices, "ListAvailableServices", &[]).await?;
    let inner = r.get_or_empty("AvailableServiceDescriptorList");
    let doc = xml::parse(inner)?;
    let mut out = Vec::new();
    for s in doc.descendants().filter(|n| n.is_element() && n.tag_name().name() == "Service") {
        let sid = match xml::attr(s, "Id").and_then(|v| v.parse::<u32>().ok()) {
            Some(v) => v,
            None => continue,
        };
        let uri = xml::attr(s, "SecureUri").or_else(|| xml::attr(s, "Uri")).unwrap_or_default();
        let auth = xml::descendant(s, "Policy").and_then(|p| xml::attr(p, "Auth")).unwrap_or_else(|| "Anonymous".into());
        let manifest_uri = xml::descendant(s, "Manifest").and_then(|m| xml::attr(m, "Uri"));
        out.push(ServiceDesc { sid, name: xml::attr(s, "Name").unwrap_or_default(), uri, auth, manifest_uri });
    }
    Ok(out)
}

#[derive(Debug, Clone)]
pub enum Creds {
    Anonymous,
    Token { token: String, key: String, household: String },
}

#[derive(Debug, Clone, Default)]
pub struct SmapiItem {
    pub id: String,
    pub item_type: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub art: Option<String>,
    pub duration_secs: Option<u32>,
    pub can_play: bool,
    pub is_collection: bool,
    pub summary: Option<String>,
    pub explicit: Option<bool>,
}

#[derive(Clone)]
pub struct SmapiClient {
    http: reqwest::Client,
    pub device_id: String,
}

impl SmapiClient {
    pub fn new(device_id: String) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(12))
            .build()
            .expect("smapi client");
        Self { http, device_id }
    }

    fn tz_offset() -> String {
        let off = chrono::Local::now().offset().local_minus_utc();
        let sign = if off < 0 { '-' } else { '+' };
        let off = off.abs();
        format!("{}{:02}:{:02}", sign, off / 3600, (off % 3600) / 60)
    }

    /// Raw SMAPI call. Returns the full response XML; SOAP faults become Error::Smapi.
    pub async fn call(&self, endpoint: &str, action: &str, body: &str, creds: &Creds) -> Result<String> {
        let login = match creds {
            Creds::Anonymous => String::new(),
            Creds::Token { token, key, household } => format!(
                "<loginToken><token>{}</token><key>{}</key><householdId>{}</householdId></loginToken>",
                xml::escape(token),
                xml::escape(key),
                xml::escape(household)
            ),
        };
        let envelope = format!(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
             <s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">\
             <s:Header>\
             <credentials xmlns=\"{ns}\"><deviceId>{dev}</deviceId><deviceProvider>Sonos</deviceProvider>{login}</credentials>\
             <context xmlns=\"{ns}\"><timeZone>{tz}</timeZone></context>\
             </s:Header>\
             <s:Body><{action} xmlns=\"{ns}\">{body}</{action}></s:Body></s:Envelope>",
            ns = NS,
            dev = xml::escape(&self.device_id),
            login = login,
            tz = Self::tz_offset(),
            action = action,
            body = body
        );
        let resp = self
            .http
            .post(endpoint)
            .header("Content-Type", "text/xml; charset=\"utf-8\"")
            .header("SOAPACTION", format!("\"{}#{}\"", NS, action))
            .header("Accept-Language", "en-US")
            .body(envelope)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if let Some(err) = parse_fault(&text) {
            return Err(err);
        }
        if !status.is_success() {
            return Err(Error::status(status.as_u16(), &text));
        }
        Ok(text)
    }

    pub async fn search(&self, svc: &ServiceDesc, creds: &Creds, category: &str, term: &str, index: u32, count: u32) -> Result<(Vec<SmapiItem>, u32)> {
        let body = format!(
            "<id>{}</id><term>{}</term><index>{}</index><count>{}</count>",
            xml::escape(category),
            xml::escape(term),
            index,
            count
        );
        let text = self.call(&svc.uri, "search", &body, creds).await?;
        Ok(parse_items(&text))
    }

    pub async fn get_metadata(&self, svc: &ServiceDesc, creds: &Creds, id: &str, index: u32, count: u32) -> Result<(Vec<SmapiItem>, u32)> {
        let body = format!("<id>{}</id><index>{}</index><count>{}</count><recursive>false</recursive>", xml::escape(id), index, count);
        let text = self.call(&svc.uri, "getMetadata", &body, creds).await?;
        Ok(parse_items(&text))
    }

    /// AppLink step 1 → (regUrl, linkCode).
    pub async fn get_app_link(&self, svc: &ServiceDesc, household: &str) -> Result<(String, String)> {
        let body = format!(
            "<householdId>{}</householdId><hardware>Mac</hardware><osVersion>macOS</osVersion><sonosAppName>Phaedrus</sonosAppName><callbackPath></callbackPath>",
            xml::escape(household)
        );
        let text = self.call(&svc.uri, "getAppLink", &body, &Creds::Anonymous).await?;
        let doc = xml::parse(&text)?;
        let reg = xml::descendant_text(doc.root(), "regUrl");
        let code = xml::descendant_text(doc.root(), "linkCode");
        match (reg, code) {
            (Some(r), Some(c)) => Ok((r, c)),
            _ => Err(Error::other(format!("{} does not offer a link flow we can complete on a Mac", svc.name))),
        }
    }

    /// DeviceLink step 1 (for services that use it instead of AppLink).
    pub async fn get_device_link_code(&self, svc: &ServiceDesc, household: &str) -> Result<(String, String)> {
        let body = format!("<householdId>{}</householdId>", xml::escape(household));
        let text = self.call(&svc.uri, "getDeviceLinkCode", &body, &Creds::Anonymous).await?;
        let doc = xml::parse(&text)?;
        let reg = xml::descendant_text(doc.root(), "regUrl");
        let code = xml::descendant_text(doc.root(), "linkCode");
        match (reg, code) {
            (Some(r), Some(c)) => Ok((r, c)),
            _ => Err(Error::other("no link code returned")),
        }
    }

    /// Step 2: Ok(Some((token, key))) when linked, Ok(None) while still pending.
    pub async fn get_device_auth_token(&self, svc: &ServiceDesc, household: &str, link_code: &str) -> Result<Option<(String, String)>> {
        let body = format!(
            "<householdId>{}</householdId><linkCode>{}</linkCode><linkDeviceId>{}</linkDeviceId>",
            xml::escape(household),
            xml::escape(link_code),
            xml::escape(&self.device_id)
        );
        match self.call(&svc.uri, "getDeviceAuthToken", &body, &Creds::Anonymous).await {
            Ok(text) => {
                let doc = xml::parse(&text)?;
                let token = xml::descendant_text(doc.root(), "authToken");
                let key = xml::descendant_text(doc.root(), "privateKey");
                match (token, key) {
                    (Some(t), Some(k)) => Ok(Some((t, k))),
                    _ => Err(Error::other("link reply had no token")),
                }
            }
            Err(Error::Smapi { fault, detail, .. }) => {
                let f = format!("{} {}", fault, detail).to_uppercase();
                if f.contains("NOT_LINKED_RETRY") || f.contains("RETRY") {
                    Ok(None)
                } else {
                    Err(Error::Smapi { fault, detail, refresh: None })
                }
            }
            Err(e) => Err(e),
        }
    }
}

fn parse_fault(text: &str) -> Option<Error> {
    if !text.contains("Fault") {
        return None;
    }
    let doc = xml::parse(text).ok()?;
    let fault = xml::descendant(doc.root(), "Fault")?;
    let faultstring = xml::descendant_text(fault, "faultstring").unwrap_or_default();
    let detail_code = xml::descendant_text(fault, "SonosError")
        .or_else(|| xml::descendant_text(fault, "ExceptionInfo"))
        .unwrap_or_default();
    let refresh = match (xml::descendant_text(fault, "authToken"), xml::descendant_text(fault, "privateKey")) {
        (Some(t), Some(k)) => Some((t, k)),
        _ => None,
    };
    Some(Error::Smapi { fault: faultstring, detail: detail_code, refresh })
}

/// Parse search / getMetadata results into items + total.
pub fn parse_items(text: &str) -> (Vec<SmapiItem>, u32) {
    let mut out = Vec::new();
    let doc = match xml::parse(text) {
        Ok(d) => d,
        Err(_) => return (out, 0),
    };
    let total = xml::descendant_text(doc.root(), "total").and_then(|t| t.trim().parse().ok()).unwrap_or(0);
    for node in doc.descendants().filter(|n| n.is_element() && matches!(n.tag_name().name(), "mediaMetadata" | "mediaCollection")) {
        let is_collection = node.tag_name().name() == "mediaCollection";
        let mut fields: HashMap<&str, String> = HashMap::new();
        for c in node.descendants().filter(|c| c.is_element() && c != &node) {
            if let Some(t) = c.text() {
                let name = c.tag_name().name();
                fields.entry(name).or_insert_with(|| t.to_string());
            }
        }
        let get = |k: &str| fields.get(k).cloned().filter(|s| !s.trim().is_empty());
        let duration_secs = get("duration").and_then(|d| d.trim().parse::<u32>().ok());
        let art = get("albumArtURI").or_else(|| get("logo"));
        let explicit = get("explicit").map(|e| e == "true" || e == "1");
        out.push(SmapiItem {
            id: get("id").unwrap_or_default(),
            item_type: get("itemType").unwrap_or_default(),
            title: get("title").unwrap_or_default(),
            artist: get("artist").or_else(|| get("subtitle")),
            album: get("album"),
            art,
            duration_secs,
            can_play: get("canPlay").map(|v| v == "true").unwrap_or(!is_collection),
            is_collection,
            summary: get("summary"),
            explicit,
        });
    }
    (out, total)
}
