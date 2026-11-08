//! Schema URI resolution. Hierarchical path/query/fragment handling is separate
//! from strict resource-content URI admission, which rejects normalization.

#[derive(Clone)]
struct Uri {
    scheme: String,
    authority: Option<String>,
    path: String,
    query: Option<String>,
    fragment: Option<String>,
}

pub(super) fn resolve(reference: &str, base: &str) -> Result<String, String> {
    let mut reference = reference
        .trim_matches(|scalar: char| scalar <= '\u{20}')
        .replace(['\t', '\n', '\r'], "");
    let base = parse(base).ok_or_else(|| format!("Invalid schema URI: {reference}"))?;
    if let Some((name, rest)) = scheme(&reference)
        && special(name)
        && name.eq_ignore_ascii_case(&base.scheme)
        && name != "file"
        && !rest.replace('\\', "/").starts_with("//")
    {
        reference = rest.to_owned();
    }
    if scheme(&reference).is_none() && special(&base.scheme) {
        reference = reference.replace('\\', "/");
    }
    let uri = if scheme(&reference).is_some() {
        parse(&reference)
    } else {
        let (before_fragment, fragment) = split(&reference, '#');
        let (path, query) = split(before_fragment, '?');
        let mut result = base.clone();
        result.fragment = fragment.map(|value| encode(value, Component::Fragment));
        if base.authority.is_none() && !base.path.starts_with('/') && fragment.is_none() {
            None
        } else if before_fragment.is_empty() {
            Some(result)
        } else if path.starts_with("//") {
            parse(&format!("{}:{reference}", base.scheme))
        } else if base.authority.is_none() && !base.path.starts_with('/') {
            None
        } else {
            result.query = query.map(|value| encode_query(value, &base.scheme));
            if !path.is_empty() {
                let path = if special(&base.scheme) {
                    path.replace('\\', "/")
                } else {
                    path.to_owned()
                };
                let merged = if path.starts_with('/') {
                    path
                } else {
                    format!(
                        "{}/{path}",
                        base.path
                            .rsplit_once('/')
                            .map_or("", |(directory, _)| directory)
                    )
                };
                result.path = normalize_path(&encode(&merged, Component::Path));
            } else if query.is_none() {
                result.query = base.query;
            }
            Some(result)
        }
    }
    .ok_or_else(|| format!("Invalid schema URI: {reference}"))?;
    Ok(uri.serialize())
}

fn parse(source: &str) -> Option<Uri> {
    let (scheme, rest) = scheme(source)?;
    let scheme = scheme.to_ascii_lowercase();
    let (rest, fragment) = split(rest, '#');
    let (rest, query) = split(rest, '?');
    let rest = if special(&scheme) {
        rest.replace('\\', "/")
    } else {
        rest.to_owned()
    };
    let mut authority = None;
    let path;
    if special(&scheme) && scheme != "file" {
        let remaining = rest.trim_start_matches('/');
        let (host, tail) = remaining
            .split_once('/')
            .map_or((remaining, "/".into()), |(host, tail)| {
                (host, format!("/{tail}"))
            });
        if host.is_empty() {
            return None;
        }
        authority = Some(normalize_authority(host, &scheme)?);
        path = normalize_path(&encode(&tail, Component::Path));
    } else if let Some(remaining) = rest.strip_prefix("//") {
        let (host, tail) = remaining.split_once('/').map_or(
            (
                remaining,
                if scheme == "file" {
                    "/".into()
                } else {
                    String::new()
                },
            ),
            |(host, tail)| (host, format!("/{tail}")),
        );
        authority = Some(normalize_authority(host, &scheme)?);
        path = normalize_path(&encode(&tail, Component::Path));
    } else if scheme == "file" {
        authority = Some(String::new());
        path = normalize_path(&encode(
            &format!("/{}", rest.trim_start_matches('/')),
            Component::Path,
        ));
    } else {
        path = if rest.starts_with('/') {
            normalize_path(&encode(&rest, Component::Path))
        } else {
            encode(&rest, Component::Opaque)
        };
    }
    Some(Uri {
        scheme: scheme.clone(),
        authority,
        path,
        query: query.map(|value| encode_query(value, &scheme)),
        fragment: fragment.map(|value| encode(value, Component::Fragment)),
    })
}

impl Uri {
    fn serialize(&self) -> String {
        let mut result = format!("{}:", self.scheme);
        if let Some(authority) = &self.authority {
            result.push_str("//");
            result.push_str(authority);
        }
        result.push_str(&self.path);
        if let Some(query) = &self.query {
            result.push('?');
            result.push_str(query);
        }
        if let Some(fragment) = &self.fragment {
            result.push('#');
            result.push_str(fragment);
        }
        result
    }
}

