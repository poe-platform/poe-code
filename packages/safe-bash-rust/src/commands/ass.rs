use std::{borrow::Cow, collections::BTreeMap, fmt::Write};
use super::{lrc::{Document, Packet}, text_subtitles::number};

#[derive(Default)]
pub(super) struct Style {
    pub font: String,
    pub size: i32,
    pub color: u32,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub alignment: i32,
}

pub(super) struct Header {
    pub text: String,
    pub styles: BTreeMap<String, Style>,
}

impl Header {
    pub(super) fn style(&self, name: &str) -> Option<&Style> {
        self.styles.get(if name.is_empty() { "Default" } else { name })
    }
}

impl Style {
    pub(super) fn apply(&self, out: &mut String, stack: &mut Vec<&str>, webvtt: bool) -> bool {
        let color = self.color & 0xffffff;
        if !webvtt && (!self.font.is_empty() && self.font != "Arial" || self.size != 16 || color != 0xffffff) {
            out.push_str("<font");
            if !self.font.is_empty() && self.font != "Arial" { write!(out, " face=\"{}\"", self.font).unwrap(); }
            if self.size != 16 { write!(out, " size=\"{}\"", self.size).unwrap(); }
            if color != 0xffffff { write!(out, " color=\"#{:02x}{:02x}{:02x}\"", color & 255, color >> 8 & 255, color >> 16).unwrap(); }
            out.push('>');
            stack.push("font");
        }
        for (enabled, name) in [(self.bold, "b"), (self.italic, "i"), (self.underline, "u")] {
            if enabled { write!(out, "<{name}>").unwrap(); stack.push(name); }
        }
        if !webvtt && self.alignment != 2 { write!(out, "{{\\an{}}}", self.alignment).unwrap(); return true; }
        false
    }
}

fn decode(bytes: &[u8]) -> Cow<'_, str> {
    if bytes.starts_with(b"\xff\xfe") || bytes.starts_with(b"\xfe\xff") {
        let little = bytes[0] == 255;
        Cow::Owned(char::decode_utf16(bytes[2..].chunks_exact(2).map(|p| if little { u16::from_le_bytes([p[0], p[1]]) } else { u16::from_be_bytes([p[0], p[1]]) })).map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER)).collect())
    } else { String::from_utf8_lossy(bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes)) }
}

pub(super) fn score(bytes: &[u8]) -> u8 {
    if decode(&bytes[..bytes.len().min(128)]).trim_start_matches(['\r', '\n']).starts_with("[Script Info]") { 100 } else { 0 }
}

fn clock(rest: &mut &[u8]) -> Option<i64> {
    let h = number(rest, usize::MAX)?;
    *rest = rest.strip_prefix(b":")?;
    let m = number(rest, usize::MAX)?;
    *rest = rest.strip_prefix(b":")?;
    let s = number(rest, usize::MAX)?;
    *rest = rest.get(1..)?;
    Some((h * 3600 + m * 60 + s) * 100 + number(rest, usize::MAX)?)
}

