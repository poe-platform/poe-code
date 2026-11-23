use super::{atoms, u16_at, u32_at};
use std::borrow::Cow;
use std::fmt::Write;

struct Style<'a> {
    start: usize,
    end: usize,
    attributes: &'a [u8],
}

pub(super) fn decode<'a>(
    packet: &'a [u8],
    entry: &[u8],
    format: &str,
    limit: usize,
) -> Result<Cow<'a, [u8]>, &'static str> {
    if packet.len() < 2 { return Ok(Cow::Borrowed(packet)); }
    let end = (usize::from(u16_at(packet, 0)) + 2).min(packet.len());
    let text = &packet[2..end];
    if text.len() > limit { return Err("output byte limit exceeded"); }
    let default = entry.get(30..38).unwrap_or(&[0, 1, 0, 16, 255, 255, 255, 255]);
    let mut styles: Vec<Style<'_>> = Vec::new();
    let mut rest = &packet[end..];
    while rest.len() >= 8 {
        let mut size = u64::from(u32_at(rest, 0));
        let header = if size == 1 {
            let Some(bytes) = rest.get(8..16) else { break; };
            size = u64::from_be_bytes(bytes.try_into().unwrap());
            16
        } else { 8 };
        if size < header as u64 { return Err("invalid timed-text modifier size"); }
        if size > rest.len() as u64 { break; }
        let body = &rest[header..size as usize];
        if &rest[4..8] == b"styl" && body.len() >= 2 {
            let count = usize::from(u16_at(body, 0));
            if count <= (body.len() - 2) / 12 {
                styles.clear();
                for record in body[2..].chunks_exact(12).take(count) {
                    let (start, end) = (usize::from(u16_at(record, 0)), usize::from(u16_at(record, 2)));
                    if end < start || styles.last().is_some_and(|s| start < s.end) {
                        styles.clear();
                        break;
                    }
                    let attributes = &record[4..];
                    if start == end || attributes == default { continue; }
                    if let Some(last) = styles.last_mut().filter(|s| s.end == start && s.attributes == attributes) {
                        last.end = end;
                    } else {
                        if styles.len() >= limit.saturating_sub(text.len()) / size_of::<Style>() {
                            return Err("subtitle styles exceed memory budget");
                        }
                        styles.push(Style { start, end, attributes });
                    }
                }
            }
        }
        rest = &rest[size as usize..];
    }
    let mut fonts = Vec::new();
    for (_, table) in atoms(entry.get(38..).unwrap_or_default()).filter(|(tag, _)| *tag == b"ftab") {
        let mut rest = table.get(2..).unwrap_or_default();
        for _ in 0..u16_at(table, 0) {
            let Some(&length) = rest.get(2) else { break; };
            let Some(name) = rest.get(3..3 + usize::from(length)) else { break; };
            if fonts.len() >= limit / size_of::<(u16, &[u8])>() { return Err("subtitle fonts exceed memory budget"); }
            fonts.push((u16_at(rest, 0), name));
            rest = &rest[3 + usize::from(length)..];
        }
    }
    let font = fonts.iter().find(|(id, _)| *id == u16_at(default, 0)).map_or("Arial".into(), |(_, name)| String::from_utf8_lossy(name));
    let style = super::super::ass::Style {
        font: font.into_owned(), size: i32::from(default[3]),
        color: u32::from(default[4]) | u32::from(default[5]) << 8 | u32::from(default[6]) << 16,
        bold: default[2] & 1 != 0, italic: default[2] & 2 != 0, underline: default[2] & 4 != 0, alignment: 2,
    };
    if styles.is_empty() && style.font == "Arial" && style.size == 16 && style.color == 0xffffff && default[2] == 0
        && !text.iter().any(|b| matches!(b, b'\\' | b'{' | b'\r' | b'\n' | 0)) {
        return Ok(Cow::Borrowed(&text[text.iter().take_while(|&&b| b == b' ').count()..]));
    }
    let header = super::super::ass::Header { text: String::new(), styles: [("Default".into(), style)].into() };
    let mut ass = String::new();
    let mut index = 0;
    for (position, c) in String::from_utf8_lossy(text).chars().enumerate() {
        if let Some(style) = styles.get(index) && position == style.end {
            ass.push_str("{\\r}");
            index += 1;
        }
        if let Some(style) = styles.get(index).filter(|s| s.start == position) {
            let a = style.attributes;
            for (bit, name) in [(1, 'b'), (2, 'i'), (4, 'u')] {
                if (a[2] ^ default[2]) & bit != 0 { write!(ass, "{{\\{name}{}}}", u8::from(a[2] & bit != 0)).unwrap(); }
            }
            if a[3] != default[3] { write!(ass, "{{\\fs{}}}", a[3]).unwrap(); }
            if a[..2] != default[..2] {
                for (_, name) in fonts.iter().filter(|(id, _)| *id == u16_at(a, 0)) {
                    write!(ass, "{{\\fn{}}}", String::from_utf8_lossy(name)).unwrap();
                    if ass.len() > limit { return Err("output byte limit exceeded"); }
                }
            }
            if a[4..7] != default[4..7] { write!(ass, "{{\\1c&H{:02X}{:02X}{:02X}&}}", a[6], a[5], a[4]).unwrap(); }
        }
        match c { '\r' => {}, '\n' => ass.push_str("\\N"), '\0' => break, _ => ass.push(c) }
        if ass.len() > limit { return Err("output byte limit exceeded"); }
    }
    if format == "ttml" { return Ok(Cow::Owned(ass.into_bytes())); }
    let decoded = super::super::lrc::decode_ass(ass.trim_start_matches(' '), format == "webvtt", Some((&header, "Default")));
    if decoded.len() > limit { return Err("output byte limit exceeded"); }
    Ok(Cow::Owned(decoded.into_bytes()))
}
