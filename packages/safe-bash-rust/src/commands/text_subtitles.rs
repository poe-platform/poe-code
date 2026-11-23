use super::lrc::{Document, Packet};

pub(super) fn number(rest: &mut &[u8], width: usize) -> Option<i64> {
    *rest = &rest[rest.iter().position(|b| !b.is_ascii_whitespace() && *b != 11).unwrap_or(rest.len())..];
    let field = &rest[..rest.len().min(width)];
    let sign = usize::from(field.first().is_some_and(|b| matches!(b, b'+' | b'-')));
    let digits = field[sign..].iter().take_while(|b| b.is_ascii_digit()).count();
    if digits == 0 { return None; }
    let mut value = 0i32;
    for &b in &field[sign..sign + digits] { value = value.wrapping_mul(10).wrapping_add(i32::from(b - b'0')); }
    if field.first() == Some(&b'-') { value = value.wrapping_neg(); }
    *rest = &rest[sign + digits..];
    Some(i64::from(value))
}

pub(super) fn frame_time_base(rate: &str) -> Result<(i64, i64), &'static str> {
    let value = if let Some((a, b)) = rate.split_once(['/', ':']) {
        a.trim().parse::<f64>().ok().zip(b.trim().parse::<f64>().ok()).map(|(a, b)| a / b)
    } else { rate.trim().parse().ok() }.ok_or("Invalid subtitle frame rate")?;
    if !value.is_finite() || !(0. ..=f64::from(i32::MAX)).contains(&value) { return Err("Subtitle frame rate out of range"); }
    if let Some((a, b)) = rate.split_once(['/', ':']).and_then(|(a,b)| a.trim().parse::<i32>().ok().zip(b.trim().parse::<i32>().ok())) {
        if a == 0 { return Ok((1, 0)); }
        let (mut x, mut y) = (i64::from(a).abs(), i64::from(b).abs());
        while y != 0 { (x, y) = (y, x % y); }
        return Ok((i64::from(b).abs() / x, i64::from(a).abs() / x));
    }
    if value.fract() == 0. { return Ok((1, if value == 0. { 0 } else { value as i64 })); }
    Ok(time_base(value, 1 << 24))
}

pub(super) fn time_base(value: f64, max: i64) -> (i64, i64) {
    // av_d2q converts through a binary fraction, then av_reduce bounds both terms.
    let exponent = (value.log2().floor() as i32).max(0);
    for max in [max, i64::from(i32::MAX)] {
        let mut den = 1i64 << (62 - exponent);
        let mut num = (value * den as f64 + 0.5).floor() as i64;
        let (mut a0, mut a1) = ((0i64, 1i64), (1i64, 0i64));
        while den != 0 {
            let mut quotient = num / den;
            let next = (i128::from(quotient) * i128::from(a1.0) + i128::from(a0.0), i128::from(quotient) * i128::from(a1.1) + i128::from(a0.1));
            if next.0 > i128::from(max) || next.1 > i128::from(max) {
                if a1.0 != 0 { quotient = (max - a0.0) / a1.0; }
                if a1.1 != 0 { quotient = quotient.min((max - a0.1) / a1.1); }
                if i128::from(den) * i128::from(2 * quotient * a1.1 + a0.1) > i128::from(num) * i128::from(a1.1) {
                    a1 = (quotient * a1.0 + a0.0, quotient * a1.1 + a0.1);
                }
                break;
            }
            a0 = a1;
            a1 = (next.0 as i64, next.1 as i64);
            (num, den) = (den, num % den);
        }
        if a1.0 != 0 && a1.1 != 0 { return (a1.1, a1.0); }
    }
    (1, 0)
}

fn vplayer_timestamp(mut line: &[u8], probe: bool) -> Option<(i64, &[u8])> {
    let hour = number(&mut line, if probe { 3 } else { usize::MAX })?;
    line = line.strip_prefix(b":")?;
    let minute = number(&mut line, if probe { 2 } else { usize::MAX })?;
    line = line.strip_prefix(b":")?;
    let second = number(&mut line, if probe { 2 } else { usize::MAX })?;
    let fraction = if let Some(rest) = line.strip_prefix(b".") {
        line = rest;
        number(&mut line, if probe { 2 } else { usize::MAX })?
    } else { 0 };
    if !line.first().is_some_and(|b| matches!(b, b':' | b' ' | b'=')) { return None; }
    Some(((hour * 3600 + minute * 60 + second) * 100 + fraction, &line[1..]))
}

