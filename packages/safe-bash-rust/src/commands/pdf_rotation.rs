// A page may appear repeatedly in a qpdf range. Fold the edits in argument order
// without keeping a list of all the expanded page numbers.
#[derive(Clone, Copy)]
pub(in super::super) struct Rotation {
    pub(in super::super) relative: bool,
    pub(in super::super) degrees: i32,
}

impl Rotation {
    pub(super) fn word(self, original: f64) -> super::Value<'static> {
        super::Value::Word(
            (match self.apply(original) {
                90 => b"90".as_slice(),
                180 => b"180",
                270 => b"270",
                _ => b"0".as_slice(),
            })
            .into(),
        )
    }

    pub(in super::super) fn apply(self, original: f64) -> i32 {
        let original = original.rem_euclid(360.);
        let base = if self.relative && matches!(original, 90. | 180. | 270.) {
            original as i32
        } else {
            0
        };
        (base + self.degrees).rem_euclid(360)
    }
}

fn rotation_suffix(s: &str) -> (&str, Option<Rotation>) {
    for (word, short, relative, degrees) in [
        ("north", "n", false, 0),
        ("east", "e", false, 90),
        ("south", "s", false, 180),
        ("west", "w", false, 270),
        ("right", "r", true, 90),
        ("left", "l", true, -90),
        ("down", "d", true, 180),
    ] {
        let protected = matches!(s, "end" | "rend")
            || ["-end", "-rend", "odd", "even"]
                .iter()
                .any(|suffix| s.ends_with(suffix));
        if let Some(base) = s.strip_suffix(word).or_else(|| {
            if protected {
                None
            } else {
                s.strip_suffix(short)
            }
        }) {
            return (base, Some(Rotation { relative, degrees }));
        }
    }
    (s, None)
}

pub(in super::super) fn pdftk_selection(
    token: &str,
    handles: &[String],
    docs: &std::collections::BTreeMap<String, super::super::PdfDoc>,
    primary: &str,
) -> Vec<(String, usize, Option<Rotation>)> {
    fn qualifier(s: &str) -> (&str, Option<bool>) {
        if let Some(base) = s.strip_suffix("even") {
            (base, Some(true))
        } else if let Some(base) = s.strip_suffix("odd") {
            (base, Some(false))
        } else {
            (s, None)
        }
    }
    let token = token.trim();
    let (handle, range) = handles
        .iter()
        .find_map(|key| {
            let tail = token.strip_prefix(key)?.to_ascii_lowercase();
            let (base, rot) = rotation_suffix(qualifier(&tail).0);
            (tail.is_empty()
                || tail.as_bytes()[0].is_ascii_digit()
                || ["r", "end", "odd", "even"]
                    .iter()
                    .any(|s| tail.starts_with(s))
                || (base.is_empty() && rot.is_some()))
            .then_some((key.as_str(), tail))
        })
        .unwrap_or_else(|| (primary, token.to_ascii_lowercase()));
    let count = docs[handle].pages.len();
    if count == 0 {
        return Vec::new();
    }
    let (range, outer) = qualifier(&range);
    let (range, rotation) = rotation_suffix(range);
    let (range, inner) = qualifier(range);
    let endpoint = |s: &str| {
        let s = s.trim();
        if s == "end" {
            return count;
        }
        if s == "rend" {
            return 1;
        }
        let reverse = s.starts_with('r');
        let digits = s
            .strip_prefix('r')
            .unwrap_or(s)
            .trim_start()
            .trim_start_matches('+');
        let n = digits
            .bytes()
            .take_while(u8::is_ascii_digit)
            .fold(0usize, |n, c| {
                n.saturating_mul(10).saturating_add((c - b'0') as usize)
            });
        if n == 0 {
            1
        } else if reverse {
            count.saturating_sub(n) + 1
        } else {
            count.min(n)
        }
    };
    let (a, b) = if range.is_empty() {
        (1, count)
    } else if let Some((a, b)) = range.split_once('-') {
        (endpoint(a), endpoint(b))
    } else {
        let p = endpoint(range);
        (p, p)
    };
    (0..=a.abs_diff(b))
        .map(|i| if a > b { a - i } else { a + i })
        .filter(|i| inner.or(outer).is_none_or(|even| (*i % 2 == 0) == even))
        .map(|p| (handle.to_owned(), p, rotation))
        .collect()
}

