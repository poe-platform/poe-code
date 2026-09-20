//! Wire formats shared by the client and server. No decoding allocations are
//! needed for canonical base64; URI parsing never normalizes the caller's URI.

pub fn is_base64(units: &[u16]) -> bool {
    if !units.len().is_multiple_of(4) {
        return false;
    }
    if units.is_empty() {
        return true;
    }
    let padding = if units.ends_with(&[61, 61]) {
        2
    } else if units.ends_with(&[61]) {
        1
    } else {
        0
    };
    let data = &units[..units.len() - padding];
    if !data.iter().all(|unit| base64_digit(*unit).is_some()) {
        return false;
    }
    match padding {
        2 => base64_digit(data[data.len() - 1]).is_some_and(|digit| digit & 15 == 0),
        1 => base64_digit(data[data.len() - 1]).is_some_and(|digit| digit & 3 == 0),
        _ => true,
    }
}

fn base64_digit(unit: u16) -> Option<u8> {
    match unit {
        65..=90 => Some((unit - 65) as u8),
        97..=122 => Some((unit - 97 + 26) as u8),
        48..=57 => Some((unit - 48 + 52) as u8),
        43 => Some(62),
        47 => Some(63),
        _ => None,
    }
}

pub fn is_valid_uri(units: &[u16]) -> bool {
    let mut index = 0;
    while index < units.len() {
        let unit = units[index];
        if !(0x21..0x7f).contains(&unit) || [34, 60, 62, 92, 94, 96, 123, 124, 125].contains(&unit)
        {
            return false;
        }
        if unit == 37 {
            if index + 2 >= units.len()
                || hex_digit(units[index + 1]).is_none()
                || hex_digit(units[index + 2]).is_none()
            {
                return false;
            }
            index += 2;
        }
        index += 1;
    }
    // This copy is bounded by the enclosing JSON value limit. All units are
    // ASCII, so there is no lossy UTF-16 conversion.
    let bytes: Vec<u8> = units.iter().map(|unit| *unit as u8).collect();
    let Ok(source) = std::str::from_utf8(&bytes) else {
        return false;
    };
    let Some((scheme, rest)) = source.split_once(':') else {
        return false;
    };
    if scheme.is_empty()
        || !scheme.as_bytes()[0].is_ascii_alphabetic()
        || !scheme
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"+-.".contains(&byte))
    {
        return false;
    }
    let scheme = scheme.to_ascii_lowercase();
    let special = ["http", "https", "ws", "wss", "ftp"].contains(&scheme.as_str());
    let file = scheme == "file";
    let explicit_authority = rest.starts_with("//");
    let bracketed = source.contains(['[', ']']);
    if bracketed && !explicit_authority {
        return false;
    }
    let authority_source = if special {
        rest.trim_start_matches('/')
    } else if explicit_authority {
        &rest[2..]
    } else {
        return !bracketed;
    };
    let authority_end = authority_source
        .find(['/', '?', '#'])
        .unwrap_or(authority_source.len());
    let authority = &authority_source[..authority_end];
    let tail = &authority_source[authority_end..];
    if tail.contains(['[', ']']) {
        return false;
    }
    if authority.is_empty() {
        return !special;
    }
    if file && authority.contains('@') {
        return false;
    }
    if file
        && authority.len() == 2
        && authority.as_bytes()[0].is_ascii_alphabetic()
        && authority.ends_with(':')
    {
        return true;
    }
    let host_port = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    if authority[..authority.len() - host_port.len()].contains(['[', ']']) {
        return false;
    }
    if host_port.starts_with('[') {
        let Some(closing) = host_port.find(']') else {
            return false;
        };
        let address = &host_port[1..closing];
        if address.parse::<std::net::Ipv6Addr>().is_err() {
            return false;
        }
        let after = &host_port[closing + 1..];
        return after.is_empty() || (!file && after.strip_prefix(':').is_some_and(valid_port));
    }
    if bracketed {
        return false;
    }
    let (host, port) = host_port
        .split_once(':')
        .map_or((host_port, None), |(host, port)| (host, Some(port)));
    if port.is_some_and(|port| file || !valid_port(port)) {
        return false;
    }
    if host.is_empty() {
        return !special && !authority.contains('@') && port.is_none();
    }
    if special || file {
        valid_special_host(host)
    } else {
        // Opaque hosts retain percent escapes and do not interpret IPv4.
        !host.bytes().any(|byte| b"#/:<>?@[\\]^|".contains(&byte))
    }
}

fn valid_port(port: &str) -> bool {
    let number = port.trim_start_matches('0');
    port.bytes().all(|byte| byte.is_ascii_digit())
        && (number.is_empty() || number.parse::<u16>().is_ok())
}

fn hex_digit(unit: u16) -> Option<u8> {
    match unit {
        48..=57 => Some((unit - 48) as u8),
        65..=70 => Some((unit - 65 + 10) as u8),
        97..=102 => Some((unit - 97 + 10) as u8),
        _ => None,
    }
}

