use super::super::{Cursor, Dict, Value, pdf_rewrite::encode};
use std::io::Write;
const BAD: &str = "invalid PDF content stream";
const LARGE: &str = "PDF output byte limit exceeded";
// Binary image data can itself contain " EI". For unfiltered images start
// looking for the terminator only after the last expected scanline.
pub(super) fn inline<'a>(c: &mut Cursor<'a>, tokens: &mut usize) -> Result<(Dict<'a>, &'a [u8]), String> {
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
    let filter = match field(b"F", b"Filter") {
        Some(Value::Array(filters)) => filters.first().and_then(Value::word),
        value => value.and_then(Value::word),
    };
    // The outer filter delimits the encoded payload. Never interpret an EI in
    // a stored deflate block, run-length literal or ASCII85 group as an operator.
    let length = match filter {
        Some(b"/Fl" | b"/FlateDecode") if bytes.len() >= 2 && bytes[0] & 15 == 8
            && u16::from_be_bytes([bytes[0],bytes[1]]) % 31 == 0 && bytes[1] & 32 == 0 => {
            let used = crate::commands::codecs::deflate_member(&bytes[2..], usize::MAX, None).map_err(|_| BAD)?;
            Some(used.checked_add(6).ok_or(BAD)?)
        }
        Some(b"/DCT" | b"/DCTDecode") if bytes.starts_with(b"\xff\xd8") => {
            Some(crate::commands::archive::image_header::jpeg_length(bytes).ok_or(BAD)?)
        }
        Some(b"/RL" | b"/RunLengthDecode") => {
            let mut at = 0;
            loop {
                let n = *bytes.get(at).ok_or(BAD)?;
                at += 1;
                if n == 128 { break; }
                at = at.checked_add(if n < 128 { usize::from(n) + 1 } else { 1 }).ok_or(BAD)?;
            }
            Some(at)
        }
        Some(b"/A85" | b"/ASCII85Decode") => bytes.windows(2).position(|w| w == b"~>").map(|i| i+2),
        Some(b"/AHx" | b"/ASCIIHexDecode") => bytes.iter().position(|&b| b == b'>').map(|i| i+1),
        None if minimum != 0 => Some(minimum),
        _ => None,
    };
    if let Some(n) = length {
        let mut rest = Cursor(bytes.get(n..).ok_or(BAD)?);
        if rest.word() == Some(b"EI") {
            c.0 = rest.0;
            return Ok((dict, &bytes[..n]));
        }
        minimum = n;
    }
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

// Fixed argument counts and recovery match the PDF.js-derived operator table
// in pdf-ast/src/content/operators.ts. Copyright 2017 Mozilla Foundation,
// Apache-2.0; see packages/pdf-ast/THIRD_PARTY_NOTICES.md.
fn arity(op: &[u8]) -> Option<usize> {
    Some(match op {
        b"q" | b"Q" | b"h" | b"S" | b"s" | b"f" | b"F" | b"f*" | b"B" | b"B*" | b"b" | b"b*"
        | b"n" | b"W" | b"W*" | b"BT" | b"ET" | b"T*" | b"BI" | b"ID" | b"EMC" | b"BX" | b"EX" => 0,
        b"w" | b"J" | b"j" | b"M" | b"ri" | b"i" | b"gs" | b"Tc" | b"Tw" | b"Tz" | b"TL"
        | b"Tr" | b"Ts" | b"Tj" | b"TJ" | b"'" | b"CS" | b"cs" | b"G" | b"g" | b"sh" | b"EI"
        | b"Do" | b"MP" | b"BMC" => 1,
        b"d" | b"m" | b"l" | b"Tf" | b"Td" | b"TD" | b"d0" | b"DP" | b"BDC" => 2,
        b"\"" | b"RG" | b"rg" => 3,
        b"v" | b"y" | b"re" | b"K" | b"k" => 4,
        b"c" | b"cm" | b"Tm" | b"d1" => 6,
        b"SC" | b"SCN" | b"sc" | b"scn" => usize::MAX,
        _ => return None,
    })
}

fn content_value<'a>(c: &mut Cursor<'a>, tokens: &mut usize) -> Option<Value<'a>> {
    // The compatibility lexer accepts adjacent operators such as BT/F1 and
    // TjETQ. Stop as soon as a known keyword cannot be extended.
    let known = |w: &[u8]| {
        arity(w).is_some()
            || matches!(
                w,
                b"BM"
                    | b"BD"
                    | b"true"
                    | b"fa"
                    | b"fal"
                    | b"fals"
                    | b"false"
                    | b"nu"
                    | b"nul"
                    | b"null"
            )
    };
    for n in 1..=c.0.len().min(5) {
        if known(&c.0[..n]) && c.0.get(..n + 1).is_none_or(|w| !known(w)) {
            *tokens = tokens.checked_sub(1)?;
            let (w, rest) = c.0.split_at(n);
            c.0 = rest;
            return Some(Value::Word(w.into()));
        }
    }
    c.value(0, tokens, true)
}

