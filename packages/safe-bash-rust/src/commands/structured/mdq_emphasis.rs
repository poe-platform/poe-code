// CommonMark delimiter runs are resolved after links, code and raw HTML have
// claimed their source spans. Only matched markers disappear from plain text.
use std::collections::{BTreeMap, HashMap};
use std::ops::Range;

#[derive(Default)]
pub(super) struct Marks {
    pub width: usize,
    remaining: usize,
    opening: Vec<&'static str>,
    closing: Vec<&'static str>,
}

impl Marks {
    pub fn write(&self, out: &mut String, marker: char, plain: bool) {
        if !plain {
            self.closing.iter().for_each(|s| out.push_str(s));
        }
        out.extend(std::iter::repeat_n(marker, self.remaining));
        if !plain {
            self.opening.iter().rev().for_each(|s| out.push_str(s));
        }
    }
}

struct Run {
    at: usize,
    marker: u8,
    open: bool,
    close: bool,
    marks: Marks,
}

pub(super) fn space(c: char) -> bool {
    c.is_whitespace() && !matches!(c, '\u{b}' | '\u{85}' | '\u{2028}' | '\u{2029}')
}

pub(super) fn resolve<'a>(
    src: &str,
    opaque: impl Iterator<Item = &'a Range<usize>>,
) -> BTreeMap<usize, Marks> {
    let mut runs: Vec<Run> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    let mut floors = HashMap::new();
    let mut opaque = opaque.peekable();
    let bytes = src.as_bytes();
    let ticks = super::mdq_backtick_runs(bytes);
    let mut at = 0;
    while at < bytes.len() {
        if let Some(r) = opaque.next_if(|r| r.start == at) {
            at = r.end;
            continue;
        }
        let marker = bytes[at];
        if marker == b'\\' && bytes.get(at + 1).is_some_and(u8::is_ascii_punctuation) {
            at += 2;
            continue;
        }
        if marker == b'`' {
            let (width, end) = super::mdq_code_delimiters(bytes, at, &ticks);
            at = end.unwrap_or(at) + width;
            continue;
        }
        if marker == b'<'
            && let Some(n) = super::mdq_inline_html_len(&src[at..])
        {
            at += n;
            continue;
        }
        if !matches!(marker, b'*' | b'_' | b'~') {
            at += 1;
            continue;
        }
        let start = at;
        while bytes.get(at) == Some(&marker) {
            at += 1;
        }
        let width = at - start;
        if marker == b'~' && width > 2 {
            continue;
        }
        let prev = src[..start].chars().next_back();
        let next = src[at..].chars().next();
        let left = !next.is_none_or(space)
            && (!next.is_some_and(punctuation)
                || prev.is_none_or(space)
                || prev.is_some_and(punctuation));
        let right = !prev.is_none_or(space)
            && (!prev.is_some_and(punctuation)
                || next.is_none_or(space)
                || next.is_some_and(punctuation));
        let open = left && (marker != b'_' || !right || prev.is_some_and(punctuation));
        let close = right && (marker != b'_' || !left || next.is_some_and(punctuation));
        if !open && !close {
            continue;
        }
        let mut run = Run {
            at: start,
            marker,
            open,
            close,
            marks: Marks {
                width,
                remaining: width,
                ..Marks::default()
            },
        };
        let key = (marker, open, width % 3);
        while close && run.marks.remaining != 0 {
            let floor = floors.get(&key).copied().unwrap_or(0);
            let found = stack
                .iter()
                .enumerate()
                .rev()
                .take_while(|(_, i)| **i >= floor)
                .find(|(_, i)| {
                    let r = &runs[**i];
                    let other = r.marks.width;
                    r.marker == marker
                        && r.open
                        && if marker == b'~' {
                            width == other
                        } else {
                            !((open || r.close)
                                && (width + other) % 3 == 0
                                && (width % 3 != 0 || other % 3 != 0))
                        }
                });
            let Some((pos, &i)) = found else {
                floors.insert(key, stack.last().map_or(0, |n| n + 1));
                break;
            };
            let opening = &mut runs[i].marks;
            let used = opening.remaining.min(run.marks.remaining).min(2);
            let delimiter = match (marker, used) {
                (b'~', _) => "~~",
                (_, 2) => "**",
                _ => "_",
            };
            opening.remaining -= used;
            run.marks.remaining -= used;
            opening.opening.push(delimiter);
            run.marks.closing.push(delimiter);
            stack.truncate(pos + usize::from(opening.remaining != 0));
        }
        if open && run.marks.remaining != 0 {
            stack.push(runs.len());
        }
        runs.push(run);
    }
    runs.into_iter()
        .filter(|r| r.marks.width != r.marks.remaining)
        .map(|r| (r.at, r.marks))
        .collect()
}