fn valid_special_host(host: &str) -> bool {
    let mut decoded = Vec::with_capacity(host.len());
    let source = host.as_bytes();
    let mut index = 0;
    while index < source.len() {
        if source[index] == b'%' {
            // The full URI scan validated each escape already.
            decoded.push(
                (hex_digit(source[index + 1] as u16).unwrap() << 4)
                    | hex_digit(source[index + 2] as u16).unwrap(),
            );
            index += 3;
        } else {
            decoded.push(source[index]);
            index += 1;
        }
    }
    let Ok(host) = std::str::from_utf8(&decoded) else {
        return false;
    };
    if host.is_empty()
        || host
            .bytes()
            .any(|byte| byte <= 32 || byte == 127 || b"#%/:<>?@[\\]^|".contains(&byte))
    {
        return false;
    }
    let mut mapped = String::with_capacity(host.len());
    for scalar in host.chars() {
        let scalar = match scalar {
            '\u{ff01}'..='\u{ff5e}' => char::from_u32(scalar as u32 - 0xfee0).unwrap(),
            '\u{3002}' | '\u{ff61}' => '.',
            '\u{ad}' | '\u{34f}' | '\u{feff}' => continue,
            scalar => scalar,
        };
        if invalid_domain_scalar(scalar) {
            return false;
        }
        mapped.push(scalar);
    }
    if mapped.is_empty() {
        return false;
    }
    for label in mapped.split('.') {
        if label.to_ascii_lowercase().starts_with("xn--")
            && validate_punycode(&label[4..]).is_none()
        {
            return false;
        }
    }
    let parts = mapped
        .strip_suffix('.')
        .unwrap_or(&mapped)
        .split('.')
        .collect::<Vec<_>>();
    let last = parts.last().copied().unwrap_or("");
    let hexadecimal = last.strip_prefix("0x").or_else(|| last.strip_prefix("0X"));
    let numeric = ipv4_number(last).is_some()
        || hexadecimal.is_some_and(|digits| digits.bytes().all(|byte| byte.is_ascii_hexdigit()))
        || (!last.is_empty() && last.bytes().all(|byte| byte.is_ascii_digit()));
    if !numeric {
        return true;
    }
    if parts.len() > 4 {
        return false;
    }
    for (index, part) in parts.iter().enumerate() {
        let Some(number) = ipv4_number(part) else {
            return false;
        };
        let maximum = if index + 1 == parts.len() {
            (1u64 << (8 * (5 - parts.len()))) - 1
        } else {
            255
        };
        if number > maximum {
            return false;
        }
    }
    true
}

fn ipv4_number(part: &str) -> Option<u64> {
    if part.is_empty() || part.starts_with(['+', '-']) {
        return None;
    }
    let (digits, radix) = if part.starts_with("0x") || part.starts_with("0X") {
        (&part[2..], 16)
    } else if part.len() >= 2 && part.starts_with('0') {
        (&part[1..], 8)
    } else {
        (part, 10)
    };
    if digits.is_empty() {
        Some(0)
    } else {
        u64::from_str_radix(digits, radix).ok()
    }
}

fn invalid_domain_scalar(scalar: char) -> bool {
    scalar.is_control()
        || scalar.is_whitespace()
        || "#%/:<>?@[\\]^|".contains(scalar)
        || matches!(
            scalar,
            '\u{200c}' | '\u{200d}' | '\u{fffd}' | '\u{fdd0}'..='\u{fdef}'
        )
        || scalar as u32 & 0xffff >= 0xfffe
}

// RFC 3492 decoding checks arithmetic and Unicode scalar bounds. Only validity
// is needed here, so count insertions rather than building an O(n²) string.
fn validate_punycode(source: &str) -> Option<()> {
    let mut output_length = 0u32;
    let mut input = source;
    if let Some((basic, encoded)) = source.rsplit_once('-') {
        if !basic.is_ascii() || basic.chars().any(invalid_domain_scalar) {
            return None;
        }
        output_length = u32::try_from(basic.len()).ok()?;
        input = encoded;
    }
    let mut bytes = input.bytes();
    let mut n = 128u32;
    let mut i = 0u32;
    let mut bias = 72u32;
    while bytes.len() > 0 {
        let old = i;
        let mut weight = 1u32;
        let mut k = 36u32;
        loop {
            let byte = bytes.next()?;
            let digit = match byte {
                b'a'..=b'z' => u32::from(byte - b'a'),
                b'A'..=b'Z' => u32::from(byte - b'A'),
                b'0'..=b'9' => u32::from(byte - b'0' + 26),
                _ => return None,
            };
            i = i.checked_add(digit.checked_mul(weight)?)?;
            let threshold = if k <= bias {
                1
            } else if k >= bias + 26 {
                26
            } else {
                k - bias
            };
            if digit < threshold {
                break;
            }
            weight = weight.checked_mul(36 - threshold)?;
            k = k.checked_add(36)?;
        }
        let length = output_length.checked_add(1)?;
        let mut delta = i - old;
        delta = if old == 0 { delta / 700 } else { delta / 2 };
        delta = delta.checked_add(delta / length)?;
        let mut offset = 0u32;
        while delta > 455 {
            delta /= 35;
            offset = offset.checked_add(36)?;
        }
        bias = offset.checked_add(36 * delta / (delta + 38))?;
        n = n.checked_add(i / length)?;
        i %= length;
        if invalid_domain_scalar(char::from_u32(n)?) {
            return None;
        }
        output_length = length;
        i += 1;
    }
    (output_length > 0).then_some(())
}
