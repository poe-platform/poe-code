// Match the property and script aliases accepted by the production mdq regex parser.
use super::{RxParseError, mdq_classes};
use std::borrow::Cow;

#[path = "mdq_property_data.rs"]
mod data;

fn lookup(name: &str, insensitive: bool) -> Option<Vec<u32>> {
    let i = data::NAMES
        .binary_search_by_key(&name, |&(key, _, _)| key)
        .ok()?;
    let (_, plain, folded) = data::NAMES[i];
    let id = usize::from(if insensitive { folded } else { plain });
    let bytes = &include_bytes!("mdq_properties.bin")[data::OFFSETS[id]..data::OFFSETS[id + 1]];
    let (mut edge, mut delta, mut shift) = (0, 0, 0);
    let mut edges = Vec::new();
    for &byte in bytes {
        delta |= u32::from(byte & 127) << shift;
        if byte < 128 {
            edge += delta;
            edges.push(edge);
            (delta, shift) = (0, 0);
        } else {
            shift += 7;
        }
    }
    Some(edges)
}

fn property(name: &str, insensitive: bool) -> Option<Vec<u32>> {
    let name = name.replace(' ', "").replace('-', "_");
    if name.eq_ignore_ascii_case("ascii") {
        return Some(vec![0, 128]);
    }
    if name.eq_ignore_ascii_case("any") {
        return Some(vec![0, 0x110000]);
    }
    let (key, value) = name.split_once('=').unwrap_or(("", &name));
    let prefix = match key.to_ascii_lowercase().as_str() {
        "sc" | "script" => "Script=",
        "scx" | "scriptextensions" | "script_extensions" => "Script_Extensions=",
        "gc" | "generalcategory" | "general_category" => "General_Category=",
        "" => "",
        _ => return None,
    };
    let title = value
        .to_ascii_lowercase()
        .split('_')
        .map(|s| {
            let mut chars = s.chars();
            chars
                .next()
                .map(|c| c.to_ascii_uppercase().to_string() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join("_");
    for prefix in [Some(prefix), key.is_empty().then_some("Script=")]
        .into_iter()
        .flatten()
    {
        for v in [value, &title] {
            if let Some(edges) = lookup(&format!("{prefix}{v}"), insensitive) {
                return Some(edges);
            }
        }
    }
    None
}

// 'at' points just after the escape. Boundaries alternate between entering
// and leaving the class; uppercase escape letters complement the result.
pub(super) fn escape(
    c: char,
    chars: &[char],
    at: &mut usize,
    insensitive: bool,
) -> Result<Option<(Cow<'static, [u32]>, bool)>, RxParseError> {
    let edges = match c.to_ascii_lowercase() {
        'w' => Cow::Borrowed(mdq_classes::WORD),
        's' => Cow::Borrowed(mdq_classes::SPACE),
        'd' => Cow::Borrowed(mdq_classes::DIGIT),
        'h' => Cow::Borrowed(mdq_classes::HEX),
        'p' => {
            let name = if chars.get(*at) == Some(&'{') {
                *at += 1;
                let start = *at;
                let len = chars[start..]
                    .iter()
                    .position(|&ch| ch == '}')
                    .ok_or("Unicode escape not closed")?;
                *at += len + 1;
                chars[start..start + len].iter().collect()
            } else {
                let ch = chars
                    .get(*at)
                    .ok_or("unexpected end of regular expression")?;
                *at += 1;
                ch.to_string()
            };
            Cow::Owned(property(&name, insensitive).ok_or("Regex error: error parsing pattern 0")?)
        }
        _ => return Ok(None),
    };
    Ok(Some((edges, c.is_ascii_uppercase())))
}

fn complement(edges: &mut Vec<u32>) {
    if edges.first() == Some(&0) {
        edges.remove(0);
    } else {
        edges.insert(0, 0);
    }
    if edges.last() == Some(&0x110000) {
        edges.pop();
    } else {
        edges.push(0x110000);
    }
}

fn union(ranges: &mut Vec<(u32, u32)>) -> Vec<u32> {
    ranges.sort_unstable();
    let mut edges = Vec::<u32>::new();
    for (lo, hi) in ranges.drain(..) {
        if let Some(end) = edges.last_mut()
            && *end >= lo
        {
            *end = (*end).max(hi);
        } else {
            edges.extend([lo, hi]);
        }
    }
    edges
}

#[derive(Default)]
struct Bracket {
    negate: bool,
    term: bool,
    ranges: Vec<(u32, u32)>,
    left: Vec<u32>,
    operator: Option<char>,
}

impl Bracket {
    fn combine(&mut self) {
        let right = union(&mut self.ranges);
        let Some(op) = self.operator.take() else {
            self.left = right;
            return;
        };
        let left = std::mem::take(&mut self.left);
        let (mut a, mut b) = (0, 0);
        let mut inside = false;
        while a < left.len() || b < right.len() {
            let x = left
                .get(a)
                .copied()
                .unwrap_or(u32::MAX)
                .min(right.get(b).copied().unwrap_or(u32::MAX));
            a += usize::from(left.get(a) == Some(&x));
            b += usize::from(right.get(b) == Some(&x));
            let (l, r) = (a % 2 == 1, b % 2 == 1);
            let next = match op {
                '&' => l && r,
                '-' => l && !r,
                _ => l != r,
            };
            if next != inside {
                self.left.push(x);
                inside = next;
            }
        }
    }

    fn finish(mut self, insensitive: bool) -> Vec<u32> {
        self.combine();
        if insensitive {
            let has = |c| self.left.partition_point(|&edge| edge <= c as u32) % 2 == 1;
            for range in lookup("Cased", false).unwrap().chunks_exact(2) {
                for n in range[0]..range[1] {
                    let Some(c) = char::from_u32(n) else { continue };
                    let single = |mut it: std::char::ToUppercase| {
                        let first = it.next().unwrap();
                        it.next().is_none() && has(first)
                    };
                    let mut lower = c.to_lowercase();
                    let first = lower.next().unwrap();
                    if !has(c)
                        && (has(super::mdq_fold(c))
                            || c != 'ı' && single(c.to_uppercase())
                            || lower.next().is_none() && has(first))
                    {
                        self.ranges.push((n, n + 1));
                    }
                }
            }
            if !self.ranges.is_empty() {
                self.ranges
                    .extend(self.left.chunks_exact(2).map(|r| (r[0], r[1])));
                self.left = union(&mut self.ranges);
            }
        }
        if self.negate {
            complement(&mut self.left);
        }
        self.left
    }
}

pub(super) fn bracket(
    chars: &[char],
    at: &mut usize,
    insensitive: bool,
    skip: impl Fn(&mut usize),
) -> Result<super::RxAtom, RxParseError> {
    let enter = |at: &mut usize| {
        *at += 1;
        skip(at);
        let negate = chars.get(*at) == Some(&'^');
        *at += usize::from(negate);
        Bracket {
            negate,
            ..Default::default()
        }
    };
    let mut stack = vec![enter(at)];
    let mut range_start = None;
    loop {
        skip(at);
        let ch = *chars
            .get(*at)
            .ok_or_else(|| RxParseError::at(*at, "Invalid character class"))?;
        let frame = stack.last_mut().unwrap();
        if ch == ']' && frame.term && range_start.is_none() {
            *at += 1;
            let edges = stack.pop().unwrap().finish(insensitive);
            if let Some(parent) = stack.last_mut() {
                parent
                    .ranges
                    .extend(edges.chunks_exact(2).map(|r| (r[0], r[1])));
                parent.term = true;
                continue;
            }
            return Ok(super::RxAtom::MdqClass(edges.into(), false));
        }
        if matches!(ch, '&' | '-' | '~') && chars.get(*at + 1) == Some(&ch) && range_start.is_none()
        {
            frame.combine();
            frame.operator = Some(ch);
            frame.term = false;
            *at += 2;
            continue;
        }
        if ch == '[' && chars.get(*at + 1) != Some(&':') {
            if range_start.is_some() {
                return Err("Regex error: error parsing pattern 0".into());
            }
            stack.push(enter(at));
            continue;
        }
        *at += 1;
        let mut scalar = None;
        if ch == '[' {
            *at += 1;
            let n = chars[*at..]
                .windows(2)
                .position(|p| p == [':', ']'])
                .ok_or("invalid ASCII character class")?;
            let raw: String = chars[*at..*at + n].iter().collect();
            *at += n + 2;
            let name = raw.strip_prefix('^').unwrap_or(&raw);
            let ranges = match name {
                "ascii" => &[('\0', '\x7f')][..],
                "word" => &[('0', '9'), ('A', 'Z'), ('_', '_'), ('a', 'z')][..],
                _ => super::posix_class_ranges(name).ok_or("invalid ASCII character class")?,
            };
            let mut edges: Vec<_> = ranges
                .iter()
                .flat_map(|&(a, b)| [a as u32, b as u32 + 1])
                .collect();
            if name != raw {
                complement(&mut edges);
            }
            frame
                .ranges
                .extend(edges.chunks_exact(2).map(|r| (r[0], r[1])));
        } else if ch == '\\' {
            let c = *chars
                .get(*at)
                .ok_or("unexpected end of regular expression")?;
            *at += 1;
            if let Some((edges, invert)) = escape(c, chars, at, insensitive)? {
                let edges = if invert {
                    let mut e = edges.into_owned();
                    complement(&mut e);
                    Cow::Owned(e)
                } else {
                    edges
                };
                frame
                    .ranges
                    .extend(edges.chunks_exact(2).map(|r| (r[0], r[1])));
            } else {
                scalar = Some(super::mdq_escaped(c, chars, at)?);
            }
        } else {
            scalar = Some(ch);
        }
        if let Some(start) = range_start.take() {
            let end = scalar
                .filter(|&c| c >= start)
                .ok_or("Regex error: error parsing pattern 0")?;
            frame.ranges.push((start as u32, end as u32 + 1));
        } else if let Some(c) = scalar {
            skip(at);
            if chars.get(*at) == Some(&'-') && !matches!(chars.get(*at + 1), Some(']' | '-')) {
                *at += 1;
                range_start = Some(c);
                continue;
            }
            frame.ranges.push((c as u32, c as u32 + 1));
        }
        frame.term = true;
    }
}