// Positions follow mdq's byte-based formatting events, even when several
// matches change length. Match offsets always refer to the original text.
pub(super) struct Event {
    start: usize,
    end: usize,
    marker: &'static str,
}

pub(super) fn projection(src: &str) -> (String, Vec<Event>) {
    let marks = resolve(src, std::iter::empty());

    let literal = BTreeMap::new();
    let mut text = String::new();
    let mut events: Vec<Event> = Vec::new();
    let mut open: Vec<usize> = Vec::new();
    let gap = |text: &mut String, events: &mut Vec<Event>, input: &str| {
        let offset = text.len();
        text.push_str(&super::mdq_render_span(input, true, &literal, 0, |range| {
            events.push(Event {
                start: offset + range.start,
                end: offset + range.end,
                marker: "`",
            });
        }));
    };
    let mut at = 0;
    for (i, run) in marks {
        gap(&mut text, &mut events, &src[at..i]);
        for _ in run.closing {
            events[open.pop().unwrap()].end = text.len();
        }
        text.extend(std::iter::repeat_n(
            src.as_bytes()[i] as char,
            run.remaining,
        ));
        for marker in run.opening.into_iter().rev() {
            open.push(events.len());
            events.push(Event {
                start: text.len(),
                end: text.len(),
                marker,
            });
        }
        at = i + run.width;
    }
    gap(&mut text, &mut events, &src[at..]);
    (text, events)
}

