use std::{collections::BTreeMap, fmt::Write};
use super::{ass::{Header, Style}, lrc::{Document, rescale}, text_subtitles::number};

pub(super) fn packet(line: &[u8]) -> Option<(i64, i64, &[u8])> {
    let mut rest = line.strip_prefix(b"{")?;
    let start = number(&mut rest, usize::MAX)?;
    rest = rest.strip_prefix(b"}{")?;
    if rest.is_empty() { return None; }
    let duration = number(&mut rest, usize::MAX).map_or(-1, |end| end - start);
    let data = line.splitn(3, |&b| b == b'}').nth(2)?;
    if data.is_empty() { return None; }
    Some((start, duration, data))
}

pub(super) fn score(mut bytes: &[u8]) -> u8 {
    bytes = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes);
    for _ in 0..3 {
        let valid = (|| {
            if let Some(rest) = bytes.strip_prefix(b"{DEFAULT}{}") { return !rest.is_empty() && rest[0] != 0; }
            let Some(mut rest) = bytes.strip_prefix(b"{") else { return false; };
            if number(&mut rest, usize::MAX).is_none() { return false; }
            let Some(tail) = rest.strip_prefix(b"}{") else { return false; };
            rest = tail;
            if rest.first() != Some(&b'}') && number(&mut rest, usize::MAX).is_none() { return false; }
            rest.strip_prefix(b"}").is_some_and(|tail| !tail.is_empty() && tail[0] != 0)
        })();
        if !valid { return 0; }
        let end = bytes.iter().position(|b| matches!(b, 0 | b'\r' | b'\n')).unwrap_or(bytes.len());
        bytes = &bytes[end..];
        while bytes.first() == Some(&b'\r') { bytes = &bytes[1..]; }
        if bytes.first() == Some(&b'\n') { bytes = &bytes[1..]; }
    }
    100
}

pub(super) fn frame_rate(line: &[u8]) -> Option<f64> {
    let mut rest = line.strip_prefix(b"{")?;
    if number(&mut rest, usize::MAX)? > 1 { return None; }
    rest = rest.strip_prefix(b"}{")?;
    if rest.first() != Some(&b'}') { number(&mut rest, usize::MAX)?; }
    rest = rest.strip_prefix(b"}")?.trim_ascii_start();
    let field = &rest[..rest.len().min(6)];
    // scanf's field width applies after leading whitespace, and accepts a numeric prefix.
    let rate = (1..=field.len()).rev().find_map(|n| std::str::from_utf8(&field[..n]).ok()?.parse::<f64>().ok())?;
    (rate > 3. && rate < 100.).then_some(rate)
}

#[derive(Clone, Copy, Default)]
struct Tag<'a> { key: u8, persistent: u8, value: i32, second: i32, text: &'a str }

fn integer(text: &mut &str, radix: u32) -> i32 {
    let original = *text;
    let mut field = text.trim_start_matches(|c: char| c.is_ascii_whitespace());
    let negative = field.starts_with('-');
    if field.starts_with(['+', '-']) { field = &field[1..]; }
    if radix == 16 && (field.starts_with("0x") || field.starts_with("0X")) && field.as_bytes().get(2).is_some_and(u8::is_ascii_hexdigit) { field = &field[2..]; }
    let digits = field.bytes().take_while(|&b| char::from(b).is_digit(radix)).count();
    if digits == 0 { *text = original; return 0; }
    let value = u64::from_str_radix(&field[..digits], radix).unwrap_or(u64::MAX);
    *text = &field[digits..];
    if negative { (value.min(1u64 << 63) as i64).wrapping_neg() as i32 } else { value.min(i64::MAX as u64) as i32 }
}

fn load<'a>(tags: &mut [Tag<'a>; 8], mut text: &'a str) -> &'a str {
    if let Some(rest) = text.strip_prefix('/') { tags[4].key = b'y'; tags[4].value |= 1; text = rest; }
    while text.starts_with('{') && text.as_bytes().get(2) == Some(&b':') {
        let start = text;
        let key = text.as_bytes()[1];
        let mut rest = &text[3..];
        let mut tag = Tag { key: key.to_ascii_lowercase(), persistent:u8::from(matches!(key, b'Y' | b'C' | b'F' | b'S' | b'P')), ..Tag::default() };
        match key {
            b'y' | b'Y' => {
                let Some(end) = rest.find('}').filter(|&n| n + 3 < 256) else { break; };
                tag.key = key;
                for c in rest[..end].bytes() { if let Some(index) = b"ibus".iter().position(|&b| b == c) { tag.value |= 1 << index; } }
                rest = &rest[end..];
            }
            b'c' | b'C' => { rest = rest.trim_start_matches(['$', '#']); tag.value = integer(&mut rest, 16) & 0xffffff; }
            b's' | b'S' => tag.value = integer(&mut rest, 10),
            b'f' | b'F' | b'H' => { let Some(end) = rest.find('}') else { break; }; tag.text = &rest[..end]; rest = &rest[end..]; }
            b'P' => { if rest.as_bytes().get(1) != Some(&b'}') { break; } tag.value = i32::from(rest.starts_with('1')); rest = &rest[1..]; }
            b'o' => { tag.persistent = 1; tag.value = integer(&mut rest, 10); let Some(tail) = rest.strip_prefix(',') else { break; }; rest = tail; tag.second = integer(&mut rest, 10); }
            _ => break,
        }
        let Some(rest) = rest.strip_prefix('}') else { return start; };
        let Some(index) = b"cfshyYpo".iter().position(|&b| b == tag.key) else { return start; };
        tags[index] = tag;
        text = rest;
    }
    if let Some(rest) = text.strip_prefix('/') { tags[4].key = b'y'; tags[4].value |= 1; text = rest; }
    text
}

