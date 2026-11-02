use super::super::{Cursor, Dict, Value, pdf_rewrite::encode};
use std::io::Write;
const BAD: &str = "invalid PDF content stream";
const LARGE: &str = "PDF output byte limit exceeded";
// Binary image data can itself contain " EI". For unfiltered images start
// looking for the terminator only after the last expected scanline.
fn inline<'a>(c: &mut Cursor<'a>, tokens: &mut usize) -> Result<(Dict<'a>, &'a [u8]), String> {
    let mut dict: Dict = vec![];
    loop {
        let key = c.word().ok_or(BAD)?;
        if key == b"ID" {
            break;
        }
        let key = key.strip_prefix(b"/").ok_or(BAD)?;
        let v = c.value(0, tokens, true).ok_or(BAD)?;
        dict.push((key.into(), v));
    }
    let field = |a: &[u8], b: &[u8]| {
        dict.iter()
            .find(|(k, _)| k.as_ref() == a || k.as_ref() == b)
            .map(|(_, v)| v)
    };
    let mut minimum = 0;
    if field(b"F", b"Filter").is_none_or(|v| matches!(v,Value::Array(a) if a.is_empty())) {
        let mask = field(b"IM", b"ImageMask").and_then(Value::word) == Some(b"true");
        let channels = match field(b"CS", b"ColorSpace").and_then(Value::word) {
            _ if mask => 1.,
            Some(b"/G" | b"/DeviceGray" | b"/I" | b"/Indexed") => 1.,
            Some(b"/CMYK" | b"/DeviceCMYK") => 4.,
            _ => 3.,
        };
        let bpc = if mask {
            1.
        } else {
            field(b"BPC", b"BitsPerComponent")
                .and_then(Value::number)
                .unwrap_or(8.)
        };
        let width = field(b"W", b"Width").and_then(Value::number).unwrap_or(0.);
        let height = field(b"H", b"Height").and_then(Value::number).unwrap_or(0.);
        minimum = (height * (width * bpc * channels / 8.).ceil()) as usize;
    }
    let ws = |b: u8| matches!(b, 0 | 9 | 10 | 12 | 13 | 32);
    if !c.eat(b"\r\n") && c.0.first().is_some_and(|b| ws(*b)) {
        c.byte();
    }
    let bytes = c.0;
    let mut end = bytes.len();
    for i in minimum..bytes.len().saturating_sub(2) {
        if ws(bytes[i]) && &bytes[i + 1..i + 3] == b"EI" {
            let rest = &bytes[i + 3..];
            if rest
                .first()
                .is_none_or(|b| ws(*b) || b"()<>[]{}/%".contains(b))
                && rest
                    .trim_ascii_start()
                    .iter()
                    .take(16)
                    .take_while(|b| !b"(<%".contains(b))
                    .all(|b| ws(*b) || (32..127).contains(b))
            {
                end = i;
                c.0 = rest;
                break;
            }
        }
    }
    if end == bytes.len() {
        c.0 = &[]
    }
    Ok((dict, &bytes[..end]))
}

pub(super) fn serialize_content(
    data: &[u8],
    isolated: bool,
    tokens: &mut usize,
    limit: usize,
    mut image: impl FnMut(&Dict<'_>, &[u8]) -> Result<Option<String>, String>,
) -> Result<Vec<u8>, String> {
    let mut c = Cursor(data);
    let mut args = vec![];
    let mut groups = vec![];
    let mut text = false;
    let mut out = vec![];
    loop {
        c.skip();
        if c.0.is_empty() {
            break;
        }
        let v = c.value(0, tokens, true).ok_or(BAD)?;
        let op = match v.word() {
            Some(w)
                if !w.starts_with(b"/")
                    && v.number().is_none()
                    && !matches!(w, b"true" | b"false" | b"null") =>
            {
                w
            }
            _ => {
                if args.len() >= 33 {
                    return Err(BAD.into());
                }
                args.push(v);
                continue;
            }
        };
        if matches!(op, b"EMC" | b"Q") {
            let Some(end) = groups.pop() else {
                args.clear();
                continue;
            };
            if text {
                out.extend_from_slice(b"ET\n");
                text = false
            }
            out.extend_from_slice(end);
            args.clear();
            continue;
        }
        match op {
            b"ET" if !text => {
                args.clear();
                continue;
            }
            b"ET" => text = false,
            b"BT" => {
                if text {
                    out.extend_from_slice(b"ET\n")
                }
                text = true
            }
            b"q" => groups.push(b"Q\n".as_slice()),
            b"BDC" | b"BMC" => groups.push(b"EMC\n".as_slice()),
            b"BI" => {
                let (dict, bytes) = inline(&mut c, tokens)?;
                if let Some(name) = image(&dict, bytes)? {
                    writeln!(out, "/{name} Do").unwrap()
                } else {
                    out.extend_from_slice(b"BI ");
                    for (i, (k, v)) in dict.iter().enumerate() {
                        if i != 0 {
                            out.push(b' ')
                        }
                        out.push(b'/');
                        out.extend_from_slice(k);
                        out.push(b' ');
                        encode(v, &mut out)?;
                    }
                    out.extend_from_slice(b" ID\n");
                    out.extend_from_slice(bytes);
                    out.extend_from_slice(b"\nEI\n");
                }
                if out.len() > limit {
                    return Err(LARGE.into());
                }
                args.clear();
                continue;
            }
            _ => (),
        }
        for arg in args.drain(..) {
            if let Value::Array(a) = &arg
                && op == b"TJ"
            {
                out.push(b'[');
                for (i, v) in a.iter().enumerate() {
                    if i > 0 {
                        out.push(b' ')
                    }
                    encode(v, &mut out)?
                }
                out.push(b']');
            } else {
                encode(&arg, &mut out)?
            }
            out.push(b' ');
        }
        out.extend_from_slice(op);
        out.push(b'\n');
        if out.len() > limit {
            return Err(LARGE.into());
        }
    }
    if text {
        out.extend_from_slice(b"ET\n")
    }
    for end in groups.into_iter().rev() {
        out.extend_from_slice(end)
    }
    if !out.is_empty() && !isolated {
        let mut wrapped = b"q\n".to_vec();
        wrapped.extend(out);
        wrapped.extend_from_slice(b"Q\n");
        out = wrapped
    }
    Ok(out)
}