struct Range {
    first: i64,
    last: i64,
    step: i64,
    excluded: bool,
}

impl Range {
    fn pages(&self) -> impl Iterator<Item = i64> {
        std::iter::successors(Some(self.first), |n| Some(n + self.step)).take_while(|n| {
            if self.step > 0 {
                *n <= self.last
            } else {
                *n >= self.last
            }
        })
    }
}

pub(in super::super) fn rotations(specs: &[&str], count: usize) -> Option<Vec<Option<Rotation>>> {
    if specs.is_empty() {
        return Some(vec![]);
    }
    let mut result: Vec<Option<Rotation>> = vec![None; count];
    for spec in specs {
        let (angle, range) = spec.split_once(':').unwrap_or((spec, ""));
        let relative = angle.starts_with(['-', '+']);
        let degrees = super::super::qpdf_decimal(angle).map(|n| {
            (if angle.starts_with('-') {
                -n.abs()
            } else {
                n.abs()
            }) % 360.
        });
        visit_range(if range.is_empty() { "1-z" } else { range }, count, |p| {
            let d = degrees.filter(|d| d % 90. == 0.)? as i32;
            let slot = result.get_mut(p)?;
            *slot = Some(match *slot {
                Some(previous) if relative => Rotation {
                    relative: previous.relative,
                    degrees: (previous.degrees + d) % 360,
                },
                _ => Rotation {
                    relative,
                    degrees: d,
                },
            });
            Some(())
        })?;
    }
    Some(result)
}

pub(super) fn visit_range(
    range: &str,
    count: usize,
    mut visit: impl FnMut(usize) -> Option<()>,
) -> Option<()> {
    let page = |token: &str| {
        let s = token.trim();
        if s == "z" {
            return Some(count as i64);
        }
        let n = super::super::qpdf_decimal(s.strip_prefix('r').unwrap_or(s))?;
        if n < 1. || n > count as f64 {
            return None;
        }
        Some(if s.starts_with('r') {
            count as i64 + 1 - n as i64
        } else {
            n as i64
        })
    };
    let mut ranges = Vec::new();
    let mut group_even = None;
    for raw in range.trim().split(',').filter(|s| !s.is_empty()) {
        let excluded = raw.starts_with('x');
        let part = raw.strip_prefix('x').unwrap_or(raw).trim();
        let (part, even) = if let Some(p) = part.strip_suffix(":even") {
            (p, Some(true))
        } else if let Some(p) = part.strip_suffix(":odd") {
            (p, Some(false))
        } else {
            (part, None)
        };
        let first;
        let last;
        let step;
        if let Some((a, b)) = part.split_once('-') {
            let start = page(a)?;
            last = page(b.split('-').next()?)?;
            let dir = if start <= last { 1 } else { -1 };
            first = start + if even == Some(true) { dir } else { 0 };
            step = if even.is_some() { dir * 2 } else { dir };
        } else {
            first = page(part)?;
            last = first;
            step = 1;
            if !excluded && even.is_some() {
                group_even = even;
            }
        }
        ranges.push(Range {
            first,
            last,
            step,
            excluded,
        });
    }
    // Only a later exclusion cancels an inclusion of the same page.
    let mut last_exclusion = std::collections::BTreeMap::new();
    for (i, r) in ranges.iter().enumerate().filter(|(_, r)| r.excluded) {
        for p in r.pages() {
            last_exclusion.insert(p, i);
        }
    }
    let mut even_position = false;
    for (i, r) in ranges.iter().enumerate().filter(|(_, r)| !r.excluded) {
        for p in r.pages() {
            if last_exclusion.get(&p).is_some_and(|e| *e > i) {
                continue;
            }
            let keep = group_even.is_none_or(|even| even == even_position);
            even_position = !even_position;
            if !keep {
                continue;
            }
            visit(usize::try_from(p - 1).ok()?)?;
        }
    }
    Some(())
}
