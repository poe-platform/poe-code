use crate::commands::{
    js_number,
    structured::xml::{self, Element, Node},
};

pub(super) struct Representation {
    pub init: Option<String>,
    pub media: Vec<String>,
}

fn local(name: &str) -> &str {
    name.rsplit(':').next().unwrap_or(name)
}
fn attr<'a>(e: &'a Element, name: &str) -> Option<&'a str> {
    e.attrs
        .iter()
        .find(|(k, _)| local(k) == name)
        .map(|(_, v)| v.as_str())
}
fn children<'a>(e: &'a Element, name: &'a str) -> impl Iterator<Item = &'a Element> {
    e.children.iter().filter_map(move |n| match n {
        Node::Element(child) if local(&child.tag) == name => Some(child),
        _ => None,
    })
}
fn duration(raw: Option<&str>) -> Result<f64, String> {
    let Some(s) = raw.filter(|s| !s.is_empty()) else {
        return Ok(0.);
    };
    let mut rest = s
        .strip_prefix("PT")
        .ok_or_else(|| format!("Unsupported DASH duration: {s}"))?;
    let mut seconds = 0.;
    while !rest.is_empty() {
        let at = rest.find(['H', 'M', 'S']).ok_or("Invalid DASH duration")?;
        let n = js_number(&rest[..at], 0.);
        if !n.is_finite() || n < 0. {
            return Err("Invalid DASH duration".into());
        }
        seconds += n * match rest.as_bytes()[at] {
            b'H' => 3600.,
            b'M' => 60.,
            _ => 1.,
        };
        rest = &rest[at + 1..];
    }
    if !seconds.is_finite() {
        return Err("Invalid DASH duration".into());
    }
    Ok(seconds)
}
fn integer(n: f64) -> bool {
    n.fract() == 0. && n.abs() <= 9_007_199_254_740_991.
}
fn uri(
    template: &str,
    id: &str,
    bandwidth: &str,
    number: u64,
    time: f64,
    limit: usize,
) -> Result<String, String> {
    let mut parts = template.split('$');
    let mut out = parts.next().unwrap_or("").to_string();
    while let Some(token) = parts.next() {
        let tail = parts.next().ok_or("Unterminated DASH template token")?;
        let mut fmt = token.split('%');
        let num;
        let value = match fmt.next().unwrap_or("") {
            "" => "$",
            "RepresentationID" => id,
            "Bandwidth" => bandwidth,
            "Number" => {
                num = number.to_string();
                &num
            }
            "Time" => {
                num = time.to_string();
                &num
            }
            other => return Err(format!("Unsupported DASH template token: {other}")),
        };
        let mut width = 0;
        if let Some(pad) = fmt.next().filter(|s| !s.is_empty()) {
            let n = js_number(
                pad.strip_suffix('d')
                    .ok_or("Invalid DASH template padding")?,
                0.,
            );
            if !integer(n) || !(1. ..=32.).contains(&n) {
                return Err("Invalid DASH template padding".into());
            }
            width = (n as usize).saturating_sub(value.encode_utf16().count());
        }
        if out
            .len()
            .saturating_add(value.len())
            .saturating_add(tail.len())
            .saturating_add(width)
            > limit
        {
            return Err("segment index exceeds memory budget".into());
        }
        out.extend(std::iter::repeat_n('0', width));
        out.push_str(value);
        out.push_str(tail);
    }
    Ok(out)
}