pub(super) fn read(bytes: &[u8], remaining: &mut usize) -> Result<Document, &'static str> {
    if bytes.len() > *remaining { return Err("input byte limit exceeded"); }
    let text = decode(bytes);
    let utf16 = bytes.starts_with(b"\xff\xfe") || bytes.starts_with(b"\xfe\xff");
    let mut pos = if utf16 { 2 } else if bytes.starts_with(b"\xef\xbb\xbf") { 3 } else { 0 };
    let mut used = bytes.len().saturating_add(if matches!(text, Cow::Owned(_)) { text.len() } else { 0 });
    let mut header = String::new();
    let mut packets = Vec::new();
    for raw in text.split_inclusive(['\n', '\0']) {
        let position = pos;
        pos += if utf16 { raw.encode_utf16().count() * 2 } else { raw.len() };
        let raw = raw.strip_suffix('\0').unwrap_or(raw);
        if raw.is_empty() { break; }
        let event = (|| {
            let mut rest = raw.as_bytes().strip_prefix(b"Dialogue:")?.trim_ascii_start();
            let end = rest.iter().position(|&b| b == b',')?;
            if end == 0 { return None; }
            let layer = number(&mut &rest[..end], usize::MAX).unwrap_or(0);
            rest = &rest[end + 1..];
            let start = clock(&mut rest)?;
            rest = rest.strip_prefix(b",")?;
            let end = clock(&mut rest)?;
            rest = rest.strip_prefix(b",")?;
            let data = format!("{},{layer},{}", packets.len(), String::from_utf8_lossy(rest).trim_end_matches(['\r', '\n'])).into_bytes();
            Some(Packet { pts:start, duration:(end - start) as i32 as i64, pos:position, data })
        })();
        if let Some(packet) = event {
            used = used.saturating_add(size_of::<Packet>()).saturating_add(packet.data.len());
            if used > *remaining { return Err("subtitle packets exceed memory budget"); }
            packets.push(packet);
        } else {
            used = used.saturating_add(raw.len());
            if used > *remaining { return Err("subtitle header exceeds memory budget"); }
            header.push_str(raw);
        }
    }
    packets.sort_unstable_by_key(|p| (p.pts, p.pos));
    for i in 1..packets.len() {
        if packets[i - 1].duration < 0 && let Some(duration) = packets[i].pts.checked_sub(packets[i - 1].pts) { packets[i - 1].duration = duration; }
    }
    let mut styles = BTreeMap::new();
    let mut fields = Vec::new();
    let mut section = "";
    for line in header.lines() {
        if line.starts_with('[') { section = line; fields.clear(); }
        if !matches!(section, "[V4+ Styles]" | "[V4 Styles]") { continue; }
        if let Some(value) = line.strip_prefix("Format:") { fields = value.split(',').map(str::trim).collect(); }
        if let Some(value) = line.strip_prefix("Style:") {
            let mut style = Style::default();
            let mut name = "";
            for (field, value) in fields.iter().zip(value.split(',').map(str::trim)) {
                let integer = || number(&mut value.as_bytes(), usize::MAX).unwrap_or(0) as i32;
                match *field {
                    "Name" => name = value,
                    "Fontname" => style.font = value.to_owned(),
                    "Fontsize" => style.size = integer(),
                    "PrimaryColour" => style.color = value.strip_prefix("&H").and_then(|s| u32::from_str_radix(s.trim_end_matches('&'), 16).ok()).unwrap_or_else(|| integer() as u32),
                    "Bold" => style.bold = integer() != 0,
                    "Italic" => style.italic = integer() != 0,
                    "Underline" => style.underline = integer() != 0,
                    "Alignment" => { let a = integer(); style.alignment = if section == "[V4 Styles]" { (a & 3) + if a & 4 != 0 { 6 } else if a & 8 != 0 { 3 } else { 0 } } else { a }; }
                    _ => {}
                }
            }
            used = used.saturating_add(size_of::<Style>() + name.len() + style.font.len());
            if used > *remaining { return Err("subtitle styles exceed memory budget"); }
            styles.entry(name.to_owned()).or_insert(style);
        }
    }
    *remaining -= used;
    Ok(Document { packet_side_data:Default::default(), format:"ass", decoded:Default::default(), time_base:(1,100), extradata_size:header.len(), extradata:Vec::new(), packets, tags:Vec::new(), ass_header:Some(Header { text:header, styles }) })
}

