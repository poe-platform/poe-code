use crate::commands::codecs::crc32_ieee;
use crate::vfs::SafeBashFs;
use std::collections::BTreeSet;

const SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

pub(super) fn candidate(bytes: &[u8]) -> bool {
    bytes.len() >= 8 && bytes.starts_with(b"\x89PNG") && bytes.get(29..38) != Some(b"\n__IMG__:")
}

fn metadata(kind: &[u8]) -> bool {
    matches!(
        kind,
        b"tEXt" | b"iTXt" | b"zTXt" | b"eXIf" | b"iCCP" | b"tIME"
    )
}

pub(super) fn writable(key: &str) -> bool {
    matches!(
        key,
        "Artist"
            | "Title"
            | "Author"
            | "Description"
            | "ImageDescription"
            | "Software"
            | "Comment"
            | "Copyright"
            | "ModifyDate"
    )
}

fn color(code: u8) -> &'static str {
    match code {
        0 => "Grayscale",
        2 => "RGB",
        3 => "Palette",
        4 => "Grayscale with Alpha",
        6 => "RGB with Alpha",
        _ => unreachable!(),
    }
}

fn scan(
    bytes: &[u8],
    strip: bool,
    mut visit: impl FnMut(&[u8], Option<(String, String, Option<&[u8]>)>),
) -> Result<(), &'static str> {
    let mut rest = bytes.strip_prefix(SIGNATURE).ok_or("Not a PNG file")?;
    let (mut first, mut idat, mut ended) = (true, false, false);
    while !rest.is_empty() {
        if ended {
            return Err("PNG trailing data not yet supported");
        }
        if rest.len() < 12 {
            return Err("PNG truncated chunk");
        }
        let size = u32::from_be_bytes(rest[..4].try_into().unwrap()) as usize;
        if size > rest.len() - 12 {
            return Err("PNG truncated chunk data");
        }
        let (chunk, next) = rest.split_at(size + 12);
        rest = next;
        let kind = &chunk[4..8];
        let data = &chunk[8..8 + size];
        if crc32_ieee(&chunk[4..8 + size])
            != u32::from_be_bytes(chunk[8 + size..].try_into().unwrap())
        {
            return Err("PNG CRC mismatch");
        }
        if first && kind != b"IHDR" {
            return Err("PNG missing initial IHDR");
        }
        let tag = match kind {
            b"IHDR" => {
                if !first || size != 13 {
                    return Err("Invalid PNG IHDR");
                }
                if [0, 4].iter().any(|i| {
                    !(1..=0x7fff_ffff)
                        .contains(&u32::from_be_bytes(data[*i..*i + 4].try_into().unwrap()))
                }) {
                    return Err("Invalid PNG dimensions");
                }
                let valid = match data[9] {
                    0 => matches!(data[8], 1 | 2 | 4 | 8 | 16),
                    3 => matches!(data[8], 1 | 2 | 4 | 8),
                    2 | 4 | 6 => matches!(data[8], 8 | 16),
                    _ => false,
                };
                if !valid || data[10..12] != [0, 0] || data[12] > 1 {
                    return Err("Invalid PNG IHDR encoding fields");
                }
                None
            }
            b"IDAT" => {
                idat = true;
                None
            }
            b"IEND" => {
                if !idat {
                    return Err("PNG missing IDAT");
                }
                if size != 0 {
                    return Err("Invalid PNG IEND");
                }
                ended = true;
                None
            }
            _ if strip && metadata(kind) => None,
            b"zTXt" => return Err("PNG zTXt metadata not yet supported"),
            b"eXIf" => return Err("PNG eXIf metadata not yet supported"),
            b"tIME" => {
                let [hi, lo, m, d, h, min, s] = *data else {
                    return Err("Invalid PNG tIME length");
                };
                Some((
                    "ModifyDate".into(),
                    format!(
                        "{:04}:{m:02}:{d:02} {h:02}:{min:02}:{s:02}",
                        u16::from_be_bytes([hi, lo])
                    ),
                    None,
                ))
            }
            b"tEXt" | b"iTXt" => {
                let pos = data
                    .iter()
                    .position(|&b| b == 0)
                    .filter(|v| (1..=79).contains(v))
                    .ok_or("Invalid PNG text keyword")?;
                let keyword: String = data[..pos].iter().map(|&b| char::from(b)).collect();
                let raw = &data[pos + 1..];
                let (value, binary) = if kind == b"tEXt" {
                    (raw.iter().map(|&b| char::from(b)).collect(), None)
                } else {
                    if raw.len() < 2 {
                        return Err("PNG truncated iTXt header");
                    }
                    if raw[0] != 0 {
                        return Err("PNG compressed iTXt not yet supported");
                    }
                    if raw[1] != 0 {
                        return Err("Invalid PNG iTXt compression method");
                    }
                    let mut fields = raw[2..].splitn(3, |&b| b == 0);
                    let lang = fields.next().unwrap();
                    let translated = fields.next();
                    let value = fields.next().ok_or("PNG truncated iTXt language fields")?;
                    if !lang.is_empty()
                        || translated != Some(&[][..])
                        || keyword == "XML:com.adobe.xmp"
                    {
                        return Err("PNG qualified/XMP iTXt not yet supported");
                    }
                    (String::from_utf8_lossy(value).into_owned(), Some(value))
                };
                let key = super::EXIF_TAGS
                    .iter()
                    .find(|n| n.eq_ignore_ascii_case(&keyword))
                    .map_or(keyword, |s| s.to_string());
                Some((key, value, binary))
            }
            _ => None,
        };
        visit(chunk, tag);
        first = false;
    }
    if !ended {
        return Err("PNG truncated: missing IEND");
    }
    Ok(())
}