pub(super) fn reconstruct(
    text: &str,
    mut events: Vec<Event>,
    ranges: &[(usize, usize, usize)],
) -> Result<String, String> {
    for &(start, end, replacement) in ranges {
        let delta = replacement as isize - (end as isize - start as isize);
        let mut atoms = events
            .iter()
            .filter(|e| e.marker == "`" && e.start < end && e.end >= start);
        if let Some(atom) = atoms.next()
            && (start < atom.start || end > atom.end || atoms.next().is_some())
        {
            return Err("replacement crosses atomic boundary".into());
        }
        events.retain_mut(|e| {
            if e.start < start {
                if e.end > start {
                    e.end = if e.end < end {
                        start
                    } else {
                        e.end.saturating_add_signed(delta)
                    };
                }
            } else if e.start == start {
                if e.end <= end {
                    if replacement == 0 {
                        return false;
                    }
                    e.end = start + replacement;
                } else {
                    e.end = e.end.saturating_add_signed(delta);
                }
            } else if e.start < end {
                if e.end <= end {
                    return false;
                }
                e.end = e.end.saturating_add_signed(delta);
                e.start = start + replacement;
            } else {
                e.start = e.start.saturating_add_signed(delta);
                e.end = e.end.saturating_add_signed(delta);
            }
            true
        });
    }
    let mut out = String::new();
    let mut pos = 0;
    let formatted = !events.is_empty();
    // These strings will be parsed again if another selector follows. Quote
    // literal punctuation and protect the text on each side of a delimiter:
    // CommonMark otherwise treats a space inserted beside a marker as syntax.
    let literal = |out: &mut String, start: usize, end: usize| -> Result<(), String> {
        use std::fmt::Write;
        let slice = text
            .get(start..end)
            .ok_or("internal error: formatting boundary is not a UTF-8 boundary")?;
        let mut chars = slice.chars().peekable();
        let mut first = true;
        while let Some(c) = chars.next() {
            if formatted
                && (first || chars.peek().is_none())
                && (!c.is_control() || matches!(c, '\n' | '\t' | '\r'))
            {
                write!(out, "&#{};", c as u32).unwrap();
            } else {
                if c.is_ascii_punctuation() {
                    out.push('\\');
                }
                out.push(c);
            }
            first = false;
        }
        Ok(())
    };
    let mut closes = Vec::<(usize, &'static str)>::new();
    let mut events = events.into_iter().peekable();
    loop {
        let end = closes.last().map_or(text.len(), |c| c.0);
        if let Some(e) = events.next_if(|e| e.start < end) {
            if e.end <= pos {
                continue;
            }
            let start = pos.max(e.start);
            literal(&mut out, pos, start)?;
            pos = start;
            let stop = e.end.min(end);
            if e.marker == "`" {
                let code = text
                    .get(pos..stop)
                    .ok_or("internal error: formatting boundary is not a UTF-8 boundary")?;
                super::mdq_write_inline_code(&mut out, code);
                pos = stop;
            } else if stop > pos {
                out.push_str(e.marker);
                closes.push((stop, e.marker));
            }
        } else {
            literal(&mut out, pos, end)?;
            pos = end;
            if let Some((_, mark)) = closes.pop() {
                out.push_str(mark);
            } else {
                break;
            }
        }
    }
    if events.len() != 0 {
        return Err(format!(
            "internal error: failed to unflatten: {} events remaining",
            events.len()
        ));
    }
    Ok(out)
}

fn punctuation(c: char) -> bool {
    // Unicode 17.0 punctuation/symbol ranges from commonmark-characters.ts.
    // Each pair is a half-open interval. See LICENSE.UNICODE.
    PUNCTUATION.partition_point(|&edge| edge <= c as u32) % 2 == 1
}
const PUNCTUATION: &[u32] = &[
    0x21, 0x30, 0x3a, 0x41, 0x5b, 0x61, 0x7b, 0x7f, 0xa1, 0xaa, 0xab, 0xad, 0xae, 0xb2, 0xb4, 0xb5,
    0xb6, 0xb9, 0xbb, 0xbc, 0xbf, 0xc0, 0xd7, 0xd8, 0xf7, 0xf8, 0x2c2, 0x2c6, 0x2d2, 0x2e0, 0x2e5,
    0x2ec, 0x2ed, 0x2ee, 0x2ef, 0x300, 0x375, 0x376, 0x37e, 0x37f, 0x384, 0x386, 0x387, 0x388,
    0x3f6, 0x3f7, 0x482, 0x483, 0x55a, 0x560, 0x589, 0x58b, 0x58d, 0x590, 0x5be, 0x5bf, 0x5c0,
    0x5c1, 0x5c3, 0x5c4, 0x5c6, 0x5c7, 0x5f3, 0x5f5, 0x606, 0x610, 0x61b, 0x61c, 0x61d, 0x620,
    0x66a, 0x66e, 0x6d4, 0x6d5, 0x6de, 0x6df, 0x6e9, 0x6ea, 0x6fd, 0x6ff, 0x700, 0x70e, 0x7f6,
    0x7fa, 0x7fe, 0x800, 0x830, 0x83f, 0x85e, 0x85f, 0x888, 0x889, 0x964, 0x966, 0x970, 0x971,
    0x9f2, 0x9f4, 0x9fa, 0x9fc, 0x9fd, 0x9fe, 0xa76, 0xa77, 0xaf0, 0xaf2, 0xb70, 0xb71, 0xbf3,
    0xbfb, 0xc77, 0xc78, 0xc7f, 0xc80, 0xc84, 0xc85, 0xd4f, 0xd50, 0xd79, 0xd7a, 0xdf4, 0xdf5,
    0xe3f, 0xe40, 0xe4f, 0xe50, 0xe5a, 0xe5c, 0xf01, 0xf18, 0xf1a, 0xf20, 0xf34, 0xf35, 0xf36,
    0xf37, 0xf38, 0xf39, 0xf3a, 0xf3e, 0xf85, 0xf86, 0xfbe, 0xfc6, 0xfc7, 0xfcd, 0xfce, 0xfdb,
    0x104a, 0x1050, 0x109e, 0x10a0, 0x10fb, 0x10fc, 0x1360, 0x1369, 0x1390, 0x139a, 0x1400, 0x1401,
    0x166d, 0x166f, 0x169b, 0x169d, 0x16eb, 0x16ee, 0x1735, 0x1737, 0x17d4, 0x17d7, 0x17d8, 0x17dc,
    0x1800, 0x180b, 0x1940, 0x1941, 0x1944, 0x1946, 0x19de, 0x1a00, 0x1a1e, 0x1a20, 0x1aa0, 0x1aa7,
    0x1aa8, 0x1aae, 0x1b4e, 0x1b50, 0x1b5a, 0x1b6b, 0x1b74, 0x1b80, 0x1bfc, 0x1c00, 0x1c3b, 0x1c40,
    0x1c7e, 0x1c80, 0x1cc0, 0x1cc8, 0x1cd3, 0x1cd4, 0x1fbd, 0x1fbe, 0x1fbf, 0x1fc2, 0x1fcd, 0x1fd0,
    0x1fdd, 0x1fe0, 0x1fed, 0x1ff0, 0x1ffd, 0x1fff, 0x2010, 0x2028, 0x2030, 0x205f, 0x207a, 0x207f,
    0x208a, 0x208f, 0x20a0, 0x20c2, 0x2100, 0x2102, 0x2103, 0x2107, 0x2108, 0x210a, 0x2114, 0x2115,
    0x2116, 0x2119, 0x211e, 0x2124, 0x2125, 0x2126, 0x2127, 0x2128, 0x2129, 0x212a, 0x212e, 0x212f,
    0x213a, 0x213c, 0x2140, 0x2145, 0x214a, 0x214e, 0x214f, 0x2150, 0x218a, 0x218c, 0x2190, 0x242a,
    0x2440, 0x244b, 0x249c, 0x24ea, 0x2500, 0x2776, 0x2794, 0x2b74, 0x2b76, 0x2c00, 0x2ce5, 0x2ceb,
    0x2cf9, 0x2cfd, 0x2cfe, 0x2d00, 0x2d70, 0x2d71, 0x2e00, 0x2e2f, 0x2e30, 0x2e5e, 0x2e80, 0x2e9a,
    0x2e9b, 0x2ef4, 0x2f00, 0x2fd6, 0x2ff0, 0x3000, 0x3001, 0x3005, 0x3008, 0x3021, 0x3030, 0x3031,
    0x3036, 0x3038, 0x303d, 0x3040, 0x309b, 0x309d, 0x30a0, 0x30a1, 0x30fb, 0x30fc, 0x3190, 0x3192,
    0x3196, 0x31a0, 0x31c0, 0x31e6, 0x31ef, 0x31f0, 0x3200, 0x321f, 0x322a, 0x3248, 0x3250, 0x3251,
    0x3260, 0x3280, 0x328a, 0x32b1, 0x32c0, 0x3400, 0x4dc0, 0x4e00, 0xa490, 0xa4c7, 0xa4fe, 0xa500,
    0xa60d, 0xa610, 0xa673, 0xa674, 0xa67e, 0xa67f, 0xa6f2, 0xa6f8, 0xa700, 0xa717, 0xa720, 0xa722,
    0xa789, 0xa78b, 0xa828, 0xa82c, 0xa836, 0xa83a, 0xa874, 0xa878, 0xa8ce, 0xa8d0, 0xa8f8, 0xa8fb,
    0xa8fc, 0xa8fd, 0xa92e, 0xa930, 0xa95f, 0xa960, 0xa9c1, 0xa9ce, 0xa9de, 0xa9e0, 0xaa5c, 0xaa60,
    0xaa77, 0xaa7a, 0xaade, 0xaae0, 0xaaf0, 0xaaf2, 0xab5b, 0xab5c, 0xab6a, 0xab6c, 0xabeb, 0xabec,
    0xfb29, 0xfb2a, 0xfbb2, 0xfbd3, 0xfd3e, 0xfd50, 0xfd90, 0xfd92, 0xfdc8, 0xfdd0, 0xfdfc, 0xfe00,
    0xfe10, 0xfe1a, 0xfe30, 0xfe53, 0xfe54, 0xfe67, 0xfe68, 0xfe6c, 0xff01, 0xff10, 0xff1a, 0xff21,
    0xff3b, 0xff41, 0xff5b, 0xff66, 0xffe0, 0xffe7, 0xffe8, 0xffef, 0xfffc, 0xfffe, 0x10100,
    0x10103, 0x10137, 0x10140, 0x10179, 0x1018a, 0x1018c, 0x1018f, 0x10190, 0x1019d, 0x101a0,
    0x101a1, 0x101d0, 0x101fd, 0x1039f, 0x103a0, 0x103d0, 0x103d1, 0x1056f, 0x10570, 0x10857,
    0x10858, 0x10877, 0x10879, 0x1091f, 0x10920, 0x1093f, 0x10940, 0x10a50, 0x10a59, 0x10a7f,
    0x10a80, 0x10ac8, 0x10ac9, 0x10af0, 0x10af7, 0x10b39, 0x10b40, 0x10b99, 0x10b9d, 0x10d6e,
    0x10d6f, 0x10d8e, 0x10d90, 0x10ead, 0x10eae, 0x10ed0, 0x10ed9, 0x10f55, 0x10f5a, 0x10f86,
    0x10f8a, 0x11047, 0x1104e, 0x110bb, 0x110bd, 0x110be, 0x110c2, 0x11140, 0x11144, 0x11174,
    0x11176, 0x111c5, 0x111c9, 0x111cd, 0x111ce, 0x111db, 0x111dc, 0x111dd, 0x111e0, 0x11238,
    0x1123e, 0x112a9, 0x112aa, 0x113d4, 0x113d6, 0x113d7, 0x113d9, 0x1144b, 0x11450, 0x1145a,
    0x1145c, 0x1145d, 0x1145e, 0x114c6, 0x114c7, 0x115c1, 0x115d8, 0x11641, 0x11644, 0x11660,
    0x1166d, 0x116b9, 0x116ba, 0x1173c, 0x11740, 0x1183b, 0x1183c, 0x11944, 0x11947, 0x119e2,
    0x119e3, 0x11a3f, 0x11a47, 0x11a9a, 0x11a9d, 0x11a9e, 0x11aa3, 0x11b00, 0x11b0a, 0x11be1,
    0x11be2, 0x11c41, 0x11c46, 0x11c70, 0x11c72, 0x11ef7, 0x11ef9, 0x11f43, 0x11f50, 0x11fd5,
    0x11ff2, 0x11fff, 0x12000, 0x12470, 0x12475, 0x12ff1, 0x12ff3, 0x16a6e, 0x16a70, 0x16af5,
    0x16af6, 0x16b37, 0x16b40, 0x16b44, 0x16b46, 0x16d6d, 0x16d70, 0x16e97, 0x16e9b, 0x16fe2,
    0x16fe3, 0x1bc9c, 0x1bc9d, 0x1bc9f, 0x1bca0, 0x1cc00, 0x1ccf0, 0x1ccfa, 0x1ccfd, 0x1cd00,
    0x1ceb4, 0x1ceba, 0x1ced1, 0x1cee0, 0x1cef1, 0x1cf50, 0x1cfc4, 0x1d000, 0x1d0f6, 0x1d100,
    0x1d127, 0x1d129, 0x1d165, 0x1d16a, 0x1d16d, 0x1d183, 0x1d185, 0x1d18c, 0x1d1aa, 0x1d1ae,
    0x1d1eb, 0x1d200, 0x1d242, 0x1d245, 0x1d246, 0x1d300, 0x1d357, 0x1d6c1, 0x1d6c2, 0x1d6db,
    0x1d6dc, 0x1d6fb, 0x1d6fc, 0x1d715, 0x1d716, 0x1d735, 0x1d736, 0x1d74f, 0x1d750, 0x1d76f,
    0x1d770, 0x1d789, 0x1d78a, 0x1d7a9, 0x1d7aa, 0x1d7c3, 0x1d7c4, 0x1d800, 0x1da00, 0x1da37,
    0x1da3b, 0x1da6d, 0x1da75, 0x1da76, 0x1da84, 0x1da85, 0x1da8c, 0x1e14f, 0x1e150, 0x1e2ff,
    0x1e300, 0x1e5ff, 0x1e600, 0x1e95e, 0x1e960, 0x1ecac, 0x1ecad, 0x1ecb0, 0x1ecb1, 0x1ed2e,
    0x1ed2f, 0x1eef0, 0x1eef2, 0x1f000, 0x1f02c, 0x1f030, 0x1f094, 0x1f0a0, 0x1f0af, 0x1f0b1,
    0x1f0c0, 0x1f0c1, 0x1f0d0, 0x1f0d1, 0x1f0f6, 0x1f10d, 0x1f1ae, 0x1f1e6, 0x1f203, 0x1f210,
    0x1f23c, 0x1f240, 0x1f249, 0x1f250, 0x1f252, 0x1f260, 0x1f266, 0x1f300, 0x1f6d9, 0x1f6dc,
    0x1f6ed, 0x1f6f0, 0x1f6fd, 0x1f700, 0x1f7da, 0x1f7e0, 0x1f7ec, 0x1f7f0, 0x1f7f1, 0x1f800,
    0x1f80c, 0x1f810, 0x1f848, 0x1f850, 0x1f85a, 0x1f860, 0x1f888, 0x1f890, 0x1f8ae, 0x1f8b0,
    0x1f8bc, 0x1f8c0, 0x1f8c2, 0x1f8d0, 0x1f8d9, 0x1f900, 0x1fa58, 0x1fa60, 0x1fa6e, 0x1fa70,
    0x1fa7d, 0x1fa80, 0x1fa8b, 0x1fa8e, 0x1fac7, 0x1fac8, 0x1fac9, 0x1facd, 0x1fadd, 0x1fadf,
    0x1faeb, 0x1faef, 0x1faf9, 0x1fb00, 0x1fb93, 0x1fb94, 0x1fbf0, 0x1fbfa, 0x1fbfb,
];