pub(super) fn parse(text: &str, limit: usize) -> Result<(Vec<Representation>, f64), String> {
    let doc = xml::parse(text, None, None)?;
    let mpd = doc
        .nodes
        .iter()
        .find_map(|n| {
            if let Node::Element(e) = n {
                Some(e)
            } else {
                None
            }
        })
        .filter(|e| local(&e.tag) == "MPD")
        .ok_or("Expected DASH MPD root")?;
    let movie_duration = duration(attr(mpd, "mediaPresentationDuration"))?;
    let mut periods = children(mpd, "Period");
    let period = periods
        .next()
        .filter(|_| periods.next().is_none())
        .ok_or("DASH requires a single Period")?;
    let seconds = duration(attr(period, "duration"))?;
    let seconds = if seconds == 0. {
        movie_duration
    } else {
        seconds
    };
    let mut sequences = Vec::new();
    let mut remaining = limit;
    for set in children(period, "AdaptationSet") {
        let Some(rep) = children(set, "Representation").next() else {
            continue;
        };
        let ancestors = [mpd, period, set, rep];
        let mut base = String::new();
        for e in ancestors {
            if let Some(url) = children(e, "BaseURL").next() {
                let mut text = String::new();
                for n in &url.children {
                    if let Node::Text(s, _) | Node::Cdata(s) = n {
                        text.push_str(s);
                    }
                }
                base.push_str(text.trim());
            }
        }
        let mut media = Vec::new();
        let mut init = None;
        let mut push = |uri: &str| -> Result<(), String> {
            remaining = remaining
                .checked_sub(base.len() + uri.len() + size_of::<String>())
                .ok_or("segment index exceeds memory budget")?;
            media.push(format!("{base}{uri}"));
            Ok(())
        };
        if let Some(list) = ancestors
            .iter()
            .flat_map(|e| children(e, "SegmentList"))
            .last()
        {
            if let Some(e) = children(list, "Initialization").next() {
                if attr(e, "range").is_some_and(|s| !s.is_empty()) {
                    return Err("DASH initialization byte ranges are not supported".into());
                }
                init = attr(e, "sourceURL")
                    .filter(|s| !s.is_empty())
                    .map(|s| format!("{base}{s}"));
            }
            for s in children(list, "SegmentURL") {
                if attr(s, "mediaRange").is_some_and(|s| !s.is_empty()) {
                    return Err("DASH byte ranges are not supported".into());
                }
                push(
                    attr(s, "media")
                        .filter(|s| !s.is_empty())
                        .ok_or("DASH SegmentURL requires media")?,
                )?;
            }
        } else {
            let templates: Vec<_> = ancestors
                .iter()
                .flat_map(|e| children(e, "SegmentTemplate"))
                .collect();
            if templates.is_empty() {
                if !base.is_empty() {
                    push("")?;
                }
            } else {
                let field = |name: &str| templates.iter().rev().find_map(|e| attr(e, name));
                let pattern = field("media")
                    .filter(|s| !s.is_empty())
                    .ok_or("DASH SegmentTemplate requires media")?;
                let scale = js_number(field("timescale").unwrap_or("1"), 0.);
                let first = js_number(field("startNumber").unwrap_or("1"), 0.);
                if !integer(scale) || scale <= 0. || !integer(first) || first < 0. {
                    return Err("Invalid DASH segment numbering or timescale".into());
                }
                let (id, bw) = (
                    attr(rep, "id").unwrap_or("0"),
                    attr(rep, "bandwidth").unwrap_or("0"),
                );
                let mut number = first as u64;
                if let Some(p) = field("initialization").filter(|s| !s.is_empty()) {
                    init = Some(format!("{base}{}", uri(p, id, bw, number, 0., limit)?));
                }
                let mut add = |start: f64, d: f64, count: f64, msg: &str| -> Result<(), String> {
                    if !integer(count) || !integer(number as f64 + count) {
                        return Err(msg.into());
                    }
                    if count > (limit / size_of::<String>()) as f64 {
                        return Err("segment index exceeds memory budget".into());
                    }
                    let mut time = start;
                    for _ in 0..count as usize {
                        push(&uri(pattern, id, bw, number, time, limit)?)?;
                        number += 1;
                        time += d;
                    }
                    Ok(())
                };
                if let Some(tl) = templates
                    .iter()
                    .flat_map(|e| children(e, "SegmentTimeline"))
                    .last()
                {
                    let mut entries = children(tl, "S").peekable();
                    let mut time = 0.;
                    while let Some(e) = entries.next() {
                        if let Some(t) = attr(e, "t") {
                            time = js_number(t, 0.);
                        }
                        let d = attr(e, "d").map_or(f64::NAN, |v| js_number(v, 0.));
                        let r = js_number(attr(e, "r").unwrap_or("0"), 0.);
                        if !integer(time)
                            || time < 0.
                            || !integer(d)
                            || d <= 0.
                            || !integer(r)
                            || r < -1.
                        {
                            return Err("Invalid DASH SegmentTimeline".into());
                        }
                        let count = if r == -1. {
                            let end = entries.peek().map_or(seconds * scale, |e| {
                                attr(e, "t").map_or(f64::NAN, |v| js_number(v, 0.))
                            });
                            if !end.is_finite() || end <= time {
                                return Err("Unbounded DASH SegmentTimeline".into());
                            }
                            ((end - time) / d).ceil()
                        } else {
                            r + 1.
                        };
                        add(time, d, count, "Invalid DASH repeat count")?;
                        time += count * d;
                    }
                } else {
                    let d = field("duration").map_or(f64::NAN, |v| js_number(v, 0.));
                    if !d.is_finite() || d <= 0. || seconds <= 0. {
                        return Err("DASH requires a bounded segment duration or timeline".into());
                    }
                    add(
                        0.,
                        d,
                        (seconds * scale / d).ceil(),
                        "Invalid DASH segment count",
                    )?;
                }
            }
        }
        if media.is_empty() {
            return Err("DASH representation has no segments".into());
        }
        sequences.push(Representation { media, init });
    }
    if sequences.is_empty() {
        return Err("DASH manifest has no representations".into());
    }
    Ok((sequences, seconds))
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn inherits_templates_and_stops_repeats_at_next_start_or_period_end() {
        let xml = r#"<MPD mediaPresentationDuration="PT6S"><BaseURL>media/</BaseURL>
        <Period><AdaptationSet><SegmentTemplate timescale="2" startNumber="8"
          initialization="$RepresentationID$-init" media="$Time$-$Number%02d$"/>
        <Representation id="a"><SegmentTemplate><SegmentTimeline>
        <S t="2" d="2" r="-1"/><S t="6" d="3" r="-1"/>
        </SegmentTimeline></SegmentTemplate></Representation></AdaptationSet></Period></MPD>"#;
        let (sequences, duration) = parse(xml, 10000).unwrap();
        assert_eq!(duration, 6.);
        assert_eq!(sequences.len(), 1);
        assert_eq!(sequences[0].init.as_deref(), Some("media/a-init"));
        assert_eq!(sequences[0].media, ["media/2-08", "media/4-09", "media/6-10", "media/9-11"]);
    }
}