fn clock(line: &mut &[u8], width: usize, fraction: bool) -> Option<i64> {
    let hour = number(line, width)?;
    *line = line.strip_prefix(b":")?;
    let minute = number(line, width)?;
    *line = line.strip_prefix(b":")?;
    let second = number(line, width)?;
    let seconds = hour * 3600 + minute * 60 + second;
    if !fraction { return Some(seconds); }
    *line = line.strip_prefix(b":")?;
    Some(seconds * 100 + number(line, width)?)
}

fn stl_timestamp(mut line: &[u8], probe: bool) -> Option<(i64, i64, &[u8])> {
    let width = if probe { usize::MAX } else { 2 };
    let start = clock(&mut line, width, true)?;
    line = line.trim_ascii_start().strip_prefix(b",")?;
    let end = clock(&mut line, width, true)?;
    line = line.trim_ascii_start().strip_prefix(b",")?.trim_ascii_start();
    Some((start, end - start, line))
}

pub(super) fn integer(rest: &mut &[u8]) -> Option<i64> {
    *rest = rest.trim_ascii_start();
    let sign = usize::from(rest.first().is_some_and(|b| matches!(b, b'+' | b'-')));
    let digits = rest[sign..].iter().take_while(|b| b.is_ascii_digit()).count();
    if digits == 0 { return None; }
    let value = std::str::from_utf8(&rest[..sign + digits]).ok()?.parse().unwrap_or(if rest.first() == Some(&b'-') { i64::MIN } else { i64::MAX });
    *rest = &rest[sign + digits..];
    Some(value)
}

fn pjs_timestamp(mut line: &[u8]) -> Option<(i64, i64, &[u8])> {
    let start = integer(&mut line)?;
    line = line.strip_prefix(b",")?;
    let end = integer(&mut line)?;
    let duration = end.checked_sub(start).filter(|&n| (0..=i64::from(i32::MAX)).contains(&n))?;
    if start == i64::MIN { return None; }
    let text = line.iter().position(|&b| b == b'"').map_or(&[][..], |i| &line[i + 1..]);
    Some((start, duration, text.split(|&b| b == b'"').next().unwrap_or_default()))
}

fn mpl2_timestamp(mut line: &[u8]) -> Option<(i64, i64, &[u8])> {
    line = line.strip_prefix(b"[")?;
    let start = integer(&mut line)?;
    line = line.strip_prefix(b"][")?;
    let duration = if line.first() == Some(&b']') { -1 } else {
        integer(&mut line)?.checked_sub(start).filter(|&n| n >= 0).unwrap_or(-1)
    };
    line = line.strip_prefix(b"]")?;
    if line.first().is_none_or(|&b| b == 0) { return None; }
    Some((start, duration, line))
}

fn subviewer_timestamp(mut line: &[u8], probe: bool) -> Option<(i64, i64)> {
    let time = |line: &mut &[u8]| {
        let seconds = clock(line, usize::MAX, false)?;
        *line = line.strip_prefix(b".")?;
        let length = line.len();
        let fraction = number(line, usize::MAX)?;
        let multiplier = match length - line.len() { 1 => 100, 2 => 10, 3 => 1, _ if probe => 1, _ => return None };
        Some(seconds * 1000 + fraction * multiplier)
    };
    let start = time(&mut line)?;
    line = line.strip_prefix(b",")?;
    let end = time(&mut line)?;
    if probe && line.is_empty() { return None; }
    Some((start, (end - start) as i32 as i64))
}

