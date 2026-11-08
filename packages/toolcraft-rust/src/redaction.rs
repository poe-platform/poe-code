/// ECMAScript lowercasing followed by removal of all non-ASCII letters/digits.
/// Unicode lowercasing can introduce ASCII (for example Kelvin sign and I-dot).
fn normalize(name: &[u16]) -> String {
    char::decode_utf16(name.iter().copied())
        .filter_map(Result::ok)
        .flat_map(char::to_lowercase)
        .filter(char::is_ascii_alphanumeric)
        .collect()
}

pub fn is_sensitive_name(name: &[u16]) -> bool {
    sensitive_normalized(&normalize(name))
}

fn sensitive_normalized(name: &str) -> bool {
    ["password", "token", "apikey", "secret"]
        .iter()
        .any(|part| name.contains(part))
}

pub fn redact_header(name: &[u16], value: &[u16]) -> Vec<u16> {
    let normalized = normalize(name);
    let replacement = match normalized.as_str() {
        "authorization" | "proxyauthorization" => {
            if value.starts_with(&[66, 101, 97, 114, 101, 114, 32]) {
                "Bearer ****"
            } else {
                "****"
            }
        }
        "cookie" | "setcookie" => "<redacted>",
        _ if sensitive_normalized(&normalized) => "<redacted>",
        _ => return value.to_vec(),
    };
    replacement.encode_utf16().collect()
}