pub(super) fn text(data: &[u8]) -> String {
    let text = String::from_utf8_lossy(data.split(|&b| b == 0).next().unwrap_or_default());
    let mut rest = text.as_ref();
    let mut tags = [Tag::default(); 8];
    let mut out = String::new();
    while !rest.is_empty() {
        rest = load(&mut tags, rest);
        for tag in &mut tags {
            if tag.persistent == 2 { continue; }
            match tag.key {
                b'y' | b'Y' => { for (i, c) in b"ibus".iter().enumerate() { if tag.value & (1 << i) != 0 { write!(out, "{{\\{}1}}", char::from(*c)).unwrap(); } } }
                b'c' => write!(out, "{{\\c&H{:06X}&}}", tag.value).unwrap(),
                b'f' => write!(out, "{{\\fn{}}}", tag.text).unwrap(),
                b's' => write!(out, "{{\\fs{}}}", tag.value).unwrap(),
                b'p' if tag.value == 0 => out.push_str("{\\an8}"),
                b'o' => write!(out, "{{\\pos({},{})}}", tag.value, tag.second).unwrap(),
                _ => {}
            }
            if tag.persistent == 1 { tag.persistent = 2; }
        }
        let end = rest.find('|').unwrap_or(rest.len());
        out.push_str(&rest[..end]);
        rest = &rest[end..];
        if let Some(tail) = rest.strip_prefix('|') {
            for tag in tags.iter_mut().rev() {
                if tag.persistent != 0 { continue; }
                match tag.key {
                    b'y' => { for (i, c) in b"ibus".iter().enumerate().rev() { if tag.value & (1 << i) != 0 { write!(out, "{{\\{}0}}", char::from(*c)).unwrap(); } } }
                    b'c' => out.push_str("{\\c}"), b'f' => out.push_str("{\\fn}"), b's' => out.push_str("{\\fs}"), _ => {}
                }
                tag.key = 0;
            }
            out.push_str("\\N");
            rest = tail;
        }
    }
    if out.len() > 2047 { let mut end = 2047; while !out.is_char_boundary(end) { end -= 1; } out.truncate(end); }
    out
}

pub(super) fn header(data: &[u8]) -> Header {
    let text = String::from_utf8_lossy(data);
    let mut tags = [Tag::default(); 8];
    load(&mut tags, &text);
    let mut style = Style { font:"Arial".into(), size:16, color:0xffffff, alignment:2, ..Style::default() };
    for tag in tags {
        match tag.key.to_ascii_lowercase() {
            b'y' => { style.italic |= tag.value & 1 != 0; style.bold |= tag.value & 2 != 0; style.underline |= tag.value & 4 != 0; }
            b'c' => style.color = tag.value as u32, b'f' => style.font = tag.text.into(), b's' => style.size = tag.value, b'p' => style.alignment = 8, _ => {}
        }
    }
    let line = format!("Style: Default,{},{},&H{:x},&H{:x},&H0,&H0,{},{},{},0,100,100,0,0,1,1,0,{},10,10,10,1", style.font, style.size, style.color, style.color, -i32::from(style.bold), -i32::from(style.italic), -i32::from(style.underline), style.alignment);
    let original = super::subtitles::ASS_HEADER.lines().find(|line| line.starts_with("Style:")).unwrap();
    Header { text:super::subtitles::ASS_HEADER.replace(original, &line), styles:BTreeMap::from([("Default".into(), style)]) }
}

pub(super) fn write(doc: &Document, seek: f64, range: (Option<f64>, Option<f64>), limit: usize) -> Result<String, &'static str> {
    let mut out = String::new();
    if !doc.extradata.is_empty() { writeln!(out, "{{DEFAULT}}{{}}{}", String::from_utf8_lossy(&doc.extradata)).unwrap(); }
    let seek = (seek * 1_000_000.).round() as i64;
    let start = range.0.map(|s| (s * 1_000_000.).round() as i64);
    let end = range.1.map(|s| (s * 1_000_000.).round() as i64);
    for packet in &doc.packets {
        let micros = rescale(packet.timestamp(), doc.time_base, 1_000_000).saturating_sub(seek);
        if start.is_some_and(|s| micros < s) || end.is_some_and(|s| micros >= s) { continue; }
        let offset = rescale(seek.saturating_add(start.unwrap_or(0)), (doc.time_base.1, 1_000_000 * doc.time_base.0), 1);
        let pts = packet.timestamp().saturating_sub(offset);
        write!(out, "{{{pts}}}").unwrap();
        if packet.duration < 0 { out.push_str("{}"); } else { write!(out, "{{{}}}", pts.saturating_add(packet.duration)).unwrap(); }
        out.push_str(&String::from_utf8_lossy(&packet.data)); out.push('\n');
        if out.len() > limit { return Err("output byte limit exceeded"); }
    }
    Ok(out)
}
