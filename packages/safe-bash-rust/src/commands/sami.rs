pub(super) const TIMESTAMP_ERROR: &str = "SAMI timestamp is not implemented for values outside the supported range";
const MARKER_ERROR: &str = "Error decoding subtitles: Operation not permitted";
const TEXT_ERROR: &str = "Invalid UTF-8 in decoded subtitles text";
const MEMORY_ERROR: &str = "Error decoding subtitles: Cannot allocate memory";

fn space(b: u8) -> bool { b.is_ascii_whitespace() || b == 11 }
fn starts(bytes: &[u8], prefix: &[u8]) -> bool { bytes.get(..prefix.len()).is_some_and(|s| s.eq_ignore_ascii_case(prefix)) }
fn paragraph(bytes: &[u8]) -> bool { starts(bytes, b"<P") && bytes.get(2).is_some_and(|&b| b == b'>' || space(b)) }

pub(super) fn timestamp(bytes: &[u8]) -> i64 {
    let bytes = &bytes[bytes.iter().position(|&b| !space(b)).unwrap_or(bytes.len())..];
    let sign = usize::from(bytes.first().is_some_and(|b| matches!(b, b'+' | b'-')));
    let digits = bytes[sign..].iter().take_while(|b| b.is_ascii_digit()).count();
    if digits == 0 { return 0; }
    std::str::from_utf8(&bytes[..sign + digits]).unwrap().parse().unwrap_or(if bytes[0] == b'-' { i64::MIN } else { i64::MAX })
}

fn append(buf: &mut Vec<u8>, bytes: &[u8]) {
    buf.extend_from_slice(&bytes[..bytes.len().min(2047 - buf.len())]);
}

#[derive(Clone, Default)]
struct Font { size: i32, color: Option<u32>, face: Vec<u8> }

pub(super) fn html(bytes: &[u8], limit: usize) -> Result<Vec<u8>, &'static str> {
    let mut out = Vec::new();
    let mut fonts = vec![Font::default()];
    let (mut pos, mut line_start, mut align, mut missing_brace) = (0, true, 0, false);
    while pos < bytes.len() {
        let b = bytes[pos];
        match b {
            b'\r' => (),
            b'\n' => { if line_start { break; } while out.last() == Some(&b' ') { out.pop(); } out.extend_from_slice(b"\\N"); line_start = true; }
            b' ' => { if !line_start { out.push(b); } }
            b'{' => {
                let rest = &bytes[pos..];
                align += usize::from(rest.starts_with(b"{\\an") && rest.get(4).is_some_and(u8::is_ascii_digit) && rest.get(5) == Some(&b'}'));
                if !missing_brace && (align != 1 && rest.get(1) == Some(&b'\\') || rest.get(1).is_some_and(|b| b"CcFfoPSsYy".contains(b)) && rest.get(2) == Some(&b':')) {
                    if let Some(end) = rest.iter().position(|&b| b == b'}') { pos += end; }
                    else { missing_brace = true; out.push(b); }
                } else { out.push(b); }
            }
            b'<' => {
                let mut likely = true;
                while bytes.get(pos + 1) == Some(&b'<') { out.push(b'<'); likely = false; pos += 1; }
                let close = bytes.get(pos + 1) == Some(&b'/');
                if close { likely = true; }
                let start = pos + 1 + usize::from(close);
                let tag = bytes[start..].iter().position(|b| matches!(b, b'<' | b'>')).filter(|&n| n < 128 && bytes[start + n] == b'>');
                if let Some(len) = tag {
                    let tag = &bytes[start..start + len];
                    let spaces = tag.iter().take_while(|&&b| b == b' ').count();
                    if spaces > 0 { likely = false; }
                    let mut parts = tag[spaces..].splitn(2, |&b| b == b' ');
                    let name = parts.next().unwrap();
                    let params = parts.next();
                    likely &= name.iter().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'/'));
                    if name.eq_ignore_ascii_case(b"font") {
                        if close && fonts.len() > 1 {
                            let current = fonts.pop().unwrap(); let last = fonts.last().unwrap();
                            if current.size != 0 && last.size != current.size { out.extend_from_slice(if last.size == 0 { "{\\fs}".into() } else { format!("{{\\fs{}}}", last.size) }.as_bytes()); }
                            if current.color.is_some() && current.color != last.color { out.extend_from_slice(last.color.map_or("{\\c}".into(), |c| format!("{{\\c&H{c:X}&}}")).as_bytes()); }
                            if !current.face.is_empty() && current.face != last.face { out.extend_from_slice(b"{\\fn"); out.extend_from_slice(&last.face); out.push(b'}'); }
                        } else if !close && fonts.len() < 16 {
                            let mut font = fonts.last().unwrap().clone();
                            let mut params = params.unwrap_or_default();
                            while !params.is_empty() {
                                if starts(params, b"size=") {
                                    params = &params[5..]; params = params.strip_prefix(b"\"").unwrap_or(params);
                                    if let Some(n) = super::text_subtitles::number(&mut params, usize::MAX) { font.size = n as i32; out.extend_from_slice(format!("{{\\fs{}}}", n as u32).as_bytes()); }
                                } else if starts(params, b"color=") {
                                    params = &params[6..]; params = params.strip_prefix(b"\"").unwrap_or(params);
                                    let len = params.iter().position(|b| matches!(b, b'"' | b' ' | b'>')).unwrap_or(params.len());
                                    let raw = &params[..len]; let sharps = raw.iter().take_while(|&&b| b == b'#').count();
                                    let raw = &raw[sharps.saturating_sub(1)..];
                                    let color = std::str::from_utf8(raw).ok().and_then(|raw| {
                                        let (raw, alpha) = raw.split_once('@').map_or((raw, None), |(raw, alpha)| (raw, Some(alpha)));
                                        if let Some(alpha) = alpha {
                                            let valid = if let Some(hex) = alpha.strip_prefix("0x") { u8::from_str_radix(hex, 16).is_ok() } else { alpha.parse::<f64>().is_ok_and(|a| (0. ..=1.).contains(&a)) };
                                            if !valid { return None; }
                                        }
                                        let name = raw.to_ascii_lowercase();
                                        let named = match name.as_str() {
                                            "darkgrey" | "darkslategrey" | "dimgrey" | "grey" | "lightgray" | "lightslategrey" | "rebeccapurple" | "slategrey" => None,
                                            _ => super::magick_color::css_named_color(&name),
                                        };
                                        named.or_else(|| {
                                            let hex = raw.strip_prefix('#').or_else(|| raw.strip_prefix("0x")).unwrap_or(raw);
                                            if !matches!(hex.len(), 6 | 8) || !hex.bytes().all(|b| b.is_ascii_hexdigit()) { return None; }
                                            let n = u32::from_str_radix(&hex[..6], 16).ok()?;
                                            Some([(n >> 16) as u8, (n >> 8) as u8, n as u8, 255])
                                        })
                                    });
                                    if let Some([r,g,b,_]) = color {
                                        let color = u32::from(r) | u32::from(g) << 8 | u32::from(b) << 16;
                                        font.color = Some(color); out.extend_from_slice(format!("{{\\c&H{color:X}&}}").as_bytes());
                                    }
                                } else if starts(params, b"face=") {
                                    params = &params[5..]; let quoted = params.starts_with(b"\""); if quoted { params = &params[1..]; }
                                    let len = params.iter().position(|&b| b == if quoted { b'"' } else { b' ' }).unwrap_or(params.len());
                                    font.face = params[..len.min(127)].to_vec(); params = &params[len..];
                                    out.extend_from_slice(b"{\\fn"); out.extend_from_slice(&font.face); out.push(b'}');
                                }
                                let Some(next) = params.iter().position(|&b| b == b' ') else { break; }; params = &params[next + 1..];
                            }
                            fonts.push(font);
                        }
                        pos = start + len;
                    } else if name.len() == 1 && b"bisu".contains(&name[0].to_ascii_lowercase()) {
                        out.extend_from_slice(format!("{{\\{}{}}}", char::from(name[0].to_ascii_lowercase()), u8::from(!close)).as_bytes()); pos = start + len;
                    } else if name.eq_ignore_ascii_case(b"br") || name.eq_ignore_ascii_case(b"br/") { out.extend_from_slice(b"\\N"); pos = start + len; }
                    else if likely { pos = start + len; }
                    else { out.push(b'<'); }
                } else { out.push(b'<'); }
            }
            _ => out.push(b),
        }
        if out.len() > limit { return Err(MEMORY_ERROR); }
        if !matches!(bytes[pos], b' ' | b'\r' | b'\n') { line_start = false; }
        pos += 1;
    }
    while out.ends_with(b"\\N") { out.truncate(out.len() - 2); }
    while out.last() == Some(&b' ') { out.pop(); }
    Ok(out)
}

