// A page may appear repeatedly in a qpdf range. Fold the edits in argument order
// without keeping a list of all the expanded page numbers.
#[derive(Clone, Copy)]
pub(in super::super) struct Rotation {
    relative: bool,
    degrees: i32,
}

impl Rotation {
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

// Number.parseInt(value, 10) consumes just a signed decimal prefix.
fn decimal(s: &str) -> Option<f64> {
    let s = s.trim_start();
    let digits = s.strip_prefix(['-', '+']).unwrap_or(s);
    let count = digits.bytes().take_while(u8::is_ascii_digit).count();
    (count > 0)
        .then(|| s[..s.len() - digits.len() + count].parse().ok())
        .flatten()
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
    let page = |token: &str| {
        let s = token.trim();
        if s == "z" {
            return Some(count as i64);
        }
        let n = decimal(s.strip_prefix('r').unwrap_or(s))?;
        if n < 1. || n > count as f64 {
            return None;
        }
        Some(if s.starts_with('r') {
            count as i64 + 1 - n as i64
        } else {
            n as i64
        })
    };
    for spec in specs {
        let (angle, range) = spec.split_once(':').unwrap_or((spec, ""));
        let relative = angle.starts_with(['-', '+']);
        let degrees = decimal(angle).map(|n| {
            (if angle.starts_with('-') {
                -n.abs()
            } else {
                n.abs()
            }) % 360.
        });
        let mut ranges = Vec::new();
        let mut group_even = None;
        for raw in (if range.is_empty() {
            "1-z"
        } else {
            range.trim()
        })
        .split(',')
        .filter(|s| !s.is_empty())
        {
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
                let d = degrees.filter(|d| d % 90. == 0.)? as i32;
                let slot = result.get_mut(usize::try_from(p - 1).ok()?)?;
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
            }
        }
    }
    Some(result)
}