pub(super) fn score(format: &str, mut bytes: &[u8]) -> u8 {
    if format == "jacosub" { return super::jacosub::score(bytes); }
    if format == "microdvd" { return super::microdvd::score(bytes); }
    if matches!(format, "sami" | "realtext") { return super::smil_subtitles::score(format, bytes); }
    if format == "aqtitle" { return if bytes.strip_prefix(b"-->>").and_then(|mut line| integer(&mut line)).is_some() { 50 } else { 0 }; }
    if format == "pjs" {
        let mut rest = bytes;
        let valid = integer(&mut rest).is_some() && rest.strip_prefix(b",").is_some_and(|line| {
            rest = line;
            integer(&mut rest).is_some() && rest.starts_with(b",") && rest.get(1).is_some_and(|&b| b != 0)
        });
        let line = bytes.split(|b| matches!(b, 0 | b'\r' | b'\n')).next().unwrap_or_default();
        return if valid && line.iter().filter(|&&b| b == b'"').take(2).count() == 2 { 100 } else { 0 };
    }
    if format == "subviewer1" {
        let header = b"******** START SCRIPT ********";
        return if bytes.split(|&b| b == 0).next().unwrap_or_default().windows(header.len()).any(|w| w == header) { 50 } else { 0 };
    }
    bytes = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes);
    if format == "subviewer" {
        return if subviewer_timestamp(bytes, true).is_some() { 50 } else if bytes.starts_with(b"[INFORMATION]") { 33 } else { 0 };
    }
    if format == "mpl2" {
        for _ in 0..2 {
            if mpl2_timestamp(bytes).is_none() { return 0; }
            let end = bytes.iter().position(|b| matches!(b, 0 | b'\r' | b'\n')).unwrap_or(bytes.len());
            bytes = &bytes[end..];
            while bytes.first() == Some(&b'\r') { bytes = &bytes[1..]; }
            if bytes.first() == Some(&b'\n') { bytes = &bytes[1..]; }
            if bytes.is_empty() || bytes.first() == Some(&0) { return 0; }
        }
        return 100;
    }
    if format == "vplayer" { return if vplayer_timestamp(bytes, true).is_some() { 100 } else { 0 }; }
    while bytes.first().is_some_and(|b| matches!(b, b'\r' | b'\n' | b'$')) || bytes.starts_with(b"//") {
        let end = bytes.iter().position(|b| matches!(b, 0 | b'\r' | b'\n')).unwrap_or(bytes.len());
        bytes = &bytes[end..];
        while bytes.first() == Some(&b'\r') { bytes = &bytes[1..]; }
        if bytes.first() == Some(&b'\n') { bytes = &bytes[1..]; }
        if bytes.first() == Some(&0) { break; }
    }
    if stl_timestamp(bytes, true).is_some_and(|(_, _, text)| text.first().is_some_and(|&b| b != 0)) { 100 } else { 0 }
}

fn line<'a>(bytes: &'a [u8], pos: &mut usize) -> &'a [u8] {
    // ff_get_line consumes the whole line but stores at most 4095 bytes, including one terminator.
    let start = *pos;
    let end = bytes[start..].iter().position(|b| matches!(b, 0 | b'\r' | b'\n')).map_or(bytes.len(), |i| start + i);
    *pos = end + usize::from(end < bytes.len());
    if bytes.get(end) == Some(&b'\r') && bytes.get(*pos) == Some(&b'\n') { *pos += 1; }
    let stored = end - start + usize::from(bytes.get(end).is_some_and(|&b| b != 0));
    &bytes[start..start + stored.min(4095)]
}

