use super::super::structured::JVal::{Number, Object, Str};
use super::media_probe::{ProbeOptions, Row, report, selected};
use std::fmt::Write;

pub(super) const MUX_ERROR: &str = "Subtitle codec is not supported in this container";
pub(super) const MATROSKA_CODEC_ERROR: &str = "Subtitle codec is not supported in Matroska";
pub(super) const DURATION_ERROR: &str = "Application provided subtitle duration is invalid";
pub(super) const NO_STREAM: &str = "Output file does not contain any stream";
pub(super) const COPY_WEBVTT: &str = "webvtt muxer supports only codec webvtt for type subtitle";

pub(super) fn header(
    metadata: &[(String, String)],
    bitexact: bool,
    limit: usize,
) -> Result<String, &'static str> {
    let mut out = String::new();
    for (index, (key, value)) in metadata.iter().enumerate() {
        if value.is_empty()
            || ["encoder", "encoder_version", "ve"]
                .iter()
                .any(|k| key.eq_ignore_ascii_case(k))
            || !bitexact && key.eq_ignore_ascii_case("re")
        {
            continue;
        }
        let tag = output_tag(key);
        if ["ti", "ar", "al", "au", "by"].contains(&tag)
            && metadata[index + 1..]
                .iter()
                .any(|(k, v)| !v.is_empty() && output_tag(k) == tag)
        {
            continue;
        }
        if tag.len().saturating_add(value.len()).saturating_add(4) > limit.saturating_sub(out.len())
        {
            return Err("output byte limit exceeded");
        }
        writeln!(out, "[{tag}:{}]", value.replace(['\n', '\r'], " ")).unwrap();
    }
    if !bitexact {
        out.push_str("[re:Lavf61.7.100]\n[ve:61.7.100]\n");
    }
    out.push('\n');
    if out.len() > limit {
        return Err("output byte limit exceeded");
    }
    Ok(out)
}

fn output_tag(key: &str) -> &str {
    ["ti", "ar", "al", "au", "by", "re", "ve"]
        .into_iter()
        .find(|tag| tag_name(tag).eq_ignore_ascii_case(key))
        .unwrap_or(key)
}

pub(super) fn write_cue(
    out: &mut String,
    ms: i64,
    body: &str,
    limit: usize,
) -> Result<(), &'static str> {
    let time = ms.saturating_add(ms.signum() * 5) / 10;
    let magnitude = time.unsigned_abs();
    let prefix = format!(
        "[{}{:02}:{:02}.{:02}]",
        if time < 0 { "-" } else { "" },
        magnitude / 6000,
        magnitude / 100 % 60,
        magnitude % 100
    );
    for line in body.trim_matches(['\r', '\n']).split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if prefix.len().saturating_add(line.len()).saturating_add(1)
            > limit.saturating_sub(out.len())
        {
            return Err("output byte limit exceeded");
        }
        writeln!(out, "{prefix}{line}").unwrap();
    }
    Ok(())
}