fn text_open(out: &mut Vec<u8>, open: &mut bool) {
    if !*open {
        out.extend_from_slice(b"BT\n");
        *open = true
    }
}
fn text_close(out: &mut Vec<u8>, open: &mut bool) {
    if *open {
        out.extend_from_slice(b"ET\n");
        *open = false
    }
}
fn formatted(n: f64) -> String {
    if n == 0. {
        return "0".into();
    }
    let s = format!("{n:.6}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" { "0".into() } else { s.into() }
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
    let mut saved = vec![];
    let mut groups = vec![];
    let (mut in_text, mut continued, mut open) = (false, false, false);
    let mut path = vec![];
    let mut clip = None;
    let (mut point, mut start) = ([0., 0.], [0., 0.]);
    let mut out = vec![];
    loop {
        if out.len().saturating_add(path.len()) > limit {
            return Err(LARGE.into());
        }
        c.skip();
        if c.0.is_empty() {
            break;
        }
        let v = content_value(&mut c, tokens).ok_or(BAD)?;
        let op = match v.word() {
            Some(b"null") => continue,
            Some(w)
                if !w.starts_with(b"/")
                    && v.number().is_none()
                    && !matches!(w, b"true" | b"false") =>
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
        let Some(count) = arity(op) else { continue };
        if count != usize::MAX {
            if args.len() > count {
                saved.extend(args.drain(..args.len() - count))
            }
            while args.len() < count {
                let Some(v) = saved.pop() else { break };
                args.insert(0, v)
            }
            if args.len() < count {
                args.clear();
                continue;
            }
        }
        let nums =
            |i: usize, fallback: f64| args.get(i).and_then(Value::number).unwrap_or(fallback);
        if matches!(op, b"q" | b"Q" | b"EMC" | b"BDC" | b"BMC" | b"BI") && in_text && !continued {
            text_open(&mut out, &mut open);
            continued = true;
        }
        match op {
            b"BT" => {
                in_text = true;
                continued = false;
                continue;
            }
            b"ET" => {
                if in_text {
                    if !continued {
                        text_close(&mut out, &mut open)
                    }
                    text_open(&mut out, &mut open);
                    text_close(&mut out, &mut open);
                }
                in_text = false;
                continued = false;
                continue;
            }
            b"q" => {
                groups.push(b"Q\n".as_slice());
                text_close(&mut out, &mut open)
            }
            b"BDC" | b"BMC" => groups.push(b"EMC\n".as_slice()),
            b"Q" | b"EMC" => {
                if let Some(end) = groups.pop() {
                    if end == b"Q\n" {
                        text_close(&mut out, &mut open)
                    }
                    out.extend_from_slice(end)
                }
                continue;
            }
            b"BI" => {
                text_close(&mut out, &mut open);
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
            _ if in_text => {
                if !continued {
                    text_close(&mut out, &mut open)
                }
                text_open(&mut out, &mut open);
                continued = true;
                match op {
                    b"'" | b"\"" | b"Tj" => {
                        if op == b"\"" {
                            writeln!(
                                out,
                                "{} Tw\n{} Tc",
                                formatted(nums(0, 0.)),
                                formatted(nums(1, 0.))
                            )
                            .unwrap()
                        }
                        if op != b"Tj" {
                            out.extend_from_slice(b"T*\n")
                        }
                        if let Some(v @ Value::String { .. }) = args.last() {
                            encode(v, &mut out)?;
                            out.extend_from_slice(b" Tj\n")
                        }
                        args.clear();
                        continue;
                    }
                    b"TJ" => {
                        if let Value::Array(a) = &args[0] {
                            out.push(b'[');
                            for (i, v) in a
                                .iter()
                                .filter(|v| {
                                    matches!(v, Value::String { .. }) || v.number().is_some()
                                })
                                .enumerate()
                            {
                                if i > 0 {
                                    out.push(b' ')
                                }
                                encode(v, &mut out)?
                            }
                            out.extend_from_slice(b"] TJ\n")
                        }
                        args.clear();
                        continue;
                    }
                    b"Tf" => {
                        let name = args[0]
                            .word()
                            .and_then(|w| w.strip_prefix(b"/"))
                            .map(super::super::pdf_string::name)
                            .unwrap_or_else(|| "Helvetica".into());
                        writeln!(out, "/{name} {} Tf", formatted(nums(1, 12.))).unwrap();
                        args.clear();
                        continue;
                    }
                    b"Tm" | b"Td" | b"TD" | b"TL" | b"Tz" | b"Tr" | b"Ts" | b"Tc" | b"Tw" => {
                        for i in 0..count {
                            write!(
                                out,
                                "{} ",
                                formatted(nums(
                                    i,
                                    match (op, i) {
                                        (b"Tm", 0 | 3) => 1.,
                                        (b"Tz", _) => 100.,
                                        _ => 0.,
                                    }
                                ))
                            )
                            .unwrap()
                        }
                        out.extend_from_slice(op);
                        out.push(b'\n');
                        args.clear();
                        continue;
                    }
                    _ => (),
                }
            }
            b"m" | b"l" | b"c" | b"v" | b"y" | b"re" | b"h" => {
                let terms: Vec<_> = (0..count).map(|i| nums(i, 0.)).collect();
                if op == b"v" {
                    for n in point {
                        write!(path, "{} ", formatted(n)).unwrap()
                    }
                }
                for &n in &terms {
                    write!(path, "{} ", formatted(n)).unwrap()
                }
                if op == b"y" {
                    for &n in &terms[2..] {
                        write!(path, "{} ", formatted(n)).unwrap()
                    }
                }
                path.extend_from_slice(if matches!(op, b"v" | b"y") { b"c" } else { op });
                path.push(b'\n');
                point = match op {
                    b"h" => start,
                    b"m" | b"re" => {
                        start = [terms[0], terms[1]];
                        start
                    }
                    _ => [terms[count - 2], terms[count - 1]],
                };
                args.clear();
                continue;
            }
            b"W" | b"W*" => {
                clip = Some(if op == b"W" {
                    b"W\n".as_slice()
                } else {
                    b"W*\n"
                });
                continue;
            }
            b"S" | b"s" | b"f" | b"F" | b"f*" | b"B" | b"B*" | b"b" | b"b*" | b"n" => {
                text_close(&mut out, &mut open);
                out.append(&mut path);
                if let Some(line) = clip.take() {
                    out.extend_from_slice(line)
                }
            }
            _ => text_close(&mut out, &mut open),
        }
        for arg in args.drain(..) {
            encode(&arg, &mut out)?;
            out.push(b' ')
        }
        out.extend_from_slice(op);
        out.push(b'\n');
    }
    if in_text && continued {
        text_open(&mut out, &mut open)
    }
    for end in groups.into_iter().rev() {
        if end == b"Q\n" {
            text_close(&mut out, &mut open)
        }
        out.extend_from_slice(end)
    }
    text_close(&mut out, &mut open);
    if !out.is_empty() && !isolated {
        let mut wrapped = b"q\n".to_vec();
        wrapped.extend(out);
        wrapped.extend_from_slice(b"Q\n");
        out = wrapped
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retains_path_and_text_semantics_while_reserializing_edited_pages() {
        for (input, want) in [
            (
                "0 0 m 10 10 20 20 v 30 20 0 0 y S",
                "0 0 m\n0 0 10 10 20 20 c\n30 20 0 0 0 0 c\nS\n",
            ),
            (
                "0 0 m 0 1 0 rg 1 2 l W* n 5 5 m",
                "0 1 0 rg\n0 0 m\n1 2 l\nW*\nn\n",
            ),
            (
                "qBT/F1 9.500 Tf(a) ' 2 3 (b) \" ETQ",
                "q\nBT\n/F1 9.5 Tf\nT*\n(a) Tj\n2 Tw\n3 Tc\nT*\n(b) Tj\nET\nQ\n",
            ),
            (
                "BT (a) Tj /Span BMC (b) Tj EMC (c) Tj ET BT",
                "BT\n(a) Tj\n/Span BMC\n(b) Tj\nEMC\n(c) Tj\nET\n",
            ),
            (
                "0 1 2 3 rg m 4 4 l S q 1 unknown 2 3 rg Q",
                "1 2 3 rg\n4 4 l\nS\nq\n1 2 3 rg\nQ\n",
            ),
        ] {
            assert_eq!(
                String::from_utf8(
                    serialize_content(input.as_bytes(), true, &mut 4096, 65536, |_, _| Ok(None))
                        .unwrap()
                )
                .unwrap(),
                want,
                "{input}"
            );
        }
    }

    #[test]
    fn inline_jpeg_skips_segment_contents_and_stuffed_scan_bytes() {
        let comment = b" EI Q BT ET q Q abcdefghijklmnopqrstuvwxyz \xff\xd9";
        let jpeg = [b"\xff\xd8\xff\xfe".as_slice(), &((comment.len()+2) as u16).to_be_bytes(), comment,
            b"\xff\xda\x00\x08\x01\x01\x00\x00\x3f\x00", b"\x12\xff\x00\xd9\xff\xd0\x34\xff\xd9"].concat();
        let stream = [b"/F /DCT ID ".as_slice(), &jpeg, b" \r\nEI Q"].concat();
        let mut c = Cursor(&stream);
        assert_eq!(inline(&mut c, &mut 128).unwrap().1, jpeg);
        assert_eq!(c.word(), Some(b"Q".as_slice()));
    }

    #[test]
    fn reads_through_false_ei_tokens_to_the_end_of_the_outer_filter() {
        let pixels = b" EI abcdefghijklmnopqrstuvwxyz";
        let n = pixels.len() as u16;
        let stored = [b"\x78\x01\x01".as_slice(), &n.to_le_bytes(), &(!n).to_le_bytes(),
            pixels, &crate::commands::codecs::adler32(pixels).to_be_bytes()].concat();
        let repeated = [[(n-1) as u8].as_slice(), pixels, &[128]].concat();
        for (filter, payload) in [
            ("/Fl", stored.as_slice()), ("/RL", repeated.as_slice()),
            ("[/A85 /Fl]", b"ABCDE EI ABCDEFGHIJKLMNOPQ~>"),
        ] {
            let dict = format!("/W 10 /H 1 /CS /RGB /BPC 8 /F {filter} ID ");
            let stream = [dict.as_bytes(),payload,b" \r\nEI Q"].concat();
            let mut c = Cursor(&stream);
            assert_eq!(inline(&mut c, &mut 128).unwrap().1, payload, "{filter}");
            assert_eq!(c.word(),Some(b"Q".as_slice()));
        }
    }
}
