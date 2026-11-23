use super::{lrc::{Document, Packet}, text_subtitles::number};
use std::fmt::Write;

pub(super) const HEADER_ERROR: &str = "Cannot allocate memory";

fn whitespace(bytes: &[u8]) -> &[u8] {
    &bytes[bytes.iter().take_while(|&&b| b == b' ' || (b'\t'..=b'\r').contains(&b)).count()..]
}

fn times(mut line: &[u8], rate: u32) -> Option<(i32, i32, &[u8], bool)> {
    let original = line;
    let clock = |line: &mut &[u8]| {
        let h = number(line, usize::MAX)? as u32;
        *line = line.strip_prefix(b":")?;
        let m = number(line, usize::MAX)? as u32;
        *line = line.strip_prefix(b":")?;
        let s = number(line, usize::MAX)? as u32;
        *line = line.strip_prefix(b".")?;
        let f = number(line, usize::MAX)? as u32;
        Some(h.wrapping_mul(3600).wrapping_add(m.wrapping_mul(60)).wrapping_add(s).wrapping_mul(rate).wrapping_add(f) as i32)
    };
    if let Some(start) = clock(&mut line) && let Some(end) = clock(&mut line) {
        return Some((start, end, whitespace(line), true));
    }
    line = original.strip_prefix(b"@")?;
    let start = number(&mut line, usize::MAX)? as i32;
    line = whitespace(line).strip_prefix(b"@")?;
    let end = number(&mut line, usize::MAX)? as i32;
    Some((start, end, whitespace(line), false))
}

fn timed(line: &[u8]) -> bool {
    times(line, 30).is_some_and(|(start, end, text, clock)| (clock || start < end) && text.first().is_some_and(|&b| b != 0))
}

pub(super) fn score(bytes: &[u8]) -> u8 {
    let mut rest = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes);
    while !rest.is_empty() {
        rest = whitespace(rest);
        if rest.first().is_some_and(|&b| b != b'#') { return if timed(rest) { 51 } else { 0 }; }
        rest = rest.iter().position(|b| matches!(b, b'\r' | b'\n')).map_or(&[][..], |i| &rest[i + 1..]);
    }
    0
}

fn shift(mut text: &[u8], rate: u32) -> i32 {
    let negative = text.first() == Some(&b'-');
    let mut parts = Vec::new();
    while let Some(n) = number(&mut text, usize::MAX) {
        parts.push(n);
        if parts.len() == 4 || !text.first().is_some_and(|b| matches!(b, b'.' | b':')) { break; }
        text = &text[1..];
    }
    let Some(first) = parts.first_mut() else { return 0; };
    if *first == i64::from(i32::MIN) { return 0; }
    let negative = negative || *first < 0;
    *first = first.abs();
    let (h, m, s, d) = match parts.as_slice() {
        [s,d] => (0,0,*s,*d), [m,s,d] => (0,*m,*s,*d), [h,m,s,d] => (*h,*m,*s,*d), _ => (0,0,0,0),
    };
    let value = ((i128::from(h) * 3600 + i128::from(m) * 60 + i128::from(s)) * i128::from(rate) + i128::from(d)) * if negative { -1 } else { 1 };
    i32::try_from(value).unwrap_or(0)
}

