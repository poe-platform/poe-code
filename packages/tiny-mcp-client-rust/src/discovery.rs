//! OAuth metadata admission and cache identities, independent of the URL/I/O host.
use mcp_protocol_rust::json::Value;
use std::{collections::HashMap, net::Ipv4Addr};

pub struct UrlFacts<'a> {
    pub protocol: &'a str,
    pub hostname: &'a str,
    pub credentials: bool,
    pub fragment: bool,
}
pub fn validate_secure(url: &UrlFacts<'_>, label: &str) -> Result<(), String> {
    if url.credentials || url.fragment {
        return Err(format!("{label} must not include credentials or fragment"));
    }
    let hostname = url
        .hostname
        .strip_suffix('.')
        .unwrap_or(url.hostname)
        .to_ascii_lowercase();
    let loopback = matches!(hostname.as_str(), "localhost" | "::1" | "[::1]")
        || hostname
            .parse::<Ipv4Addr>()
            .is_ok_and(|address| address.octets()[0] == 127);
    if url.protocol == "https:" || (url.protocol == "http:" && loopback) {
        Ok(())
    } else {
        Err(format!(
            "{label} must use https unless it targets a loopback host"
        ))
    }
}
pub fn metadata_paths(path: &str, issuer: bool) -> Vec<String> {
    let suffix = if path == "/" { "" } else { path };
    if issuer {
        let mut paths = vec![
            format!("/.well-known/oauth-authorization-server{suffix}"),
            format!("/.well-known/openid-configuration{suffix}"),
        ];
        if !suffix.is_empty() {
            paths.push(format!(
                "{}/.well-known/openid-configuration",
                suffix.strip_suffix('/').unwrap_or(suffix)
            ));
        }
        paths
    } else {
        vec![format!("/.well-known/oauth-protected-resource{suffix}")]
    }
}

