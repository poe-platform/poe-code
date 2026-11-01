use std::fmt::Write;

pub(super) struct Cue {
    pub start: i64,
    pub duration: i64,
    pub text: String,
}

fn milliseconds(raw: &str) -> i64 {
    let raw = raw.trim().replace(',', ".");
    let mut parts = raw.rsplit(':');
    let sec = parts
        .next()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.);
    let min = parts
        .next()
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    let hour = parts
        .next()
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    ((hour as f64 * 3600. + min as f64 * 60. + sec) * 1000.).round() as i64
}

pub(super) fn cues(text: &str) -> impl Iterator<Item = Cue> + '_ {
    let mut lines = text.trim_start_matches('\u{feff}').lines();
    std::iter::from_fn(move || {
        loop {
            let first = lines.by_ref().find(|s| !s.trim().is_empty())?;
            let mut block =
                std::iter::once(first).chain(lines.by_ref().take_while(|s| !s.trim().is_empty()));
            if first.starts_with("WEBVTT") || first.starts_with("NOTE") {
                block.for_each(drop);
                continue;
            }
            let Some((left, right)) = block.find_map(|s| s.split_once("-->")) else {
                continue;
            };
            let start = milliseconds(left);
            let end = milliseconds(right.split_ascii_whitespace().next().unwrap_or(""));
            let mut text = String::new();
            for line in block {
                if !text.is_empty() {
                    text.push('\n')
                }
                text.push_str(line.trim_end());
            }
            let text = text.trim_start();
            if !text.is_empty() {
                return Some(Cue {
                    start,
                    duration: end.saturating_sub(start).max(1),
                    text: text.into(),
                });
            }
        }
    })
}

// MP4 timed text fills gaps with empty samples and prefixes each cue with its byte length.
pub(super) fn samples(text: &str) -> impl Iterator<Item = (Cue, bool)> + '_ {
    let packed = cues(text).all(|cue| {
        let bytes = cue.text.as_bytes();
        bytes.len() >= 2 && usize::from(u16::from_be_bytes([bytes[0], bytes[1]])) == bytes.len() - 2
    });
    let mut cursor = 0;
    cues(text).flat_map(move |mut cue| {
        let mut gap = None;
        if !packed {
            if cue.start > cursor {
                gap = Some(Cue {
                    start: cursor,
                    duration: cue.start - cursor,
                    text: String::new(),
                });
            }
            cue.start = cursor.max(cue.start);
            cursor = cue.start.saturating_add(cue.duration);
        }
        gap.into_iter()
            .chain(std::iter::once(cue))
            .map(move |c| (c, !packed))
    })
}

fn timestamp(out: &mut String, ms: i64, sep: char) {
    let ms = ms.max(0);
    write!(
        out,
        "{:02}:{:02}:{:02}{sep}{:03}",
        ms / 3600000,
        ms / 60000 % 60,
        ms / 1000 % 60,
        ms % 1000
    )
    .unwrap();
}

pub(super) fn convert(
    input: &[u8],
    vtt: bool,
    selected: bool,
    slice: Option<(f64, Option<f64>)>,
    limit: usize,
) -> Result<Vec<u8>, &'static str> {
    let text = String::from_utf8_lossy(input);
    let mut out = if vtt {
        "WEBVTT\n".to_owned()
    } else {
        String::new()
    };
    let sep = if vtt { '.' } else { ',' };
    let mut index = 0;
    let mut emit = |start: i64, duration: i64, body: &str| {
        if !out.is_empty() {
            out.push('\n');
        }
        index += 1;
        if !vtt {
            writeln!(out, "{index}").unwrap();
        }
        timestamp(&mut out, start, sep);
        out.push_str(" --> ");
        timestamp(&mut out, start.saturating_add(duration), sep);
        writeln!(out, "\n{body}").unwrap();
        if out.len() > limit {
            return Err("output byte limit exceeded");
        }
        Ok(())
    };
    if selected {
        if let Some((start, end)) = slice {
            let length = cues(&text)
                .map(|c| c.start.saturating_add(c.duration))
                .max()
                .unwrap_or(0);
            let start = (start * 1000.).round() as i64;
            let end = end.map_or(length, |s| ((s * 1000.).round() as i64).min(length));
            let mut dts = 0i64;
            for (c, wrap) in samples(&text) {
                if end <= start || c.start >= end {
                    break;
                }
                if c.start.saturating_add(c.duration) <= start {
                    continue;
                }
                let duration = c.duration.min(end.saturating_sub(c.start));
                let mut body = Vec::new();
                if wrap {
                    body.extend_from_slice(&(c.text.len() as u16).to_be_bytes());
                }
                body.extend_from_slice(c.text.as_bytes());
                emit(dts, duration, String::from_utf8_lossy(&body).trim())?;
                dts = dts.saturating_add(duration);
            }
        } else {
            for c in cues(&text) {
                emit(c.start, c.duration, &c.text)?
            }
        }
    }
    Ok(out.into_bytes())
}
