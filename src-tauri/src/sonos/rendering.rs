//! RenderingControl (per zone) and GroupRenderingControl (per group).

use super::error::Result;
use super::soap::{Service, SoapClient};

pub async fn volume(soap: &SoapClient, ip: &str) -> Result<u32> {
    let r = soap.call(ip, Service::RenderingControl, "GetVolume", &[("InstanceID", "0"), ("Channel", "Master")]).await?;
    Ok(r.get_u32("CurrentVolume").unwrap_or(0))
}
pub async fn set_volume(soap: &SoapClient, ip: &str, vol: u32) -> Result<()> {
    let v = vol.min(100).to_string();
    soap.call(ip, Service::RenderingControl, "SetVolume", &[("InstanceID", "0"), ("Channel", "Master"), ("DesiredVolume", &v)]).await?;
    Ok(())
}
pub async fn mute(soap: &SoapClient, ip: &str) -> Result<bool> {
    let r = soap.call(ip, Service::RenderingControl, "GetMute", &[("InstanceID", "0"), ("Channel", "Master")]).await?;
    Ok(r.get_u32("CurrentMute").unwrap_or(0) == 1)
}
pub async fn set_mute(soap: &SoapClient, ip: &str, muted: bool) -> Result<()> {
    soap.call(ip, Service::RenderingControl, "SetMute", &[("InstanceID", "0"), ("Channel", "Master"), ("DesiredMute", if muted { "1" } else { "0" })]).await?;
    Ok(())
}
pub async fn group_volume(soap: &SoapClient, ip: &str) -> Result<u32> {
    let r = soap.call(ip, Service::GroupRenderingControl, "GetGroupVolume", &[("InstanceID", "0")]).await?;
    Ok(r.get_u32("CurrentVolume").unwrap_or(0))
}
pub async fn set_group_volume(soap: &SoapClient, ip: &str, vol: u32) -> Result<()> {
    let v = vol.min(100).to_string();
    soap.call(ip, Service::GroupRenderingControl, "SetGroupVolume", &[("InstanceID", "0"), ("DesiredVolume", &v)]).await?;
    Ok(())
}
pub async fn group_mute(soap: &SoapClient, ip: &str) -> Result<bool> {
    let r = soap.call(ip, Service::GroupRenderingControl, "GetGroupMute", &[("InstanceID", "0")]).await?;
    Ok(r.get_u32("CurrentMute").unwrap_or(0) == 1)
}
pub async fn set_group_mute(soap: &SoapClient, ip: &str, muted: bool) -> Result<()> {
    soap.call(ip, Service::GroupRenderingControl, "SetGroupMute", &[("InstanceID", "0"), ("DesiredMute", if muted { "1" } else { "0" })]).await?;
    Ok(())
}