pub(super) fn inspect(
    bytes: &[u8],
    mut insert: impl FnMut(&str, String, Option<&[u8]>),
) -> Result<(), &'static str> {
    scan(bytes, false, |chunk, tag| {
        if &chunk[4..8] == b"IHDR" {
            let w = u32::from_be_bytes(chunk[8..12].try_into().unwrap());
            let h = u32::from_be_bytes(chunk[12..16].try_into().unwrap());
            for (k, v) in [
                ("ImageWidth", w.to_string()),
                ("ImageHeight", h.to_string()),
                ("BitDepth", chunk[16].to_string()),
                ("ColorType", color(chunk[17]).into()),
                ("FileType", "PNG".into()),
                ("MIMEType", "image/png".into()),
                ("ImageSize", format!("{w}x{h}")),
            ] {
                insert(k, v, None);
            }
        }
        if let Some((k, v, binary)) = tag {
            insert(&k, v, binary);
        }
    })
}

fn timestamp(value: &str) -> Option<[u8; 7]> {
    let b = value.as_bytes();
    if b.len() < 19
        || !matches!(b[4], b':' | b'-')
        || b[7] != b[4]
        || !matches!(b[10], b' ' | b'T')
        || b[13] != b':'
        || b[16] != b':'
    {
        return None;
    }
    let num = |s: &[u8], min: u16, max: u16| {
        if !s.iter().all(u8::is_ascii_digit) {
            return None;
        }
        let n = s.iter().fold(0u16, |n, b| n * 10 + u16::from(*b - b'0'));
        (min..=max).contains(&n).then_some(n)
    };
    let mut tail = &b[19..];
    if let Some(f) = tail.strip_prefix(b".") {
        let n = f.iter().take_while(|b| b.is_ascii_digit()).count();
        if n == 0 {
            return None;
        }
        tail = &f[n..];
    }
    if !tail.is_empty() && tail != b"Z" {
        if tail.len() != 6 || !matches!(tail[0], b'+' | b'-') || tail[3] != b':' {
            return None;
        }
        num(&tail[1..3], 0, 23)?;
        num(&tail[4..], 0, 59)?;
    }
    let [hi, lo] = num(&b[..4], 1, 9999)?.to_be_bytes();
    Some([
        hi,
        lo,
        num(&b[5..7], 1, 12)? as u8,
        num(&b[8..10], 1, 31)? as u8,
        num(&b[11..13], 0, 23)? as u8,
        num(&b[14..16], 0, 59)? as u8,
        num(&b[17..19], 0, 59)? as u8,
    ])
}