pub(super) fn read(bytes: &[u8], remaining: &mut usize, seek: Option<f64>) -> Result<Document, &'static str> {
    let mut doc = Document { packet_side_data:Default::default(), format:"jacosub", time_base:(1,100), packets:Vec::new(), tags:Vec::new(), ass_header:None, extradata_size:0, extradata:Vec::new(), decoded:Default::default() };
    let (mut pos, mut used, mut rate, mut offset, mut merged) = (0, bytes.len(), 30u32, None, false);
    if used > *remaining { return Err("input byte limit exceeded"); }
    while pos < bytes.len() {
        let position = pos;
        let end = bytes[pos..].iter().position(|b| matches!(b, 0 | b'\r' | b'\n')).map_or(bytes.len(), |i| pos + i);
        pos = end + usize::from(end < bytes.len());
        if bytes.get(end) == Some(&b'\r') && bytes.get(pos) == Some(&b'\n') { pos += 1; }
        let stored = (end - position + usize::from(bytes.get(end).is_some_and(|&b| b != 0))).min(511);
        let raw = &bytes[position..position + stored];
        let p = whitespace(raw);
        if merged || timed(p) {
            used = used.saturating_add(raw.len()).saturating_add(if merged { 0 } else { size_of::<Packet>() });
            if used > *remaining { return Err("subtitle packets exceed memory budget"); }
            if !merged { doc.packets.push(Packet { pts:0, duration:0, pos:position, data:Vec::new() }); }
            let packet = doc.packets.last_mut().unwrap();
            packet.data.extend_from_slice(raw); packet.pos = position;
            merged = raw.ends_with(b"\\\n");
            continue;
        }
        let Some(command) = p.strip_prefix(b"#") else { continue; };
        let name = match command.first().map(u8::to_ascii_uppercase) { Some(b'T') => b"TIMERES".as_slice(), Some(b'S') => b"SHIFT".as_slice(), _ => continue };
        let length = if command.get(..name.len()).is_some_and(|s| s.eq_ignore_ascii_case(name)) { name.len() } else { 1 };
        let value = whitespace(&command[length..]);
        if name[0] == b'T' {
            rate = super::text_subtitles::integer(&mut &value[..]).and_then(|n| u32::try_from(n).ok()).filter(|&n| n > 0).unwrap_or(0);
            if rate == 0 { rate = 30; continue; }
        } else { offset.get_or_insert_with(|| shift(value, rate)); }
        let count = 3 + value.len();
        if count > 4095usize.saturating_sub(doc.extradata.len()) { return Err(HEADER_ERROR); }
        used = used.saturating_add(count);
        if used > *remaining { return Err("subtitle header exceeds memory budget"); }
        doc.extradata.extend([b'#', name[0], b' '].into_iter().chain(value.iter().copied()).take(count));
    }
    for packet in &mut doc.packets {
        if let Some((start, end, _, _)) = times(&packet.data, rate) {
            let time = |n| (i64::from(n) + i64::from(offset.unwrap_or(0))) * 100 / i64::from(rate);
            packet.pts = time(start); packet.duration = time(end) - packet.pts;
        }
    }
    doc.packets.sort_unstable_by_key(|p| (p.pts, p.pos));
    for i in 1..doc.packets.len() {
        if doc.packets[i - 1].duration < 0 { doc.packets[i - 1].duration = doc.packets[i].pts - doc.packets[i - 1].pts; }
    }
    doc.packets.dedup_by(|a,b| a.pts == b.pts && a.duration == b.duration && a.data == b.data);
    if let Some(seek) = seek {
        let index = super::subtitles::seek_index(&doc.packets, (seek * 100.).round() as i64, |p| (p.pts, p.duration));
        doc.packets.drain(..index);
    }
    *remaining -= used;
    Ok(doc)
}

pub(super) fn text(data: &[u8]) -> Option<String> {
    let data = data.split(|&b| b == 0).next()?;
    let mut src = whitespace(data);
    for _ in 0..2 { src = &src[src.iter().position(|&b| b == b' ')? + 1..]; }
    let mut out = String::new();
    if src.first().is_some_and(|b| b.is_ascii_alphabetic() || *b == b'[') {
        let size = src.iter().take_while(|&&b| b != b' ' && !(b'\t'..=b'\r').contains(&b)).count().min(127);
        let directives = String::from_utf8_lossy(&src[..size]).to_ascii_uppercase();
        src = whitespace(&src[size..]);
        let vertical = if directives.contains("VB") { Some(0) } else if directives.contains("VM") { Some(3) } else if directives.contains("VT") { Some(6) } else { None };
        let horizontal = if directives.contains("JC") { Some(2) } else if directives.contains("JL") { Some(1) } else if directives.contains("JR") { Some(3) } else { None };
        if vertical.is_some() || horizontal.is_some() { write!(out, "{{\\an{}}}", vertical.unwrap_or(0) + horizontal.unwrap_or(2)).unwrap(); }
    }
    let mut out = out.into_bytes();
    while !src.is_empty() && src[0] != b'\n' && out.len() < 511 {
        if src.starts_with(b"\\\n") { src = whitespace(&src[2..]); continue; }
        let mut rest = src;
        if let Some((from,to)) = [(b"\\~".as_slice(), "~"), (b"~", "{\\h}"), (b"\\n", "\\N"), (b"\\N", "{\\r}"), (b"\\I", "{\\i1}"), (b"\\i", "{\\i0}"), (b"\\B", "{\\b1}"), (b"\\b", "{\\b0}"), (b"\\U", "{\\u1}"), (b"\\u", "{\\u0}")].into_iter().find(|(from,_)| src.starts_with(from)) {
            out.extend_from_slice(to.as_bytes()); rest = &src[from.len()..];
        } else if src.starts_with(b"\\C") || src.starts_with(b"\\F") { rest = &src[src.len().min(3)..]; }
        else if src.starts_with(b"\\D") || src.starts_with(b"\\T") {
            let fmt = if src[1] == b'D' { "%d %b %Y" } else { "%H:%M" };
            if let Ok(time) = super::super::coreutils::format_strftime_for_printf(fmt, (crate::vfs::now_ms() / 1000.) as i64, None) { out.extend_from_slice(time.as_bytes()); }
            rest = &src[2..];
        }
        if rest.len() == src.len() { out.push(src[0]); rest = &src[1..]; }
        out.truncate(511); src = rest;
    }
    Some(String::from_utf8_lossy(&out).into_owned())
}
