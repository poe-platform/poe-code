use std::borrow::Cow;
use super::{lrc::{Document, Packet}, text_subtitles::number};

fn source(bytes: &[u8]) -> Cow<'_, [u8]> {
    if bytes.starts_with(b"\xff\xfe") || bytes.starts_with(b"\xfe\xff") {
        let little = bytes[0] == 255;
        let text: String = char::decode_utf16(bytes[2..].chunks_exact(2).map(|p| if little { u16::from_le_bytes([p[0], p[1]]) } else { u16::from_be_bytes([p[0], p[1]]) })).map(|c| c.unwrap_or('\0')).collect();
        Cow::Owned(text.into_bytes())
    } else { Cow::Borrowed(bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes)) }
}

pub(super) fn score(format: &str, bytes: &[u8]) -> u8 {
    let data = source(&bytes[..bytes.len().min(32)]);
    if format == "sami" { return if data.starts_with(b"<SAMI>") { 100 } else { 0 }; }
    if data.get(..7).is_some_and(|s| s.eq_ignore_ascii_case(b"<window")) { 50 } else { 0 }
}

fn timestamp(bytes: &[u8]) -> i64 {
    for (fields, fraction) in [(3, true), (3, false), (2, true), (2, false), (1, true)] {
        let mut rest = bytes;
        let mut seconds = 0;
        let parsed = (|| {
            for i in 0..fields {
                if i > 0 { rest = rest.strip_prefix(b":")?; }
                seconds = seconds * 60 + number(&mut rest, usize::MAX)?;
            }
            let centis = if fraction { rest = rest.strip_prefix(b".")?; number(&mut rest, usize::MAX)? } else { 0 };
            Some(seconds * 100 + centis)
        })();
        if let Some(value) = parsed { return value; }
    }
    let bytes = &bytes[bytes.iter().position(|b| !b.is_ascii_whitespace() && *b != 11).unwrap_or(bytes.len())..];
    let sign = usize::from(bytes.first().is_some_and(|b| matches!(b, b'+' | b'-')));
    let digits = bytes[sign..].iter().take_while(|b| b.is_ascii_digit()).count();
    if digits == 0 { return 0; }
    std::str::from_utf8(&bytes[..sign + digits]).unwrap().parse::<i64>().unwrap_or(if bytes[0] == b'-' { i64::MIN } else { i64::MAX }).wrapping_mul(100)
}

fn attr<'a>(mut bytes: &'a [u8], name: &[u8]) -> Option<&'a [u8]> {
    let mut quoted = false;
    while !bytes.is_empty() {
        while let Some((&b, tail)) = bytes.split_first() {
            if !quoted && (b.is_ascii_whitespace() || b == 11) { break; }
            quoted ^= b == b'"';
            bytes = tail;
        }
        bytes = &bytes[bytes.iter().position(|b| !b.is_ascii_whitespace() && *b != 11).unwrap_or(bytes.len())..];
        if bytes.get(..name.len()).is_some_and(|s| s.eq_ignore_ascii_case(name)) && bytes.get(name.len()) == Some(&b'=') {
            let value = &bytes[name.len() + 1..];
            return Some(value.strip_prefix(b"\"").unwrap_or(value));
        }
    }
    None
}