pub(super) fn read(format: &'static str, bytes: &[u8], remaining: &mut usize, frame_rate: Option<&str>) -> Result<Document, &'static str> {
    if format == "jacosub" { return super::jacosub::read(bytes, remaining, None); }
    if matches!(format, "sami" | "realtext") { return super::smil_subtitles::read(format, bytes, remaining, None); }
    let mut doc = Document { packet_side_data:Default::default(), format, time_base: (1, match format { "aqtitle" => 25, "subviewer" => 1000, "subviewer1" => 1, "mpl2" | "pjs" => 10, _ => 100 }), packets: Vec::new(), tags: Vec::new(), ass_header: None, extradata_size: 0, extradata: Vec::new(), decoded:Default::default() };
    if matches!(format, "aqtitle" | "microdvd") {
        let default = if format == "aqtitle" { (1, 25) } else { (125, 2997) };
        doc.time_base = frame_rate.map(frame_time_base).transpose()?.unwrap_or(default);
        if doc.time_base.1 == 0 { doc.time_base = if format == "aqtitle" { (1, 90000) } else { default }; }
    }
    let mut records = 0;
    let mut used = bytes.len();
    if used > *remaining { return Err("input byte limit exceeded"); }
    let (mut pos, mut delay) = (0, 0);
    let (mut frame, mut frame_pos) = (i64::MIN, 0);
    let (mut event, mut new_event, mut header_size) = (None, true, 0usize);
    if matches!(format, "mpl2" | "subviewer") && bytes.starts_with(b"\xef\xbb\xbf") { pos = 3; }
    while pos < bytes.len() {
        let position = pos;
        let mut raw = line(bytes, &mut pos);
        if raw.is_empty() { break; }
        if format == "microdvd" {
            let raw = raw[..raw.len().min(2047)].split(|b| matches!(b, 0 | b'\r' | b'\n')).next().unwrap_or_default();
            let raw = raw.strip_prefix(b"\xef\xbb\xbf").unwrap_or(raw);
            if raw.is_empty() { continue; }
            records += 1;
            if records <= 3 {
                if let Some(rate) = super::microdvd::frame_rate(raw) { doc.time_base = time_base(rate, 100000); continue; }
                if doc.extradata.is_empty() && let Some(header) = raw.strip_prefix(b"{DEFAULT}{}").filter(|h| !h.is_empty()) {
                    used = used.saturating_add(header.len());
                    if used > *remaining { return Err("subtitle header exceeds memory budget"); }
                    doc.extradata = header.to_vec();
                    continue;
                }
            }
            if let Some((pts, duration, data)) = super::microdvd::packet(raw) {
                used = used.saturating_add(size_of::<Packet>() + data.len());
                if used > *remaining { return Err("subtitle packets exceed memory budget"); }
                doc.packets.push(Packet { pts, duration, data:data.to_vec(), pos:position });
            }
            continue;
        }
        if format == "aqtitle" {
            let raw = raw.split(|b| matches!(b, 0 | b'\r' | b'\n')).next().unwrap_or_default();
            if let Some(next) = raw.strip_prefix(b"-->>").and_then(|mut line| integer(&mut line)) {
                if !new_event && let Some(packet) = doc.packets.last_mut()
                    && let Some(duration) = next.checked_sub(packet.pts).filter(|&n| (0..i64::MAX).contains(&n)) { packet.duration = duration; }
                frame = next;
                frame_pos = pos;
                new_event = true;
            } else if !raw.is_empty() {
                used = used.saturating_add(raw.len() + if new_event { size_of::<Packet>() } else { 1 });
                if used > *remaining { return Err("subtitle packets exceed memory budget"); }
                if new_event { doc.packets.push(Packet { pts: frame, duration: -1, pos: frame_pos, data: raw.to_vec() }); }
                else { let data = &mut doc.packets.last_mut().unwrap().data; data.push(b'\n'); data.extend_from_slice(raw); }
                new_event = false;
            }
            continue;
        }
        if format == "subviewer" {
            let raw = raw[..raw.len().min(2047)].split(|b| matches!(b, 0 | b'\r' | b'\n')).next().unwrap_or_default();
            if raw.starts_with(b"[") && !raw.starts_with(b"[br]") {
                if [b"[COLF]".as_slice(), b"[SIZE]", b"[FONT]", b"[STYLE]"].iter().any(|tag| raw.windows(tag.len()).any(|w| w == *tag)) { continue; }
                if doc.extradata_size == 0 {
                    header_size = header_size.saturating_add(raw.len() + 1);
                    used = used.saturating_add(raw.len() + 1);
                    if used > *remaining { return Err("subtitle header exceeds memory budget"); }
                    if raw.starts_with(b"[END INFORMATION]") || raw.starts_with(b"[SUBTITLE]") { doc.extradata_size = header_size; }
                    else if !raw.starts_with(b"[INFORMATION]") {
                        let end = raw[1..].iter().position(|&b| b == b']').map_or(raw.len(), |i| i + 1).min(31);
                        let key = String::from_utf8_lossy(&raw[1..end]).to_ascii_lowercase();
                        let value = &raw[end + usize::from(raw.get(end) == Some(&b']'))..];
                        let value = &value[value.iter().take_while(|&&b| b == b' ').count()..];
                        let value = value.split(|&b| b == b']').next().unwrap_or_default();
                        let value = String::from_utf8_lossy(&value[..value.len().min(127)]).into_owned();
                        used = used.saturating_add(key.len() + value.len() + size_of::<(String, String)>());
                        if used > *remaining { return Err("subtitle metadata exceeds memory budget"); }
                        if let Some((_, old)) = doc.tags.iter_mut().find(|(name, _)| *name == key) { *old = value; }
                        else { doc.tags.push((key, value)); }
                    }
                }
            } else if let Some(times) = subviewer_timestamp(raw, false) { event = Some(times); new_event = true; }
            else if !raw.is_empty() {
                let (pts, duration) = event.ok_or("Invalid data found when processing input")?;
                used = used.saturating_add(raw.len() + if new_event { size_of::<Packet>() } else { 1 });
                if used > *remaining { return Err("subtitle packets exceed memory budget"); }
                if new_event { doc.packets.push(Packet { pts, duration, pos: position, data: raw.to_vec() }); }
                else { let data = &mut doc.packets.last_mut().unwrap().data; data.push(b'\n'); data.extend_from_slice(raw); }
                new_event = false;
            }
            continue;
        }
        let (pts, duration, data, position) = if format == "subviewer1" {
            if raw.starts_with(b"[DELAY]") {
                raw = line(bytes, &mut pos);
                if let Some(value) = number(&mut &raw[..], usize::MAX) { delay = value; }
            }
            let Some(mut rest) = raw.strip_prefix(b"[") else { continue; };
            let Some(pts) = clock(&mut rest, usize::MAX, false) else { continue; };
            let pts = pts + delay;
            let position = pos;
            let data = line(bytes, &mut pos);
            if data.first().is_none_or(|b| matches!(b, 0 | b'\r' | b'\n')) {
                if let Some(previous) = doc.packets.last_mut() { previous.duration = pts - previous.pts; }
                continue;
            }
            (pts, -1, data, position)
        } else {
            let raw = raw.split(|&b| matches!(b, b'\r' | b'\n' | 0)).next().unwrap_or_default();
            let event = match format {
                "vplayer" => vplayer_timestamp(raw, false).map(|(pts, text)| (pts, -1, text)),
                "pjs" => pjs_timestamp(raw),
                "mpl2" => mpl2_timestamp(raw),
                _ => stl_timestamp(raw, false),
            };
            let Some((pts, duration, data)) = event else { continue; };
            (pts, duration, data, position)
        };
        used = used.saturating_add(size_of::<Packet>()).saturating_add(data.len());
        if used > *remaining { return Err("subtitle packets exceed memory budget"); }
        let mut data = data.to_vec();
        if format == "subviewer1" && let Some(end) = data.iter().position(|b| matches!(b, b'\r' | b'\n')) { data[end] = 0; }
        doc.packets.push(Packet { pts, duration, pos: position, data });
    }
    doc.packets.sort_unstable_by_key(|p| (p.pts, p.pos));
    // Preserve input order for equal timestamps before exposing SubViewer's zero packet positions.
    if format == "subviewer" { for packet in &mut doc.packets { packet.pos = 0; } }
    for i in 1..doc.packets.len() {
        if doc.packets[i - 1].duration < 0 && let Some(duration) = doc.packets[i].pts.checked_sub(doc.packets[i - 1].pts) { doc.packets[i - 1].duration = duration; }
    }
    doc.packets.dedup_by(|a, b| a.pts == b.pts && a.duration == b.duration && a.data.split(|&b| b == 0).next() == b.data.split(|&b| b == 0).next());
    if format == "microdvd" && !doc.extradata.is_empty() {
        let header = super::microdvd::header(&doc.extradata);
        used = used.saturating_add(header.text.len() + header.styles.values().map(|s| size_of::<super::ass::Style>() + s.font.len() + 7).sum::<usize>());
        if used > *remaining { return Err("subtitle header exceeds memory budget"); }
        doc.ass_header = Some(header);
    }
    *remaining -= used;
    Ok(doc)
}
