//! CSRF cookie policy; the host provides entropy and timing-safe byte comparison.
use mcp_protocol_rust::{numbers, strings::trim_ecmascript};
pub fn validate_cookie(name: &[u16], max_age: f64) -> Result<(), &'static str> {
    if !name.starts_with(&"__Host-".encode_utf16().collect::<Vec<_>>())
        || name.contains(&59)
        || name.contains(&61)
    {
        return Err("CSRF cookie name must use the __Host- prefix.");
    }
    if !max_age.is_finite() || max_age.fract() != 0.0 || max_age <= 0.0 {
        return Err("CSRF cookie max age must be a positive integer.");
    }
    Ok(())
}
pub fn security_cookie(
    name: &[u16],
    max_age: f64,
    token: &[u16],
) -> Result<Vec<u16>, &'static str> {
    validate_cookie(name, max_age)?;
    let mut cookie = name.to_vec();
    cookie.push(61);
    cookie.extend_from_slice(token);
    cookie.extend(
        format!(
            "; Path=/; Max-Age={}; HttpOnly; Secure; SameSite=Lax",
            numbers::format(max_age)
        )
        .encode_utf16(),
    );
    Ok(cookie)
}
pub fn cookie_value(header: Option<&[u16]>, name: &[u16]) -> Option<Vec<u16>> {
    let mut prefix = name.to_vec();
    prefix.push(61);
    header?
        .split(|u| *u == 59)
        .map(trim_ecmascript)
        .find(|entry| entry.starts_with(&prefix))
        .map(|entry| entry[prefix.len()..].to_vec())
}
