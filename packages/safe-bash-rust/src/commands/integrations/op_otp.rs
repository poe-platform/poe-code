use super::OpItem;
use crate::commands::archive::openssl_hmac;
use std::collections::BTreeMap;

fn query_component(input: &str) -> String {
    let mut bytes = Vec::new();
    let mut source = input.as_bytes();
    while let Some((&b, rest)) = source.split_first() {
        if b == b'%'
            && let [hi, lo, tail @ ..] = rest
            && let (Some(h), Some(l)) = ((*hi as char).to_digit(16), (*lo as char).to_digit(16))
        {
            bytes.push((h * 16 + l) as u8);
            source = tail;
        } else {
            bytes.push(if b == b'+' { b' ' } else { b });
            source = rest;
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

fn base32_key(value: &str) -> Result<Vec<u8>, &'static str> {
    let mut out = Vec::new();
    let (mut bits, mut count) = (0u16, 0);
    let mut padding = false;
    for b in value.bytes().map(|b| b.to_ascii_uppercase()) {
        let digit = match b {
            b' ' | b'\t' | b'\r' | b'\n' => continue,
            b'=' => {
                padding = true;
                continue;
            }
            b'A'..=b'Z' if !padding => b - b'A',
            b'2'..=b'7' if !padding => b - b'2' + 26,
            _ => return Err("Invalid OTP secret encoding"),
        };
        bits = (bits << 5) | u16::from(digit);
        count += 5;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
            bits &= (1 << count) - 1;
        }
    }
    if out.is_empty() || bits != 0 {
        Err("Invalid OTP secret encoding")
    } else {
        Ok(out)
    }
}

pub(super) fn generate(item: &OpItem) -> Result<String, &'static str> {
    let mut secret = item
        .fields
        .iter()
        .find(|f| f.field_type == "OTP")
        .ok_or("OTP field is unavailable")?
        .value
        .as_str();
    let mut params = BTreeMap::new();
    if let Some(uri) = secret.strip_prefix("otpauth://") {
        let clean = uri.replace(['\n', '\r', '\t'], "");
        let uri = clean
            .trim_end_matches(|c: char| c <= ' ')
            .split('#')
            .next()
            .unwrap();
        let (host_path, query) = uri.split_once('?').unwrap_or((uri, ""));
        let authority = host_path.split('/').next().unwrap();
        let host = authority
            .strip_prefix(":@")
            .or_else(|| authority.strip_prefix('@'))
            .unwrap_or(authority);
        if host.strip_suffix(':').unwrap_or(host) != "totp" {
            return Err("Invalid OTP configuration");
        }
        for param in query.split('&') {
            let (key, value) = param.split_once('=').unwrap_or((param, ""));
            params
                .entry(query_component(key))
                .or_insert_with(|| query_component(value));
        }
        secret = params.get("secret").map_or("", String::as_str);
    }
    let number = |name, default| {
        params
            .get(name)
            .map_or(Some(default), |s| {
                let s = s.trim();
                match s.as_bytes() {
                    [b'0', prefix @ (b'x' | b'X' | b'b' | b'B' | b'o' | b'O'), ..] => {
                        let radix = match prefix.to_ascii_lowercase() {
                            b'x' => 16,
                            b'b' => 2,
                            _ => 8,
                        };
                        u64::from_str_radix(&s[2..], radix).ok().map(|v| v as f64)
                    }
                    _ => s.parse::<f64>().ok(),
                }
            })
            .filter(|v| *v >= 1. && *v <= 9_007_199_254_740_991. && v.fract() == 0.)
            .ok_or("Invalid OTP configuration")
    };
    let digits = number("digits", 6.)? as u32;
    let period = number("period", 30.)?;
    let now = crate::vfs::now_ms();
    if !matches!(digits, 6 | 8)
        || !(0. ..=9_007_199_254_740_991.).contains(&now)
        || now.fract() != 0.
    {
        return Err("Invalid OTP configuration");
    }
    let algorithm = params
        .get("algorithm")
        .map_or("sha1".to_owned(), |s| s.to_ascii_lowercase());
    if !matches!(algorithm.as_str(), "sha1" | "sha256" | "sha512") {
        return Err("Invalid OTP algorithm");
    }
    let counter = (now / 1000. / period) as u64;
    let mut key = base32_key(secret)?;
    let digest = openssl_hmac(&algorithm, &key, &counter.to_be_bytes());
    key.fill(0);
    let offset = usize::from(digest.last().unwrap() & 15);
    let code = (u32::from_be_bytes(digest[offset..offset + 4].try_into().unwrap()) & 0x7fff_ffff)
        % 10u32.pow(digits);
    Ok(format!("{code:0width$}", width = digits as usize))
}