pub(super) fn encode_text(text: &str, webvtt: bool) -> String {
    let mut out = String::new();
    let mut styles: Vec<(&str, usize)> = Vec::new();
    let mut rest = text;
    while !rest.is_empty() {
        if rest.starts_with('<') {
            let Some(end) = rest.find('>') else {
                break;
            };
            let tag = &rest[1..end];
            let lower = tag.to_ascii_lowercase();
            if !webvtt && matches!(lower.as_str(), "br" | "br/" | "br /") {
                out.push('\n');
            } else if let Some(style) = match lower.as_str() {
                "b" => Some("b"),
                "i" => Some("i"),
                "u" => Some("u"),
                "s" if !webvtt => Some("s"),
                _ => None,
            } {
                styles.push((style, 1));
                write!(out, "<{style}>").unwrap();
            } else if let Some(style) = lower.strip_prefix('/') {
                if let Some(index) = styles.iter().rposition(|(name, _)| *name == style) {
                    while styles.len() > index {
                        let (name, count) = styles.pop().unwrap();
                        for _ in 0..count {
                            write!(out, "</{name}>").unwrap();
                        }
                    }
                }
            } else if !webvtt && (lower == "font" || lower.starts_with("font ")) {
                let mut attrs = tag[4..].trim();
                let mut count = 0;
                while let Some((key, value)) = attrs.split_once('=') {
                    let key = key.trim();
                    let value = value.trim_start();
                    let (value, tail) = if let Some(quote) =
                        value.chars().next().filter(|&c| matches!(c, '\'' | '"'))
                    {
                        let Some(parts) = value[1..].split_once(quote) else {
                            break;
                        };
                        parts
                    } else {
                        value.split_once(char::is_whitespace).unwrap_or((value, ""))
                    };
                    if key == "color" {
                        let color = value
                            .strip_prefix('#')
                            .filter(|s| s.len() == 6)
                            .and_then(|s| u32::from_str_radix(s, 16).ok())
                            .or_else(|| {
                                super::magick_color::css_named_color(value).map(|[r, g, b, _]| {
                                    u32::from(r) * 65536 + u32::from(g) * 256 + u32::from(b)
                                })
                            });
                        if let Some(color) = color {
                            write!(out, "<font color=\"#{color:06x}\">").unwrap();
                            count += 1;
                        }
                    } else if key == "face" || key == "size" && value.parse::<u32>().is_ok() {
                        write!(out, "<font {key}=\"{value}\">").unwrap();
                        count += 1;
                    }
                    attrs = tail.trim_start();
                }
                styles.push(("font", count));
            }
            rest = &rest[end + 1..];
        } else if webvtt
            && rest.starts_with('&')
            && let Some(end) = rest.find(';')
        {
            let entity = match &rest[..=end] {
                "&amp;" => Some("&"),
                "&lt;" => Some("<"),
                "&gt;" => Some(">"),
                "&nbsp;" => Some("\\h"),
                "&lrm;" => Some("\u{200e}"),
                "&rlm;" => Some("\u{200f}"),
                _ => None,
            };
            if let Some(c) = entity {
                out.push_str(c);
                rest = &rest[end + 1..];
            } else {
                out.push('&');
                rest = &rest[1..];
            }
        } else {
            let c = rest.chars().next().unwrap();
            if c != '\r' { out.push(c); }
            rest = &rest[c.len_utf8()..];
        }
    }
    while let Some((name, count)) = styles.pop() {
        for _ in 0..count {
            write!(out, "</{name}>").unwrap();
        }
    }
    if webvtt {
        return out;
    }
    let last = out.lines().count().saturating_sub(1);
    out.split('\n')
        .take_while(|s| !s.trim_matches([' ', '\t']).is_empty())
        .enumerate()
        .map(|(i, s)| {
            let s = s.trim_start_matches(' ');
            if i == last {
                s.trim_end_matches(' ')
            } else {
                s.trim_end_matches([' ', '\t'])
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(super) struct Packet {
    pub pts: i64,
    pub duration: i64,
    pub pos: usize,
    pub data: Vec<u8>,
}

pub(super) struct Document {
    pub packet_side_data: std::collections::BTreeMap<usize, Vec<&'static str>>,
    pub format: &'static str,
    pub decoded: std::collections::BTreeMap<usize, Result<String, &'static str>>,
    pub extradata_size: usize,
    pub extradata: Vec<u8>,
    pub ass_header: Option<super::ass::Header>,
    pub time_base: (i64, i64),
    pub packets: Vec<Packet>,
    pub tags: Vec<(String, String)>,
}

pub(super) fn rescale(value: i64, time_base: (i64, i64), scale: i64) -> i64 {
    if value == i64::MIN { return i64::MIN; }
    let value = i128::from(value) * i128::from(time_base.0) * i128::from(scale);
    let denominator = i128::from(time_base.1);
    i64::try_from((value + value.signum() * (denominator / 2)) / denominator).unwrap_or(i64::MIN)
}

// The raw-text decoder escapes ASS punctuation before the subtitle encoder
// interprets line breaks and override blocks. HTML remains literal text.
pub(super) fn ass_text(data: &[u8]) -> String {
    let text = String::from_utf8_lossy(data.split(|&b| b == 0).next().unwrap_or_default());
    let text = text.strip_suffix('\n').unwrap_or(&text);
    text.replace('\\', "\\\\")
        .replace('{', "\\{")
        .replace('}', "\\}")
}

pub(super) fn decode_ass(mut rest: &str, webvtt: bool, header: Option<(&super::ass::Header, &str)>) -> String {
    rest = rest.trim_start_matches(' ');
    let mut out = String::new();
    let mut styles = Vec::new();
    let mut aligned = header.and_then(|(h, name)| h.style(name)).is_some_and(|style| style.apply(&mut out, &mut styles, webvtt));
    while !rest.is_empty() {
        if rest.starts_with("\\N") || rest.starts_with("\\n") {
            out.push_str(if webvtt { "\n" } else { "\r\n" });
            rest = &rest[2..];
            continue;
        }
        if rest.starts_with("{\\")
            && let Some(end) = rest.find('}')
        {
            for tag in rest[1..end].split('\\').filter(|s| !s.is_empty()) {
                if let Some(name) = tag.strip_prefix('r') {
                    for name in styles.drain(..).rev() { write!(out, "</{name}>").unwrap(); }
                    if let Some(style) = header.and_then(|(h, _)| h.style(name)) { aligned |= style.apply(&mut out, &mut styles, webvtt); }
                    continue;
                }
                if !webvtt && !aligned && let Some(value) = tag.strip_prefix("an").and_then(|s| s.parse::<u8>().ok()).or_else(|| tag.strip_prefix('a').and_then(|s| s.parse::<u8>().ok()).map(|a| (a & 3) + if a & 4 != 0 { 6 } else if a & 8 != 0 { 3 } else { 0 })) { write!(out, "{{\\an{value}}}").unwrap(); aligned = true; }
                if !webvtt {
                    if matches!(tag, "fn" | "fs" | "c" | "1c") {
                        if let Some(i) = styles.iter().rposition(|&s| s == "font") { for name in styles.drain(i..).rev() { write!(out, "</{name}>").unwrap(); } }
                        continue;
                    }
                    let font = if let Some(size) = tag.strip_prefix("fs").and_then(|s| super::text_subtitles::number(&mut s.as_bytes(), usize::MAX)).filter(|&size| size >= 0) {
                        Some(format!("<font size=\"{size}\">"))
                    } else if let Some(name) = tag.strip_prefix("fn") {
                        Some(format!("<font face=\"{name}\">"))
                    } else { tag.strip_prefix("1c&H").or_else(|| tag.strip_prefix("c&H"))
                        .and_then(|s| u32::from_str_radix(s.trim_end_matches('&'), 16).ok())
                        .map(|color| format!("<font color=\"#{:02x}{:02x}{:02x}\">", color & 255, color >> 8 & 255, color >> 16 & 255)) };
                    if let Some(font) = font { out.push_str(&font); styles.push("font"); continue; }
                }
                let (name, value) = tag.split_at(tag.chars().next().unwrap().len_utf8());
                if ["b", "i", "u", "s"].contains(&name)
                    && !(webvtt && name == "s")
                    && let Ok(value) = value.parse::<i32>()
                {
                    if value != 0 {
                        write!(out, "<{name}>").unwrap();
                        if styles.len() < 64 { styles.push(name); }
                    } else if value == 0
                        && let Some(i) = styles.iter().rposition(|&s| s == name)
                    {
                        for name in styles.drain(i..).rev() { write!(out, "</{name}>").unwrap(); }
                    }
                }
            }
            rest = &rest[end + 1..];
            continue;
        }
        let c = rest.chars().next().unwrap();
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    for name in styles.into_iter().rev() {
        write!(out, "</{name}>").unwrap();
    }
    out
}

// LRC's numeric fields accept integer prefixes. The fraction is centiseconds,
// including when it has fewer or more than two digits.
fn integer(bytes: &[u8]) -> Option<(bool, u64, usize)> {
    let mut i = bytes.iter().take_while(|b| b.is_ascii_whitespace()).count();
    let negative = bytes.get(i) == Some(&b'-');
    i += usize::from(matches!(bytes.get(i), Some(b'+' | b'-')));
    let start = i;
    let mut n = 0u64;
    while let Some(b) = bytes.get(i).filter(|b| b.is_ascii_digit()) {
        n = n.saturating_mul(10).saturating_add(u64::from(*b - b'0'));
        i += 1;
    }
    (i > start).then_some((negative, n, i))
}

fn timestamp(bytes: &[u8]) -> Option<(i64, usize)> {
    let bytes = bytes.strip_prefix(b"[")?;
    let negative = bytes.starts_with(b"-");
    let mut rest = &bytes[usize::from(negative)..];
    let mut value = 0u64;
    for (scale, separator) in [(60000, Some(b':')), (1000, Some(b'.')), (10, None)] {
        let (sign, n, used) = integer(rest)?;
        value = value.wrapping_add(if sign { n.wrapping_neg() } else { n }.wrapping_mul(scale));
        rest = &rest[used..];
        if let Some(separator) = separator {
            rest = rest.strip_prefix(&[separator])?;
        }
    }
    let value = if negative {
        value.wrapping_neg()
    } else {
        value
    } as i64;
    let end = bytes
        .iter()
        .position(|&b| b == b']')
        .map_or(bytes.len(), |i| i + 1);
    Some((value.clamp(i64::MIN / 4, i64::MAX / 4), end + 1))
}

fn tag_name(key: &str) -> &str {
    match key {
        "ti" => "title",
        "ar" => "artist",
        "al" => "album",
        "au" => "author",
        "by" => "creator",
        "re" => "encoder",
        "ve" => "encoder_version",
        _ => key,
    }
}

pub(super) fn score(bytes: &[u8]) -> u8 {
    let bytes = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes);
    let bytes = &bytes[bytes
        .iter()
        .take_while(|&&b| matches!(b, b'\r' | b'\n'))
        .count()..];
    if !bytes.starts_with(b"[") {
        return 0;
    }
    if timestamp(bytes).is_some() {
        return 50;
    }
    if ["offset:", "ti:", "ar:", "al:", "au:", "by:", "re:", "ve:"]
        .iter()
        .any(|s| bytes[1..].starts_with(s.as_bytes()))
    {
        40
    } else {
        5
    }
}

impl Document {
    pub(super) fn has_frame(&self, packet: &Packet) -> bool {
        std::str::from_utf8(&packet.data).is_ok()
            && (self.format == "lrc" || packet.data.first().is_some_and(|&b| b != 0))
            && (self.format != "jacosub" || super::jacosub::text(&packet.data).is_some())
            && (self.format != "microdvd" || !super::microdvd::text(&packet.data).is_empty())
            && (self.format != "realtext" || super::smil_subtitles::realtext(&packet.data).is_ok())
            && self.decoded.get(&packet.pos).is_none_or(Result::is_ok)
    }

    pub(super) fn ass_text(&self, packet: &Packet) -> String {
        if let Some(text) = self.decoded.get(&packet.pos) { return text.as_ref().cloned().unwrap_or_default(); }
        let data = &packet.data;
        if self.format == "jacosub" { return super::jacosub::text(data).unwrap_or_default(); }
        if self.format == "microdvd" { return super::microdvd::text(data); }
        if self.format == "realtext" { return super::smil_subtitles::realtext(data).unwrap_or_default(); }
        if self.format == "ass" { return String::from_utf8_lossy(data).splitn(9, ',').nth(8).unwrap_or("").trim_start().to_owned(); }
        if self.format == "subviewer" { return String::from_utf8_lossy(data).replace("[br]", "\\N").replace('\n', "\\N").replace('\r', ""); }
        if self.format == "mpl2" {
            let text = String::from_utf8_lossy(data.split(|&b| b == 0).next().unwrap_or_default());
            let text = text.strip_prefix(' ').unwrap_or(&text);
            let mut out = String::new();
            let mut lines = text.split('|').peekable();
            while let Some(mut line) = lines.next() {
                let mut styled = false;
                while let Some(c) = line.chars().next().filter(|c| matches!(c, '/' | '\\' | '_')) {
                    out.push_str(match c { '/' => "{\\i1}", '\\' => "{\\b1}", _ => "{\\u1}" });
                    styled = true;
                    line = &line[1..];
                }
                out.extend(line.chars().filter(|c| !matches!(c, '\r' | '\n')));
                if lines.peek().is_some() {
                    if styled { out.push_str("{\\r}"); }
                    out.push_str("\\N");
                }
            }
            return out;
        }
        let text = ass_text(data);
        if self.format == "aqtitle" { return text.replace('\n', "\\N"); }
        if self.format != "lrc" { text.replace('|', "\\N") } else { text }
    }

    pub(super) fn convert(
        &self,
        format: &str,
        copy: bool,
        seek: f64,
        range: (Option<f64>, Option<f64>),
        limit: usize,
    ) -> Result<String, &'static str> {
        if format == "microdvd" { return if copy && self.format == "microdvd" { super::microdvd::write(self, seek, range, limit) } else { Err(MUX_ERROR) }; }
        if format == "ass" { return super::ass::write(self, copy, seek, range, limit); }
        if copy && !matches!(self.format, "lrc" | "aqtitle") { return Err(MUX_ERROR); }
        if copy && format == "webvtt" {
            return Err(COPY_WEBVTT);
        }
        let mut out = if format == "webvtt" {
            "WEBVTT\n".to_owned()
        } else {
            String::new()
        };
        let seek = (seek * 1000.).round() as i64;
        let start = range.0.map(|s| (s * 1000.).round() as i64);
        let end = range.1.map(|s| (s * 1000.).round() as i64);
        let mut shift = None;
        let mut index = 0;
        for p in &self.packets {
            if !copy && !self.has_frame(p) { continue; }
            let duration = rescale(p.duration, self.time_base, 1000);
            let duration = if !copy { i64::from(duration as u32) } else { duration };
            let micros = rescale(p.timestamp(), self.time_base, 1_000_000);
            if micros == i64::MIN { continue; }
            let pts = rescale(micros, (1, 1_000_000), 1000).saturating_sub(seek);
            if start.is_some_and(|start| pts < start) || end.is_some_and(|end| pts >= end) {
                continue;
            }
            if copy && duration < 0 && format != "lrc" {
                continue;
            }
            if !copy && p.data.first().is_none_or(|&b| b == 0) {
                continue;
            }
            if format == "ttml" {
                let shift = *shift.get_or_insert(pts.min(0).saturating_neg());
                let pts = pts.saturating_add(shift);
                super::ttml::cue(&mut out, pts, pts.saturating_add(duration), &self.ass_text(p), limit)?;
                continue;
            }
            let body = if copy {
                String::from_utf8_lossy(p.data.split(|&b| b == 0).next().unwrap_or_default())
                    .into_owned()
            } else {
                decode_ass(&self.ass_text(p), format == "webvtt", self.ass_header.as_ref().map(|h| (h, if self.format == "ass" { std::str::from_utf8(&p.data).unwrap_or("").split(',').nth(2).unwrap_or("") } else { "Default" })))
            };
            if body.len() > limit.saturating_sub(out.len()) {
                return Err("output byte limit exceeded");
            }
            if format == "lrc" {
                write_cue(&mut out, pts, &body, limit)?;
                continue;
            }
            let shift = *shift.get_or_insert(pts.min(0).saturating_neg());
            let pts = pts.saturating_add(shift);
            index += 1;
            if format == "webvtt" {
                out.push('\n');
            } else {
                writeln!(out, "{index}").unwrap();
            }
            let sep = if format == "webvtt" { '.' } else { ',' };
            super::subtitles::timestamp(&mut out, pts, sep, format == "webvtt");
            out.push_str(" --> ");
            super::subtitles::timestamp(
                &mut out,
                pts.saturating_add(duration),
                sep,
                format == "webvtt",
            );
            writeln!(out, "\n{body}").unwrap();
            if format != "webvtt" {
                out.push('\n');
            }
        }
        if out.len() > limit {
            return Err("output byte limit exceeded");
        }
        Ok(out)
    }

    pub(super) fn read(bytes: &[u8], remaining: &mut usize) -> Result<Self, &'static str> {
        let limit = *remaining;
        let mut doc = Self {
            format: "lrc",
            packet_side_data:Default::default(),
            decoded:Default::default(),
            ass_header: None,
            extradata_size: 0,
            extradata: Vec::new(),
            time_base: (1, 1000),
            packets: Vec::new(),
            tags: Vec::new(),
        };
        let (mut pos, mut offset, mut used) = (0, 0i64, bytes.len());
        if used > limit {
            return Err("input byte limit exceeded");
        }
        for raw in bytes.split_inclusive(|&b| b == b'\n') {
            let position = pos;
            pos += raw.len();
            let mut line: Vec<u8> = raw.iter().copied().filter(|&b| b != b'\r').collect();
            if !raw.ends_with(b"\n") {
                line.push(0);
            }
            let first = line
                .iter()
                .position(|&b| !matches!(b, b' ' | b'\t'))
                .unwrap_or(line.len());
            if line.get(first) == Some(&b'[')
                && line.get(first + 1).is_some_and(u8::is_ascii_lowercase)
            {
                if let Some(colon) = line.iter().position(|&b| b == b':')
                    && let Some(end) = line
                        .iter()
                        .position(|&b| b == b']')
                        .filter(|&end| end > colon)
                {
                    let key = String::from_utf8_lossy(&line[1..colon]);
                    let value = &line[colon + 1..end];
                    if key == "offset"
                        && let Some((negative, n, _)) = integer(value)
                    {
                        offset = if negative {
                            -(n.min((i64::MAX / 4) as u64 + 1) as i64)
                        } else {
                            n.min((i64::MAX / 4) as u64) as i64
                        };
                    } else {
                        let key = tag_name(&key).to_owned();
                        let value = String::from_utf8_lossy(value).into_owned();
                        if let Some((_, old)) = doc
                            .tags
                            .iter_mut()
                            .find(|(k, _)| k.eq_ignore_ascii_case(&key))
                        {
                            used = used.saturating_sub(old.len()).saturating_add(value.len());
                            if used > limit {
                                return Err("subtitle metadata exceeds memory budget");
                            }
                            *old = value;
                        } else {
                            used = used
                                .saturating_add(size_of::<(String, String)>())
                                .saturating_add(key.len())
                                .saturating_add(value.len());
                            if used > limit {
                                return Err("subtitle metadata exceeds memory budget");
                            }
                            doc.tags.push((key, value));
                        }
                    }
                }
                continue;
            }
            let (mut start, mut brackets) = (0, 0usize);
            for &b in &line {
                match b {
                    b' ' | b'\t' => {}
                    b'[' => brackets += 1,
                    b']' if brackets > 0 => brackets -= 1,
                    b':' | b'.' | b'-' | b'0'..=b'9' if brackets > 0 => {}
                    _ => break,
                }
                start += 1;
            }
            let mut rest = &line[..];
            while let Some((pts, length)) = timestamp(rest) {
                let data = &line[start..];
                used = used
                    .saturating_add(size_of::<Packet>())
                    .saturating_add(data.len());
                if used > limit {
                    return Err("subtitle packets exceed memory budget");
                }
                doc.packets.push(Packet {
                    pts: pts - offset,
                    duration: -1,
                    pos: position,
                    data: data.to_vec(),
                });
                rest = &rest[length..];
            }
        }
        doc.packets.sort_by_key(|p| (p.pts, p.pos));
        for i in 1..doc.packets.len() {
            doc.packets[i - 1].duration = doc.packets[i].pts - doc.packets[i - 1].pts;
        }
        *remaining -= used;
        Ok(doc)
    }

    pub(super) fn report(
        &self,
        filename: &str,
        bytes: usize,
        probe_score: u8,
        mut opts: ProbeOptions<'_>,
    ) -> Result<String, &'static str> {
        let enabled = selected(opts.select, "subtitle", 0, 0);
        let counts = (
            opts.counts.0 || opts.show.contains("frame"),
            opts.counts.1 || opts.show.contains("packet"),
        );
        if opts.show.contains("packet") && opts.show.contains("frame") {
            opts.show.remove("packet");
            opts.show.remove("frame");
            opts.show.insert("packet_frame");
        }
        let optional = !matches!(opts.writer, "json" | "xml");
        let packet_row = |p: &Packet| {
            let mut row = p.row(false, self.time_base, optional);
            if let Some(names) = self.packet_side_data.get(&p.pos) {
                row.push(("side_data_list", super::super::structured::JVal::Array(names.iter().map(|name| Object(vec![("side_data_type".into(), Str((*name).into()))])).collect())));
            }
            row
        };
        report(opts, |section| match section {
            "stream" if enabled => {
                let mut row = vec![
                    ("index", Number(0., None)),
                    ("codec_name", Str(if self.format == "srt" { "subrip" } else if !matches!(self.format, "lrc" | "aqtitle") { self.format } else { "text" }.into())),
                    ("codec_long_name", Str(match self.format { "srt" => "SubRip subtitle", "webvtt" => "WebVTT subtitle", "jacosub" => "JACOsub subtitle", "sami" => "SAMI subtitle", "realtext" => "RealText subtitle", "microdvd" => "MicroDVD subtitle", "ass" => "ASS (Advanced SSA) subtitle", "pjs" => "PJS (Phoenix Japanimation Society) subtitle", "mpl2" => "MPL2 subtitle", "vplayer" => "VPlayer subtitle", "stl" => "Spruce subtitle format", "subviewer" => "SubViewer subtitle", "subviewer1" => "SubViewer v1 subtitle", _ => "raw UTF-8 text" }.into())),
                    ("codec_type", Str("subtitle".into())),
                    ("codec_tag_string", Str("[0][0][0][0]".into())),
                    ("codec_tag", Str("0x0000".into())),
                    ("r_frame_rate", Str("0/0".into())),
                    ("avg_frame_rate", Str("0/0".into())),
                    ("time_base", Str(format!("{}/{}", self.time_base.0, self.time_base.1))),
                ];
                if optional {
                    row.insert(3, ("profile", Str("unknown".into())));
                    let at = row.iter().position(|(key, _)| *key == "r_frame_rate").unwrap();
                    row.splice(at..at, ["width", "height", "id"].map(|key| (key, Str("N/A".into()))));
                }
                if let Some(first) = self.packets.iter().find(|p| p.pts != i64::MIN).or_else(|| self.packets.first()).filter(|_| self.format == "lrc" || counts.0 || counts.1) {
                    if first.pts >= i64::from(i32::MIN) && rescale(first.pts, self.time_base, 1_000_000) != i64::MIN {
                        row.push(("start_pts", Number(first.pts as f64, None)));
                        row.push(("start_time", Str(format!("{:.6}", first.pts as f64 * (self.time_base.0 as f64 / self.time_base.1 as f64)))));
                    }
                    for (key, enabled) in
                        [("nb_read_frames", counts.0), ("nb_read_packets", counts.1)]
                    {
                        if enabled {
                            let count = self.packets.iter().filter(|p| key != "nb_read_frames" || self.has_frame(p)).count();
                            if count > 0 { row.push((key, Str(count.to_string()))); }
                        }
                    }
                }
                if optional {
                    let at = row.iter().position(|(key, _)| matches!(*key, "nb_read_frames" | "nb_read_packets")).unwrap_or(row.len());
                    row.splice(at..at, ["duration_ts", "duration", "bit_rate", "max_bit_rate", "bits_per_raw_sample", "nb_frames"].map(|key| (key, Str("N/A".into()))));
                    let at = row.iter().position(|(key, _)| *key == "duration_ts").unwrap();
                    if !row.iter().any(|(key, _)| *key == "start_pts") { row.splice(at..at, ["start_pts", "start_time"].map(|key| (key, Str("N/A".into())))); }
                    if !row.iter().any(|(key, _)| *key == "nb_read_frames") {
                        let at = row.iter().position(|(key, _)| *key == "nb_read_packets").unwrap_or(row.len());
                        row.insert(at, ("nb_read_frames", Str("N/A".into())));
                    }
                    if !row.iter().any(|(key, _)| *key == "nb_read_packets") { row.push(("nb_read_packets", Str("N/A".into()))); }
                }
                let extradata_size = self.extradata_size.max(self.extradata.len());
                if extradata_size > 0 { row.push(("extradata_size", Number(extradata_size as f64, None))); }
                let mut disposition = super::media_probe::disposition(false);
                disposition.extend(
                    [
                        "non_diegetic",
                        "captions",
                        "descriptions",
                        "metadata",
                        "dependent",
                        "still_image",
                    ]
                    .map(|key| (key.into(), Number(0., None))),
                );
                row.push(("disposition", Object(disposition)));
                Box::new(std::iter::once(row))
            }
            "format" => {
                let mut row = vec![
                    ("filename", Str(filename.into())),
                    ("nb_streams", Number(1., None)),
                    ("nb_programs", Number(0., None)),
                    ("nb_stream_groups", Number(0., None)),
                    ("format_name", Str(self.format.into())),
                    ("format_long_name", Str(match self.format { "srt" => "SubRip subtitle", "webvtt" => "WebVTT subtitle", "jacosub" => "JACOsub subtitle format", "sami" => "SAMI subtitle format", "realtext" => "RealText subtitle format", "microdvd" => "MicroDVD subtitle format", "aqtitle" => "AQTitle subtitles", "ass" => "SSA (SubStation Alpha) subtitle", "pjs" => "PJS (Phoenix Japanimation Society) subtitles", "mpl2" => "MPL2 subtitles", "vplayer" => "VPlayer subtitles", "stl" => "Spruce subtitle format", "subviewer" => "SubViewer subtitle format", "subviewer1" => "SubViewer v1 subtitle format", _ => "LRC lyrics" }.into())),
                    ("size", Str(bytes.to_string())),
                    ("probe_score", Number(f64::from(probe_score), None)),
                ];
                if optional {
                    row.splice(6..6, ["start_time", "duration"].map(|key| (key, Str("N/A".into()))));
                    row.insert(9, ("bit_rate", Str("N/A".into())));
                }
                if !self.tags.is_empty() {
                    row.push((
                        "tags",
                        Object(
                            self.tags
                                .iter()
                                .map(|(k, v)| (k.clone(), Str(v.clone())))
                                .collect(),
                        ),
                    ));
                }
                Box::new(std::iter::once(row))
            }
            "packet_frame" if enabled => Box::new(self.packets.iter().flat_map(move |p| {
                let mut packet = packet_row(p);
                packet.insert(0, ("type", Str("packet".into())));
                let frame = if p.data.first().is_some_and(|&b| b != 0) && self.has_frame(p) {
                    let mut frame = p.row(true, self.time_base, optional);
                    frame.insert(0, ("type", Str("subtitle".into())));
                    Some(frame)
                } else { None };
                [Some(packet), frame].into_iter().flatten()
            })),
            "packet" | "frame" if enabled => {
                Box::new(self.packets.iter().filter(move |p| section != "frame" || self.has_frame(p)).map(move |p| if section == "frame" { p.row(true, self.time_base, optional) } else { packet_row(p) }))
            }
            _ => Box::new(std::iter::empty()),
        })
    }
}

impl Packet {
    pub(super) fn timestamp(&self) -> i64 {
        // libavformat removes its relative-time origin when returning packets.
        let base = i64::MAX - (1 << 48);
        if self.pts > base - (1 << 48) { self.pts - base } else { self.pts }
    }

    fn row(&self, frame: bool, time_base: (i64, i64), optional: bool) -> Row {
        let pts = self.timestamp();
        let time = Str(format!("{:.6}", pts as f64 * (time_base.0 as f64 / time_base.1 as f64)));
        if frame {
            let mut row = vec![
                ("media_type", Str("subtitle".into())),
            ];
            let pts = rescale(pts, time_base, 1_000_000);
            if pts != i64::MIN {
                row.extend([("pts", Number(pts as f64, None)), ("pts_time", time)]);
            } else if optional { row.extend(["pts", "pts_time"].map(|key| (key, Str("N/A".into())))); }
            row.extend([
                ("format", Number(1., None)),
                ("start_display_time", Number(0., None)),
                (
                    "end_display_time",
                    Number(f64::from(rescale(self.duration, time_base, 1000) as u32), None),
                ),
                ("num_rects", Number(1., None)),
            ]);
            return row;
        }
        let mut row = vec![
            ("codec_type", Str("subtitle".into())),
            ("stream_index", Number(0., None)),
        ];
        if pts != i64::MIN {
            row.extend([("pts", Number(pts as f64, None)), ("pts_time", time.clone()), ("dts", Number(pts as f64, None)), ("dts_time", time)]);
        } else if optional { row.extend(["pts", "pts_time", "dts", "dts_time"].map(|key| (key, Str("N/A".into())))); }
        if self.duration != 0 {
            row.push(("duration", Number(self.duration as f64, None)));
            row.push((
                "duration_time",
                Str(format!("{:.6}", self.duration as f64 * (time_base.0 as f64 / time_base.1 as f64))),
            ));
        } else if optional { row.extend(["duration", "duration_time"].map(|key| (key, Str("N/A".into())))); }
        row.push(("size", Str(self.data.len().to_string())));
        if self.pos != usize::MAX { row.push(("pos", Str(self.pos.to_string()))); }
        else if optional { row.push(("pos", Str("N/A".into()))); }
        row.push(("flags", Str("K__".into())));
        row
    }
}