fn special(scheme: &str) -> bool {
    ["http", "https", "ftp", "ws", "wss", "file"].contains(&scheme)
}
fn scheme(source: &str) -> Option<(&str, &str)> {
    let (scheme, rest) = source.split_once(':')?;
    if scheme.is_empty()
        || !scheme.as_bytes()[0].is_ascii_alphabetic()
        || !scheme
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"+-.".contains(&byte))
    {
        return None;
    }
    Some((scheme, rest))
}
fn split(source: &str, separator: char) -> (&str, Option<&str>) {
    source
        .split_once(separator)
        .map_or((source, None), |(left, right)| (left, Some(right)))
}

fn normalize_authority(source: &str, scheme: &str) -> Option<String> {
    let (credentials, host_port) = source
        .rsplit_once('@')
        .map_or((None, source), |(credentials, host)| {
            (Some(credentials), host)
        });
    if scheme == "file" && credentials.is_some() {
        return None;
    }
    let (host, port) = if host_port.starts_with('[') {
        let closing = host_port.find(']')?;
        let tail = &host_port[closing + 1..];
        (
            &host_port[..closing + 1],
            if tail.is_empty() {
                None
            } else {
                Some(tail.strip_prefix(':')?)
            },
        )
    } else {
        host_port
            .split_once(':')
            .map_or((host_port, None), |(host, port)| (host, Some(port)))
    };
    if scheme == "file" && port.is_some() {
        return None;
    }
    let mut host = if host.starts_with('[') {
        let address = host[1..host.len() - 1].parse::<std::net::Ipv6Addr>().ok()?;
        format!("[{}]", ipv6(address))
    } else if special(scheme) {
        let host = decode_host(host)?.to_ascii_lowercase();
        normalize_ipv4(&host)?
    } else {
        host.to_ascii_lowercase()
    };
    if scheme == "file" && host == "localhost" {
        host.clear();
    }
    if special(scheme) && scheme != "file" && host.is_empty() {
        return None;
    }
    let mut result = String::new();
    if let Some(credentials) = credentials {
        let (user, password) = credentials.split_once(':').unwrap_or((credentials, ""));
        if !user.is_empty() || !password.is_empty() {
            result.push_str(&encode(user, Component::Credentials));
            if !password.is_empty() {
                result.push(':');
                result.push_str(&encode(password, Component::Credentials));
            }
            result.push('@');
        }
    }
    result.push_str(&host);
    if let Some(port) = port.filter(|port| !port.is_empty()) {
        if !port.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        let port = port.trim_start_matches('0');
        let number = if port.is_empty() {
            0
        } else {
            port.parse::<u16>().ok()?
        };
        let default = match scheme {
            "http" | "ws" => Some(80),
            "https" | "wss" => Some(443),
            "ftp" => Some(21),
            _ => None,
        };
        if default != Some(number) {
            result.push(':');
            result.push_str(&number.to_string());
        }
    }
    let check = format!("{scheme}://{result}/");
    mcp_protocol_rust::formats::is_valid_uri(&check.encode_utf16().collect::<Vec<_>>())
        .then_some(result)
}

fn decode_host(source: &str) -> Option<String> {
    let mut bytes = Vec::with_capacity(source.len());
    let mut input = source.bytes();
    while let Some(byte) = input.next() {
        if byte == b'%' {
            let high = char::from(input.next()?).to_digit(16)?;
            let low = char::from(input.next()?).to_digit(16)?;
            bytes.push((high * 16 + low) as u8);
        } else {
            bytes.push(byte);
        }
    }
    String::from_utf8(bytes).ok()
}

fn normalize_ipv4(host: &str) -> Option<String> {
    if host.is_empty() {
        return Some(String::new());
    }
    let host_without_dot = host.strip_suffix('.').unwrap_or(host);
    let parts = host_without_dot.split('.').collect::<Vec<_>>();
    let number = |part: &str| {
        let (digits, radix) = if part.starts_with("0x") || part.starts_with("0X") {
            (&part[2..], 16)
        } else if part.len() > 1 && part.starts_with('0') {
            (&part[1..], 8)
        } else {
            (part, 10)
        };
        if digits.is_empty() {
            Some(0)
        } else {
            u64::from_str_radix(digits, radix).ok()
        }
    };
    let last = *parts.last()?;
    if number(last).is_none() && !last.bytes().all(|byte| byte.is_ascii_digit()) {
        return Some(host.to_owned());
    }
    if parts.len() > 4 || parts.iter().any(|part| part.is_empty()) {
        return None;
    }
    let mut address = 0u64;
    for (index, part) in parts.iter().enumerate() {
        let value = number(part)?;
        if index + 1 == parts.len() {
            if value >= (1u64 << (8 * (5 - parts.len()))) {
                return None;
            }
            address += value;
        } else {
            if value > 255 {
                return None;
            }
            address += value << (8 * (3 - index));
        }
    }
    Some(std::net::Ipv4Addr::from(address as u32).to_string())
}

