use mcp_protocol_rust::json::{Limits, Value, parse};
use std::collections::BTreeMap;

type Properties = BTreeMap<String, (usize, Option<String>)>;

fn set(props: &mut Properties, key: String, value: Option<String>) {
    let index = props.len();
    props.entry(key).or_insert((index, None)).1 = value;
}

pub(super) fn read(bytes: &[u8]) -> Result<Properties, &'static str> {
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
            set(&mut props, String::from_utf16_lossy(key), value);
        }
        return Ok(props);
    }
    Ok(BTreeMap::new())
}

pub(super) fn edit(
    format: &str,
    bytes: &[u8],
    ops: &[(&str, String, String)],
    limit: usize,
) -> Result<Vec<u8>, String> {
    let mut raster = super::png_pixels::Raster::decode(bytes, limit)?;
    super::sips_geometry::transform(&mut raster, ops, limit)?;
    let mut props = read(bytes)?;
    let mut quality = 85;
    for (op, key, value) in ops {
        match (*op, key.as_str()) {
            ("d", _) => set(&mut props, key.clone(), None),
            ("s", "format") => {}
            ("s", "formatOptions") => {
                quality = match value.trim().to_ascii_lowercase().as_str() {
                    "low" => 30,
                    "normal" => 60,
                    "best" => 95,
                    v => v
                        .parse::<f64>()
                        .ok()
                        .filter(|n| (1. ..=100.).contains(n))
                        .map_or(85, |n| n.round() as u8),
                };
            }
            ("s", "dpiWidth" | "dpiHeight") => {
                if let Some(dpi) = value
                    .trim()
                    .parse::<f64>()
                    .ok()
                    .filter(|v| v.is_finite() && *v > 0.)
                {
                    raster.density = dpi.round() as u32;
                    set(&mut props, key.clone(), Some(format!("{dpi:.3}")));
                }
            }
            ("s", _) => set(&mut props, key.clone(), Some(value.clone())),
            _ => {}
        }
    }
    if !props.is_empty() && !matches!(format, "png" | "jpeg") {
        return Err(format!(
            "sips property persistence is not supported for {format}; use PNG or JPEG output"
        ));
    }
    let mut encoded = if format == "png" {
        raster.png()
    } else {
        super::frame_output::encode(&raster, format, quality, raster.density, limit)?
    };
    if props.is_empty() {
        return Ok(encoded);
    }
    let mut entries = Vec::with_capacity(props.len());
    let mut size = 0;
    for (key, (order, value)) in props {
        size +=
            key.encode_utf16().count() + value.as_ref().map_or(4, |s| s.encode_utf16().count()) + 8;
        if size > 65500 {
            return Err("sips metadata byte limit exceeded".into());
        }
        let key = Value::String(key.encode_utf16().collect());
        let value = value.map_or(Value::Null, |v| Value::String(v.encode_utf16().collect()));
        entries.push((order, Value::Array(vec![key, value])));
    }
    entries.sort_unstable_by_key(|(i, _)| *i);
    let payload = mcp_protocol_rust::json::stringify(&Value::Array(
        entries.into_iter().map(|(_, entry)| entry).collect(),
    ));
    if payload.len() > 65500 {
        return Err("sips metadata byte limit exceeded".into());
    }
    if format == "png" {
        let prefix = b"safe-bash-sips\0\0\0\0\0";
        let mut chunk = ((prefix.len() + payload.len()) as u32)
            .to_be_bytes()
            .to_vec();
        chunk.extend_from_slice(b"iTXt");
        chunk.extend_from_slice(prefix);
        chunk.extend_from_slice(payload.as_bytes());
        chunk.extend_from_slice(&super::crc32_ieee(&chunk[4..]).to_be_bytes());
        encoded.splice(33..33, chunk);
    } else {
        let prefix = b"safe-bash-sips\0";
        let mut comment = vec![255, 254];
        comment.extend_from_slice(&((2 + prefix.len() + payload.len()) as u16).to_be_bytes());
        comment.extend_from_slice(prefix);
        comment.extend_from_slice(payload.as_bytes());
        encoded.splice(2..2, comment);
    }
    Ok(encoded)
}