pub(super) fn read(format: &'static str, bytes: &[u8], remaining: &mut usize, seek: Option<f64>) -> Result<Document, &'static str> {
    let mut used = bytes.len();
    if used > *remaining { return Err("input byte limit exceeded"); }
    let utf16 = bytes.starts_with(b"\xff\xfe") || bytes.starts_with(b"\xfe\xff");
    let mut physical = if utf16 { 2 } else if bytes.starts_with(b"\xef\xbb\xbf") { 3 } else { 0 };
    let data = source(bytes);
    if utf16 { used = used.saturating_add(data.len()); }
    if used > *remaining { return Err("subtitle text exceeds memory budget"); }
    let mut doc = Document { packet_side_data:Default::default(), format, time_base:(1, if format == "sami" { 1000 } else { 100 }), packets:Vec::new(), tags:Vec::new(), ass_header:None, extradata_size:0, extradata:Vec::new(), decoded:Default::default() };
    let (mut pos, mut cached, mut duration) = (0, false, 6000);
    while pos < data.len() && data[pos] != 0 {
        let position = physical + usize::from(utf16 && cached);
        let tag = data[pos] == b'<';
        let delimiter = if tag { b'>' } else { b'<' };
        let end = data[pos..].iter().position(|&b| b == delimiter || b == 0).map_or(data.len(), |i| pos + i);
        let chunk = &data[pos..end];
        let next = (end + usize::from(tag || data.get(end) == Some(&0))).min(data.len());
        cached = !tag && data.get(end) == Some(&b'<');
        physical += if utf16 { std::str::from_utf8(&data[pos..next]).unwrap().encode_utf16().count() * 2 } else { next - pos };
        pos = next;
        let len = chunk.len() + usize::from(tag);
        let sync = chunk.get(..5).is_some_and(|s| s.eq_ignore_ascii_case(b"<SYNC"));
        if format == "sami" && chunk.get(..6).is_some_and(|s| s.eq_ignore_ascii_case(b"</BODY")) { break; }
        if format == "sami" && !sync && doc.packets.is_empty() {
            doc.extradata_size += len;
            used = used.saturating_add(len);
            if used > *remaining { return Err("subtitle header exceeds memory budget"); }
            continue;
        }
        if format == "realtext" && chunk.get(..7).is_some_and(|s| s.eq_ignore_ascii_case(b"<window")) {
            if doc.extradata_size > 0 { return Err("Invalid data found when processing input"); }
            if let Some(value) = attr(chunk, b"duration") { duration = timestamp(value) as i32 as i64; }
            doc.extradata_size = len + 1;
            used = used.saturating_add(doc.extradata_size);
            if used > *remaining { return Err("subtitle header exceeds memory budget"); }
            continue;
        }
        let new_event = if format == "sami" { sync } else { chunk.get(..5).is_some_and(|s| s.eq_ignore_ascii_case(b"<time")) };
        let new_packet = new_event || doc.packets.is_empty();
        used = used.saturating_add(len).saturating_add(if new_packet { size_of::<Packet>() } else { 0 });
        if used > *remaining { return Err("subtitle packets exceed memory budget"); }
        if new_packet {
            let pts = if format == "sami" {
                let pts = attr(chunk, b"Start").map_or(0, super::sami::timestamp);
                if pts <= i64::MIN / 2 || pts >= i64::MAX / 2 { return Err(super::sami::TIMESTAMP_ERROR); }
                pts
            } else if new_event { attr(chunk, b"begin").map_or(0, timestamp) } else { 0 };
            let end = attr(chunk, b"end").map(timestamp);
            let duration = if format == "sami" { -1 } else if new_event { end.and_then(|end| end.checked_sub(pts)).filter(|&d| d > 0).unwrap_or(duration) } else { 0 };
            // FFmpeg has no byte position for text preceding the first time tag.
            doc.packets.push(Packet { pts, duration, pos:if new_event { position } else { usize::MAX }, data:Vec::new() });
        }
        let packet = doc.packets.last_mut().unwrap();
        packet.data.extend_from_slice(chunk);
        if tag { packet.data.push(b'>'); }
    }
    doc.packets.sort_unstable_by_key(|p| (p.pts, p.pos.wrapping_add(1)));
    for i in 1..doc.packets.len() {
        if doc.packets[i - 1].duration < 0 && let Some(duration) = doc.packets[i].pts.checked_sub(doc.packets[i - 1].pts) { doc.packets[i - 1].duration = duration; }
    }
    doc.packets.dedup_by(|a, b| a.pts == b.pts && a.duration == b.duration && a.data == b.data);
    if let Some(seek) = seek && doc.packets.len() > 1 {
        let ts = (seek * doc.time_base.1 as f64).round() as i64;
        let index = super::subtitles::seek_index(&doc.packets, ts, |p| (p.pts, p.duration));
        doc.packets.drain(..index);
    }
    if format == "sami" {
        let mut speaker = Vec::new();
        for packet in &doc.packets {
            let text = super::sami::text(&packet.data, &mut speaker);
            used = used.saturating_add(size_of::<(usize, Result<String, &str>)>() + text.as_ref().map_or(0, String::len));
            if used > *remaining { return Err("decoded subtitles exceed memory budget"); }
            doc.decoded.insert(packet.pos, text);
        }
    }
    *remaining -= used;
    Ok(doc)
}

pub(super) fn realtext(data: &[u8]) -> Result<String, std::string::FromUtf8Error> {
    let mut rest = data.split(|&b| b == 0).next().unwrap_or_default();
    let mut space = true;
    let mut out = Vec::new();
    while let Some((&b, tail)) = rest.split_first() {
        if b == b'<' {
            let Some(end) = rest.iter().position(|&b| b == b'>') else { break; };
            if rest[..=end].eq_ignore_ascii_case(b"<br>") || rest[..=end].eq_ignore_ascii_case(b"<br/>") { out.extend_from_slice(b"\\N"); }
            rest = &rest[end + 1..];
        } else {
            let whitespace = b.is_ascii_whitespace() || b == 11;
            if !whitespace { out.push(b); }
            else if !space { out.push(b' '); }
            space = whitespace;
            rest = tail;
        }
        if out.len() >= 4095 { out.truncate(4095); break; }
    }
    String::from_utf8(out)
}