pub(super) fn write(doc: &Document, copy: bool, seek: f64, range: (Option<f64>, Option<f64>), limit: usize) -> Result<String, &'static str> {
    if copy && doc.format != "ass" { return Err(super::lrc::MUX_ERROR); }
    let header = doc.ass_header.as_ref().map_or(super::subtitles::ASS_HEADER, |h| h.text.as_str());
    let header = header.replace("\r\n", "\n");
    let trailer = header.find("\n[Events]").and_then(|i| header[i..].find("Format:").map(|n| i + n)).and_then(|i| header[i..].find('\n').map(|n| i + n + 1)).unwrap_or(header.len());
    let mut out = header[..trailer].to_owned();
    let ssa = !header.contains("\n[V4+ Styles]");
    if !header.contains("\n[Events]") && !header.is_empty() { writeln!(out, "[Events]\nFormat: {}, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", if ssa { "Marked" } else { "Layer" }).unwrap(); }
    let mut events = Vec::new();
    let seek = (seek * 100.).round() as i64;
    let from = range.0.map(|s| (s * 100.).round() as i64);
    let end = range.1.map(|s| (s * 100.).round() as i64);
    let mut used = out.len() + header.len() - trailer;
    for (index, packet) in doc.packets.iter().enumerate() {
        if !copy && !doc.has_frame(packet) { continue; }
        let micros = super::lrc::rescale(packet.timestamp(), doc.time_base, 1_000_000);
        if micros == i64::MIN { continue; }
        let pts = super::lrc::rescale(micros, (1, 1_000_000), 100).saturating_sub(seek);
        if from.is_some_and(|s| pts < s) || end.is_some_and(|e| pts >= e) { continue; }
        let millis = super::lrc::rescale(packet.duration, doc.time_base, 1000);
        let duration = if copy { super::lrc::rescale(packet.duration, doc.time_base, 100) } else { (i64::from(millis as u32) + 5) / 10 };
        let pts = pts.saturating_sub(if copy { from.unwrap_or(0) } else { 0 });
        let text = if doc.format == "ass" { String::from_utf8_lossy(&packet.data) } else { Cow::Owned(format!("{index},0,Default,,0,0,0,,{}", doc.ass_text(packet))) };
        let mut parts = text.splitn(3, ',');
        let order = parts.next().and_then(|s| s.parse::<usize>().ok()).unwrap_or(index);
        let layer = parts.next().unwrap_or("0");
        let body = parts.next().unwrap_or("").trim_end_matches(['\r', '\n']);
        let line = format!("Dialogue: {}{layer},{},{},{body}\n", if ssa { "Marked=" } else { "" }, timestamp(pts), timestamp(pts.saturating_add(duration)));
        used = used.saturating_add(line.len());
        if used > limit { return Err("output byte limit exceeded"); }
        events.push((order,line));
    }
    events.sort_by_key(|(order,_)| *order);
    for (_,line) in events { out.push_str(&line); }
    out.push_str(&header[trailer..]);
    if out.len() > limit { return Err("output byte limit exceeded"); }
    Ok(out)
}

pub(super) fn timestamp(t: i64) -> String {
    let hour = (t / 360000) as i32;
    if hour > 9 { return "9:59:59.99".into(); }
    format!("{}:{:02}:{:02}.{:02}", hour, (t / 6000) as i32 % 60, (t / 100) as i32 % 60, t % 100)
}

pub(super) fn from_html(mut text: &str) -> String {
    let mut out = String::new();
    let mut fonts = Vec::new();
    while !text.is_empty() {
        if text.starts_with('<') && let Some(end) = text.find('>') {
            let tag = &text[1..end];
            let (name, close) = tag.strip_prefix('/').map_or((tag, false), |s| (s,true));
            if ["b", "i", "u", "s"].contains(&name) {
                write!(out, "{{\\{name}{}}}", if close { 0 } else { 1 }).unwrap();
            } else if name == "font" && close {
                let mut fields = vec![fonts.pop()];
                let mut suffix = &text[end + 1..];
                while let Some(rest) = suffix.strip_prefix("</font>") { fields.push(fonts.pop()); suffix = rest; }
                for field in ["fs", "c", "fn"] { if fields.contains(&Some(field)) { write!(out, "{{\\{field}}}").unwrap(); } }
                text = suffix;
                continue;
            } else if let Some(attrs) = tag.strip_prefix("font ") {
                let field = if attrs.starts_with("face=") { "fn" } else if attrs.starts_with("size=") { "fs" } else { "c" };
                let value = attrs.split_once('=').map_or("", |(_,s)| s.trim_matches('"'));
                if field == "c" {
                    if let Some(color) = value.strip_prefix('#').and_then(|s| u32::from_str_radix(s,16).ok()) {
                        write!(out, "{{\\c&H{:02X}{:02X}{:02X}&}}", color & 255, color >> 8 & 255, color >> 16).unwrap();
                    }
                } else { write!(out, "{{\\{field}{value}}}").unwrap(); }
                fonts.push(field);
            } else { out.push_str(&text[..=end]); }
            text = &text[end + 1..];
        } else {
            let c = text.chars().next().unwrap();
            if c == '\n' { out.push_str("\\N"); } else if c != '\r' { out.push(c); }
            text = &text[c.len_utf8()..];
        }
    }
    out
}