fn ipv6(address: std::net::Ipv6Addr) -> String {
    let segments = address.segments();
    let mut longest = (0, 0);
    let mut index = 0;
    while index < segments.len() {
        if segments[index] != 0 {
            index += 1;
            continue;
        }
        let start = index;
        while index < segments.len() && segments[index] == 0 {
            index += 1;
        }
        if index - start > longest.1 {
            longest = (start, index - start);
        }
    }
    let mut result = String::new();
    let mut index = 0;
    while index < segments.len() {
        if longest.1 > 1 && index == longest.0 {
            result.push_str("::");
            index += longest.1;
        } else {
            if !result.is_empty() && !result.ends_with(':') {
                result.push(':');
            }
            result.push_str(&format!("{:x}", segments[index]));
            index += 1;
        }
    }
    result
}

fn encode_query(source: &str, scheme: &str) -> String {
    let encoded = encode(source, Component::Query);
    if special(scheme) {
        encoded.replace('\'', "%27")
    } else {
        encoded
    }
}

fn normalize_path(path: &str) -> String {
    let mut parts = Vec::new();
    let segments = path.split('/').collect::<Vec<_>>();
    for (index, part) in segments.iter().copied().enumerate() {
        let dot = part.replace("%2e", ".").replace("%2E", ".");
        match dot.as_str() {
            "." => {
                if index + 1 == segments.len() {
                    parts.push("");
                }
            }
            ".." => {
                if parts.len() > 1 || parts.first() != Some(&"") {
                    parts.pop();
                }
                if index + 1 == segments.len() {
                    parts.push("");
                }
            }
            _ => parts.push(part),
        }
    }
    let mut result = parts.join("/");
    if path.starts_with('/') && !result.starts_with('/') {
        result.insert(0, '/');
    }
    result
}

#[derive(Clone, Copy)]
enum Component {
    Path,
    Query,
    Fragment,
    Opaque,
    Credentials,
}
fn encode(source: &str, component: Component) -> String {
    let mut result = String::with_capacity(source.len());
    for byte in source.bytes() {
        let invalid = byte <= 32
            || byte >= 127
            || match component {
                Component::Path => b"\"#<>?`{}".contains(&byte),
                Component::Query => b"\"#<>".contains(&byte),
                Component::Fragment => b"\"<>`".contains(&byte),
                Component::Opaque => false,
                Component::Credentials => b"\"#<>?/;:=@[\\]^|`{}".contains(&byte),
            };
        if invalid {
            result.push('%');
            result.push(char::from(b"0123456789ABCDEF"[(byte >> 4) as usize]));
            result.push(char::from(b"0123456789ABCDEF"[(byte & 15) as usize]));
        } else {
            result.push(char::from(byte));
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::resolve;
    #[test]
    fn schema_urls_match_node_special_url_normalization() {
        for (reference, base, expected) in [
            (
                "http:relative",
                "http://example.test/a/root",
                "http://example.test/a/relative",
            ),
            (
                "https:relative",
                "http://example.test/a/root",
                "https://relative/",
            ),
            (
                "\\\\other.test\\x",
                "https://example.test/a/root",
                "https://other.test/x",
            ),
            (
                "?x='",
                "https://example.test/a/root",
                "https://example.test/a/root?x=%27",
            ),
            (
                "https://user:@example.test",
                "https://example.test",
                "https://user@example.test/",
            ),
            (
                "https://@example.test",
                "https://example.test",
                "https://example.test/",
            ),
            (
                "https://[0:0:0:0:0:0:0:1]/",
                "https://example.test",
                "https://[::1]/",
            ),
            (
                "https://127.1/",
                "https://example.test",
                "https://127.0.0.1/",
            ),
            (
                "https://%65xample.test/",
                "https://example.test",
                "https://example.test/",
            ),
        ] {
            assert_eq!(resolve(reference, base).unwrap(), expected, "{reference}");
        }
        assert!(resolve("", "urn:example:root").is_err());
        assert!(resolve("?q", "urn:example:root").is_err());
    }
    #[test]
    fn relative_references_keep_queries_fragments_and_canonical_hierarchical_paths() {
        let base = "https://EXAMPLE.test:443/a/b/root.json?old=1#old";
        for (reference, expected) in [
            ("../item.json", "https://example.test/a/item.json"),
            ("#anchor", "https://example.test/a/b/root.json?old=1#anchor"),
            ("?new=1", "https://example.test/a/b/root.json?new=1"),
            ("", "https://example.test/a/b/root.json?old=1"),
            ("/a/%2e%2e/other", "https://example.test/other"),
            ("//other.test/resource", "https://other.test/resource"),
            ("a b", "https://example.test/a/b/a%20b"),
        ] {
            assert_eq!(resolve(reference, base).unwrap(), expected);
        }
        assert_eq!(
            resolve("#/$defs/x", "urn:example:root?+component").unwrap(),
            "urn:example:root?+component#/$defs/x"
        );
        assert!(resolve("relative", "urn:example:root").is_err());
        assert_eq!(
            resolve("../item", "file:///c:/folder/root.json").unwrap(),
            "file:///c:/item"
        );
    }
}
