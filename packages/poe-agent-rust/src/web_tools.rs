//! Web tool policy and formatting; URL parsing and fetch stay in the host.
use mcp_protocol_rust::strings::trim_ecmascript;
use std::net::{IpAddr, Ipv4Addr};
pub fn non_public_host(host: &[u16]) -> bool {
    let host = String::from_utf16_lossy(host).to_lowercase();
    let host = host.strip_suffix('.').unwrap_or(&host);
    let host = host
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host);
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => private_v4(ip),
        Ok(IpAddr::V6(ip)) => {
            if ip.is_unspecified() || ip.is_loopback() {
                return true;
            }
            // Preserve the original classifier's treatment of a compressed first
            // hextet, including mapped addresses, rather than silently broadening it.
            let Some(first) = host
                .split(':')
                .next()
                .and_then(|h| u16::from_str_radix(h, 16).ok())
            else {
                return true;
            };
            (0xfc00..=0xfdff).contains(&first) || (0xfe80..=0xfebf).contains(&first)
        }
        _ => false,
    }
}
fn private_v4(ip: Ipv4Addr) -> bool {
    let [a, b, _, _] = ip.octets();
    a == 0
        || a == 10
        || a == 127
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
}
pub fn normalize_content_type(content: Option<&[u16]>) -> Vec<u16> {
    let content = content.unwrap_or(&[]);
    let content = trim_ecmascript(
        &content[..content
            .iter()
            .position(|u| *u == 59)
            .unwrap_or(content.len())],
    );
    if content.is_empty() {
        return "unknown".encode_utf16().collect();
    }
    let mut result = vec![];
    for c in char::decode_utf16(content.iter().copied()) {
        match c {
            Ok(c) => {
                for c in c.to_lowercase() {
                    result.extend(c.encode_utf16(&mut [0; 2]).iter().copied());
                }
            }
            Err(c) => result.push(c.unpaired_surrogate()),
        }
    }
    result
}
pub fn page(url: &[u16], kind: &[u16], content: &[u16], offset: usize) -> Vec<u16> {
    let start = offset.min(content.len());
    let end = start.saturating_add(20000).min(content.len());
    let mut output: Vec<_> = "URL: ".encode_utf16().collect();
    output.extend(url);
    output.extend("\nContent type: ".encode_utf16());
    output.extend(kind);
    output
        .extend(format!("\nShowing characters {start}-{end} of {}.", content.len()).encode_utf16());
    if end < content.len() {
        output.extend(format!("\nMore content available at offset {end}.").encode_utf16());
    }
    output.extend([10, 10]);
    output.extend(&content[start..end]);
    output
}
#[derive(Default)]
pub struct SearchResults {
    lines: Vec<Vec<u16>>,
}
impl SearchResults {
    pub fn allocated_bytes(&self) -> usize {
        self.lines.capacity() * size_of::<Vec<u16>>()
            + self
                .lines
                .iter()
                .map(|line| line.capacity() * size_of::<u16>())
                .sum::<usize>()
    }
    pub fn push(&mut self, value: &[u16]) {
        if self.complete() {
            return;
        }
        let trimmed = trim_ecmascript(value);
        if !trimmed.is_empty() {
            self.lines.push(trimmed.to_vec());
        }
    }
    pub fn complete(&self) -> bool {
        self.lines.len() >= 5
    }
    pub fn format(&self) -> Vec<u16> {
        if self.lines.is_empty() {
            return "No search results found.".encode_utf16().collect();
        }
        let mut output = vec![];
        for (index, line) in self.lines.iter().enumerate() {
            if index > 0 {
                output.push(10);
            }
            output.extend(line);
        }
        output
    }
}
