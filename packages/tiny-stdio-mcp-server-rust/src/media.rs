use super::{object, string};
use mcp_protocol_rust::json::Value;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FileType {
    pub mime: &'static str,
    pub ext: &'static str,
}

pub fn file_type(data: &[u8]) -> Option<FileType> {
    if data.len() < 12 {
        return None;
    }
    let (mime, ext) = if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        ("image/png", "png")
    } else if data.starts_with(b"\xff\xd8\xff") {
        ("image/jpeg", "jpg")
    } else if data.starts_with(b"GIF8") {
        ("image/gif", "gif")
    } else if data.starts_with(b"RIFF") && &data[8..12] == b"WEBP" {
        ("image/webp", "webp")
    } else if data.starts_with(b"\xff\xfb")
        || data.starts_with(b"\xff\xfa")
        || data.starts_with(b"ID3")
    {
        ("audio/mpeg", "mp3")
    } else if data.starts_with(b"RIFF") && &data[8..12] == b"WAVE" {
        ("audio/wav", "wav")
    } else if data.starts_with(b"OggS") {
        ("audio/ogg", "ogg")
    } else if &data[4..8] == b"ftyp" && &data[8..11] == b"M4A" {
        ("audio/mp4", "m4a")
    } else if &data[4..8] == b"ftyp" {
        ("video/mp4", "mp4")
    } else if data.starts_with(b"\x1aE\xdf\xa3") {
        ("video/webm", "webm")
    } else {
        return None;
    };
    Some(FileType { mime, ext })
}

pub fn binary_bytes(kind: &str, data: &[u8], format: Option<&str>) -> Result<Value, String> {
    let mime = match format.filter(|format| !format.is_empty()) {
        Some(format) => {
            let lower = format.to_lowercase();
            if format.contains('/') {
                lower
            } else if kind == "image" {
                format!("image/{lower}")
            } else {
                match lower.as_str() {
                    "mp3" | "mpeg" => "audio/mpeg".into(),
                    "wav" => "audio/wav".into(),
                    "ogg" => "audio/ogg".into(),
                    "m4a" => "audio/mp4".into(),
                    _ => format!("audio/{format}"),
                }
            }
        }
        None => file_type(data)
            .filter(|detected| supported_mime(kind, detected.mime))
            .map(|detected| detected.mime.to_owned())
            .ok_or_else(|| format!("Unable to detect {kind} MIME type from bytes"))?,
    };
    check_mime(kind, &mime)?;
    Ok(object([
        ("type", string(kind)),
        ("data", string(&encode_base64(data))),
        ("mimeType", string(&mime)),
    ]))
}

pub fn binary_base64(kind: &str, data: &[u16], mime: &str) -> Result<Value, String> {
    validate_base64(data)?;
    let mime = mime.to_lowercase();
    check_mime(kind, &mime)?;
    Ok(object([
        ("type", string(kind)),
        ("data", Value::String(data.to_vec())),
        ("mimeType", string(&mime)),
    ]))
}

pub fn supported_mime(kind: &str, mime: &str) -> bool {
    match kind {
        "image" => ["image/png", "image/jpeg", "image/gif", "image/webp"].contains(&mime),
        "audio" => ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4"].contains(&mime),
        _ => false,
    }
}

fn check_mime(kind: &str, mime: &str) -> Result<(), String> {
    if supported_mime(kind, mime) {
        Ok(())
    } else {
        Err(format!("Unsupported {kind} MIME type: {mime}"))
    }
}

pub fn is_text_mime(mime: &str) -> bool {
    let lower = mime.to_lowercase();
    lower.starts_with("text/")
        || lower.ends_with("+json")
        || lower.ends_with("+xml")
        || [
            "application/json",
            "application/xml",
            "application/javascript",
            "application/typescript",
        ]
        .contains(&lower.as_str())
}

pub fn file_bytes(data: &[u8], mime: &[u16], name: Option<&[u16]>, force_binary: bool) -> Value {
    let text = !force_binary && is_text_mime(&String::from_utf16_lossy(mime));
    let value = if text {
        let data = data.strip_prefix(b"\xef\xbb\xbf").unwrap_or(data);
        string(&String::from_utf8_lossy(data))
    } else {
        string(&encode_base64(data))
    };
    file_block(mime, name, if text { "text" } else { "blob" }, value)
}

pub fn file_text(data: &[u16], mime: &[u16], name: Option<&[u16]>) -> Value {
    let text = is_text_mime(&String::from_utf16_lossy(mime));
    let value = if text {
        Value::String(data.to_vec())
    } else {
        string(&encode_base64(String::from_utf16_lossy(data).as_bytes()))
    };
    file_block(mime, name, if text { "text" } else { "blob" }, value)
}

fn file_block(mime: &[u16], name: Option<&[u16]>, field: &str, value: Value) -> Value {
    let mut uri: Vec<u16> = "file:///".encode_utf16().collect();
    uri.extend(
        name.filter(|name| !name.is_empty())
            .unwrap_or(&[100, 97, 116, 97]),
    );
    object([
        ("type", string("resource")),
        (
            "resource",
            object([
                ("uri", Value::String(uri)),
                ("mimeType", Value::String(mime.to_vec())),
                (field, value),
            ]),
        ),
    ])
}

pub fn encode_base64(data: &[u8]) -> String {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(data.len().div_ceil(3) * 4);
    for bytes in data.chunks(3) {
        let word = ((bytes[0] as u32) << 16)
            | ((bytes.get(1).copied().unwrap_or(0) as u32) << 8)
            | bytes.get(2).copied().unwrap_or(0) as u32;
        encoded.push(alphabet[(word >> 18) as usize] as char);
        encoded.push(alphabet[((word >> 12) & 63) as usize] as char);
        encoded.push(if bytes.len() > 1 {
            alphabet[((word >> 6) & 63) as usize] as char
        } else {
            '='
        });
        encoded.push(if bytes.len() > 2 {
            alphabet[(word & 63) as usize] as char
        } else {
            '='
        });
    }
    encoded
}

// Helper factories accept noncanonical padding bits like the original helpers.
// Protocol content validation separately enforces canonical base64 spelling.
pub fn validate_base64(data: &[u16]) -> Result<(), String> {
    let padding = data.iter().rev().take_while(|unit| **unit == 61).count();
    if !data.len().is_multiple_of(4)
        || padding > 2
        || !data[..data.len() - padding]
            .iter()
            .all(|unit| digit(*unit).is_some())
    {
        return Err("Invalid base64 content".into());
    }
    Ok(())
}

pub fn decode_base64(data: &[u16]) -> Result<Vec<u8>, String> {
    validate_base64(data)?;
    let mut bytes = Vec::with_capacity(data.len() / 4 * 3);
    for group in data.as_chunks::<4>().0 {
        let word = ((digit(group[0]).expect("valid group") as u32) << 18)
            | ((digit(group[1]).expect("valid group") as u32) << 12)
            | ((digit(group[2]).unwrap_or(0) as u32) << 6)
            | digit(group[3]).unwrap_or(0) as u32;
        bytes.push((word >> 16) as u8);
        if group[2] != 61 {
            bytes.push((word >> 8) as u8);
        }
        if group[3] != 61 {
            bytes.push(word as u8);
        }
    }
    Ok(bytes)
}

fn digit(unit: u16) -> Option<u8> {
    match unit {
        65..=90 => Some((unit - 65) as u8),
        97..=122 => Some((unit - 97 + 26) as u8),
        48..=57 => Some((unit - 48 + 52) as u8),
        43 => Some(62),
        47 => Some(63),
        _ => None,
    }
}