pub(super) fn edit(
    bytes: &[u8],
    updates: &[(String, String)],
    fs: &dyn SafeBashFs,
) -> Result<Vec<u8>, String> {
    struct Op<'a> {
        key: &'a str,
        set: Option<&'a str>,
        remove: BTreeSet<&'a str>,
        count: usize,
    }
    let all = matches!(updates,[(k,v)] if k.eq_ignore_ascii_case("all") && v.is_empty());
    let mut ops = Vec::<Op>::new();
    let mut error = None;
    for (key, value) in updates {
        if all {
            break;
        }
        let name = key.strip_suffix(['+', '-']).unwrap_or(key);
        if !writable(name) {
            error = Some(format!("Tag write not yet supported: {name}"));
            break;
        }
        if key != name && name == "ModifyDate" {
            error = Some("Temporal shifts are not yet supported for ModifyDate".into());
            break;
        }
        if key.ends_with('+') {
            error = Some(super::exiftool_shift_error(key, value).map_or_else(
                || format!("Scalar numeric shifts are not yet supported for {name}"),
                str::to_owned,
            ));
            break;
        }
        let i = ops.iter().position(|o| o.key == name).unwrap_or_else(|| {
            ops.push(Op {
                key: name,
                set: None,
                remove: BTreeSet::new(),
                count: 0,
            });
            ops.len() - 1
        });
        if key.ends_with('-') {
            ops[i].remove.insert(value);
        } else {
            ops[i].set = Some(value);
            ops[i].remove.clear();
        }
    }
    let mut kept = SIGNATURE.to_vec();
    let mut insertion = None;
    let mut unknown = false;
    scan(bytes, all, |chunk, tag| {
        let kind = &chunk[4..8];
        if all {
            if metadata(kind) {
                return;
            }
            if !matches!(
                kind,
                b"IHDR"
                    | b"PLTE"
                    | b"IDAT"
                    | b"IEND"
                    | b"tRNS"
                    | b"gAMA"
                    | b"cHRM"
                    | b"sRGB"
                    | b"bKGD"
                    | b"pHYs"
                    | b"sBIT"
                    | b"sPLT"
                    | b"hIST"
            ) {
                unknown = true;
            }
        }
        if kind == b"IDAT" {
            insertion.get_or_insert(kept.len());
        }
        if let Some((key, value, _)) = tag
            && (key == "ModifyDate") == (kind == b"tIME")
            && let Some(op) = ops.iter_mut().find(|o| o.key == key)
        {
            op.count += 1;
            if op.set.is_some() || op.remove.contains(value.as_str()) {
                return;
            }
        }
        kept.extend_from_slice(chunk);
    })?;
    if unknown {
        return Err("PNG all deletion with unqualified chunks is not yet supported".into());
    }
    if let Some(e) = error {
        return Err(e);
    }
    let at = insertion.unwrap();
    let mut added = Vec::new();
    let limit = fs.shell_limits().max_output_bytes;
    for op in ops {
        let Some(v) = op.set.filter(|v| !v.is_empty() && !op.remove.contains(v)) else {
            continue;
        };
        let (kind, data, count) = if op.key == "ModifyDate" {
            (
                b"tIME",
                timestamp(v)
                    .ok_or("PNG timestamp syntax/range not yet supported")?
                    .to_vec(),
                1,
            )
        } else {
            let mut data = op.key.as_bytes().to_vec();
            let kind = if v.is_ascii() {
                data.push(0);
                b"tEXt"
            } else {
                data.extend_from_slice(&[0; 5]);
                b"iTXt"
            };
            data.extend_from_slice(v.as_bytes());
            (kind, data, op.count.max(1))
        };
        let size = data.len() + 12;
        if size.saturating_mul(count) > limit.saturating_sub(kept.len()).saturating_sub(added.len())
        {
            return Err(fs.limit_error("maxOutputBytes", limit));
        }
        let start = added.len();
        added.extend_from_slice(&(data.len() as u32).to_be_bytes());
        added.extend_from_slice(kind);
        added.extend_from_slice(&data);
        added.extend_from_slice(&crc32_ieee(&added[start + 4..]).to_be_bytes());
        for _ in 1..count {
            added.extend_from_within(start..start + size);
        }
    }
    kept.splice(at..at, added);
    Ok(kept)
}
