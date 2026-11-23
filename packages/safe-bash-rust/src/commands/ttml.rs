use std::fmt::Write;

fn escape(out: &mut String, text: &str, attribute: bool, limit: usize) -> Result<(), &'static str> {
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"), '<' => out.push_str("&lt;"), '>' => out.push_str("&gt;"),
            '"' if attribute => out.push_str("&quot;"), _ => out.push(c),
        }
        if out.len() > limit { return Err("output byte limit exceeded"); }
    }
    Ok(())
}

// TTML ignores inline ASS style overrides; only text and line breaks are emitted.
pub(super) fn cue(out: &mut String, start: i64, end: i64, mut ass: &str, limit: usize) -> Result<(), &'static str> {
    ass = ass.trim_start_matches(' ');
    out.push_str("<p begin=\"");
    super::subtitles::timestamp(out, start, '.', false);
    out.push_str("\" end=\"");
    super::subtitles::timestamp(out, end, '.', false);
    out.push_str("\"><span region=\"Default\">");
    while !ass.is_empty() {
        if ass.starts_with("\\N") || ass.starts_with("\\n") {
            out.push_str("<br/>"); ass = &ass[2..];
        } else if ass.starts_with("{\\") && let Some(end) = ass.find('}') {
            ass = &ass[end + 1..];
        } else {
            let c = ass.chars().next().unwrap();
            escape(out, &ass[..c.len_utf8()], false, limit)?;
            ass = &ass[c.len_utf8()..];
        }
        if out.len() > limit { return Err("output byte limit exceeded"); }
    }
    out.push_str("</span></p>\n");
    if out.len() > limit { return Err("output byte limit exceeded"); }
    Ok(())
}

pub(super) fn caption(text: &str, webvtt: bool, limit: usize) -> Result<String, &'static str> {
    if !webvtt { return Ok(String::from_utf8_lossy(&super::sami::html(text.as_bytes(), limit)?).into_owned()); }
    let mut out = String::new();
    let mut rest = text;
    let mut skip = false;
    while !rest.is_empty() && !rest.starts_with('\0') {
        if let Some((from, to)) = [
            ("<b>", "{\\b1}"), ("</b>", "{\\b0}"), ("<i>", "{\\i1}"), ("</i>", "{\\i0}"), ("<u>", "{\\u1}"), ("</u>", "{\\u0}"),
            ("{", "\\{"), ("}", "\\}"), ("&gt;", ">"), ("&lt;", "<"), ("&lrm;", ""), ("&rlm;", ""), ("&amp;", "&"), ("&nbsp;", "\\h"),
        ].into_iter().find(|(from, _)| rest.starts_with(from)) {
            out.push_str(to); rest = &rest[from.len()..]; skip = false;
        } else {
            let c = rest.chars().next().unwrap();
            match c {
                '<' => skip = true, '>' => skip = false,
                '\n' if rest.len() > 1 => out.push_str("\\N"),
                '\r' => (), _ if !skip => out.push(c), _ => (),
            }
            rest = &rest[c.len_utf8()..];
        }
        if out.len() > limit { return Err("output byte limit exceeded"); }
    }
    Ok(out)
}

pub(super) fn document(cues: &str, language: &str, limit: usize) -> Result<Vec<u8>, &'static str> {
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<tt xmlns=\"http://www.w3.org/ns/ttml\" xmlns:ttp=\"http://www.w3.org/ns/ttml#parameter\" xmlns:tts=\"http://www.w3.org/ns/ttml#styling\" xml:lang=\"");
    escape(&mut out, language, true, limit)?;
    writeln!(out, "\" ttp:cellResolution=\"384 288\">\n<head><layout><region xml:id=\"Default\" tts:origin=\"3% 0%\" tts:extent=\"97% 97%\" tts:displayAlign=\"after\" tts:textAlign=\"center\" tts:fontSize=\"16c\" tts:fontFamily=\"Arial\" tts:overflow=\"visible\"/></layout></head>\n<body><div>").unwrap();
    if cues.len().saturating_add("</div></body></tt>".len()) > limit.saturating_sub(out.len()) { return Err("output byte limit exceeded"); }
    out.push_str(cues);
    out.push_str("</div></body></tt>");
    Ok(out.into_bytes())
}