fn string(value: Option<&Value>) -> Option<&[u16]> {
    match value {
        Some(Value::String(value)) => Some(value),
        _ => None,
    }
}
fn string_array(value: Option<&Value>) -> Option<&[Value]> {
    match value {
        Some(Value::Array(values))
            if values.iter().all(|value| matches!(value, Value::String(_))) =>
        {
            Some(values)
        }
        _ => None,
    }
}
#[derive(Debug, PartialEq, Eq)]
pub struct MetadataError(pub Vec<u16>);
impl From<&str> for MetadataError {
    fn from(message: &str) -> Self {
        Self(message.encode_utf16().collect())
    }
}
impl From<String> for MetadataError {
    fn from(message: String) -> Self {
        message.as_str().into()
    }
}
fn mismatch(prefix: &str, expected: &[u16], received: &[u16]) -> MetadataError {
    MetadataError(
        prefix
            .encode_utf16()
            .chain(expected.iter().copied())
            .chain(", received ".encode_utf16())
            .chain(received.iter().copied())
            .collect(),
    )
}
fn required<'a>(input: &'a Value, field: &str, error: &str) -> Result<&'a [u16], MetadataError> {
    string(input.get(field))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| error.into())
}
pub fn metadata_policy(
    command: &str,
    input: &Value,
    expected: &[u16],
    normalized: &[u16],
) -> Result<Value, MetadataError> {
    let protected = command.starts_with("resource");
    if !matches!(input, Value::Object(_)) {
        let label = if protected {
            "Protected resource metadata"
        } else if command == "cache_shape" {
            "Cached OAuth discovery resource mismatch"
        } else {
            "Authorization server metadata"
        };
        return Err(if command == "cache_shape" {
            label.into()
        } else {
            format!("{label} must be a JSON object").into()
        });
    }
    match command {
        "resource" => Ok(Value::String(
            required(
                input,
                "resource",
                "Protected resource metadata must include a resource string",
            )?
            .to_vec(),
        )),
        "resource_bound" => {
            if normalized != expected {
                return Err(mismatch(
                    "Protected resource metadata resource mismatch: expected ",
                    expected,
                    string(input.get("resource")).unwrap_or_default(),
                ));
            }
            string_array(input.get("authorization_servers")).filter(|values| !values.is_empty()).ok_or("Protected resource metadata must include a non-empty authorization_servers array")?;
            Ok(Value::Null)
        }
        "issuer" => {
            let issuer = required(
                input,
                "issuer",
                "Authorization server metadata must include issuer",
            )?;
            if issuer != expected {
                return Err(mismatch(
                    "Authorization server metadata issuer mismatch: expected ",
                    expected,
                    issuer,
                ));
            }
            Ok(Value::Null)
        }
        "endpoints" => {
            let authorization = required(
                input,
                "authorization_endpoint",
                "Authorization server metadata must include authorization_endpoint",
            )?;
            let token = required(
                input,
                "token_endpoint",
                "Authorization server metadata must include token_endpoint",
            )?;
            let mut endpoints = vec![
                Value::String(authorization.to_vec()),
                Value::String(token.to_vec()),
            ];
            if let Some(value) = input.get("registration_endpoint") {
                endpoints.push(value.clone());
            }
            Ok(Value::Array(endpoints))
        }
        "arrays" => {
            for (field, item) in [
                ("response_types_supported", "code"),
                ("code_challenge_methods_supported", "S256"),
            ] {
                let expected = item.encode_utf16().collect::<Vec<_>>();
                if !string_array(input.get(field)).is_some_and(|values| {
                    values
                        .iter()
                        .any(|value| string(Some(value)) == Some(expected.as_slice()))
                }) {
                    return Err(format!(
                        "Authorization server metadata must include {field} containing {item}"
                    )
                    .into());
                }
            }
            Ok(Value::Null)
        }
        "cache_shape" => {
            if string(input.get("resource")) != Some(expected) {
                return Err("Cached OAuth discovery resource mismatch".into());
            }
            let fields = [
                "resourceMetadataUrl",
                "authorizationServer",
                "authorizationServerMetadataUrl",
            ];
            let mut values = vec![];
            for field in fields {
                values.push(Value::String(
                    string(input.get(field))
                        .ok_or("Cached OAuth discovery is missing identity fields")?
                        .to_vec(),
                ));
            }
            Ok(Value::Array(values))
        }
        "cache_issuer" => {
            if !string_array(input.get("authorization_servers")).is_some_and(|servers| {
                servers
                    .iter()
                    .any(|server| string(Some(server)) == Some(expected))
            }) {
                return Err(
                    "Cached OAuth discovery issuer was not advertised by the resource".into(),
                );
            }
            Ok(Value::Null)
        }
        "cache_location" => {
            if !string_array(input.get("locations")).is_some_and(|locations| {
                locations
                    .iter()
                    .any(|location| string(Some(location)) == Some(expected))
            }) {
                return Err(
                    "Cached OAuth discovery metadata location does not match issuer".into(),
                );
            }
            Ok(Value::Null)
        }
        _ => Err("Unknown OAuth metadata policy command".into()),
    }
}

/// Only numeric identities are retained natively. Host snapshots remain visible
/// to its garbage collector, including cyclic structured-clone metadata.
#[derive(Default)]
pub struct CacheIndex {
    values: HashMap<Vec<u16>, u64>,
    next: u64,
}
impl CacheIndex {
    pub fn get(&self, resource: &[u16]) -> Option<u64> {
        self.values.get(resource).copied()
    }
    pub fn insert(&mut self, resource: Vec<u16>) -> Result<(u64, Option<u64>), &'static str> {
        self.next = self
            .next
            .checked_add(1)
            .filter(|value| *value <= 9_007_199_254_740_991)
            .ok_or("OAuth discovery cache identity exhausted")?;
        let previous = self.values.insert(resource, self.next);
        Ok((self.next, previous))
    }
    pub fn len(&self) -> usize {
        self.values.len()
    }
    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }
}