pub(super) fn text(data: &[u8], speaker: &mut Vec<u8>) -> Result<String, &'static str> {
    std::str::from_utf8(data).map_err(|_| TEXT_ERROR)?;
    let data = data.split(|&b| b == 0).next().unwrap_or_default();
    let mut content = Vec::new();
    let mut pos = 0;
    while pos < data.len() {
        let Some(next) = data[pos..].windows(2).position(|s| s.eq_ignore_ascii_case(b"<P")) else { break; };
        pos += next;
        if !paragraph(&data[pos..]) { pos += 1; continue; }
        if !content.is_empty() { append(&mut content, b"\\N"); }
        let Some(end) = data[pos..].iter().position(|&b| b == b'>') else { break; };
        let tag = &data[pos..pos + end];
        let is_source = [b"ID=Source".as_slice(), b"ID=\"Source\""].iter().any(|key| tag.windows(key.len()).any(|s| s.eq_ignore_ascii_case(key)));
        let dst = if is_source { speaker.clear(); &mut *speaker } else { &mut content };
        pos += end + 1;
        while data.get(pos).is_some_and(|&b| space(b)) { pos += 1; }
        if data[pos..].starts_with(b"&nbsp;") { return Err(MARKER_ERROR); }
        let mut previous_space = false;
        while pos < data.len() {
            let rest = &data[pos..];
            if paragraph(rest) { break; }
            if starts(rest, b"<BR") {
                append(dst, b"\\N");
                let Some(end) = rest.iter().position(|&b| b == b'>') else { pos = data.len(); break; };
                pos += end + 1; continue;
            }
            if !space(data[pos]) { append(dst, &data[pos..pos + 1]); }
            else if !previous_space { append(dst, b" "); }
            previous_space = space(data[pos]); pos += 1;
        }
    }
    let mut out = Vec::new();
    if !speaker.is_empty() { append(&mut out, b"{\\i1}"); append(&mut out, &html(speaker, 2047)?); append(&mut out, b"{\\i0}\\N"); }
    append(&mut out, &html(&content, 2047)?);
    String::from_utf8(out).map_err(|_| TEXT_ERROR)
}
