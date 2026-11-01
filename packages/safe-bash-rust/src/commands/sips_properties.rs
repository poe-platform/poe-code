use mcp_protocol_rust::json::{Limits, Value, parse};
use std::collections::BTreeMap;

pub(super) fn read(bytes: &[u8]) -> Result<BTreeMap<String, Option<String>>, &'static str> {
    let png = bytes.starts_with(b"\x89PNG\r\n\x1a\n");
    let mut data = if png && bytes.get(29..38) != Some(b"\n__IMG__:") {
        &bytes[8..]
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        &bytes[2..]
    } else {
        return Ok(BTreeMap::new());
    };
    while data.len() >= 4 {
        let (candidate, rest) = if png {
            if data.starts_with(b"\n__EXIF__:") {
                break;
            }
            let size = u32::from_be_bytes(data[..4].try_into().unwrap()) as usize;
            if size > data.len().saturating_sub(12) || data.len() < 12 {
                return Err("Invalid PNG metadata chunk");
            }
            (
                (&data[4..8] == b"iTXt").then(|| &data[8..8 + size]),
                &data[12 + size..],
            )
        } else {
            if data[0] != 255 || matches!(data[1], 0xda | 0xd9) {
                break;
            }
            let size = u16::from_be_bytes([data[2], data[3]]) as usize;
            if size < 2 || size > data.len() - 2 {
                return Err("Invalid JPEG metadata segment");
            }
            (
                (data[1] == 0xfe).then(|| &data[4..2 + size]),
                &data[2 + size..],
            )
        };
        data = rest;
        let key = if png {
            b"safe-bash-sips\0\0\0\0\0".as_slice()
        } else {
            b"safe-bash-sips\0"
        };
        let Some(payload) = candidate.and_then(|c| c.strip_prefix(key)) else {
            continue;
        };
        if payload.len() > 65500 {
            return Err("sips metadata byte limit exceeded");
        }
        std::str::from_utf8(payload)
            .map_err(|_| "The encoded data was not valid for encoding utf-8")?;
        let payload = payload.strip_prefix(b"\xef\xbb\xbf").unwrap_or(payload);
        let value = parse(
            payload,
            Limits {
                max_bytes: 65500,
                max_nodes: 65500,
                max_depth: 64,
            },
        )
        .map_err(|_| "Invalid sips metadata")?;
        let Value::Array(entries) = value else {
            return Err("Invalid sips metadata");
        };
        let mut props = BTreeMap::new();
        for entry in entries {
            let Value::Array(pair) = entry else {
                return Err("Invalid sips metadata property");
            };
            let [Value::String(key), value] = pair.as_slice() else {
                return Err("Invalid sips metadata property");
            };
            let value = match value {
                Value::Null => None,
                Value::String(s) => Some(String::from_utf16_lossy(s)),
                _ => return Err("Invalid sips metadata property"),
            };
            props.insert(String::from_utf16_lossy(key), value);
        }
        return Ok(props);
    }
    Ok(BTreeMap::new())
}
