//! Unicode 17 extended grapheme boundaries (UAX #29), preserving UTF-16 slices.
#[path = "grapheme_tables.rs"]
mod tables;
#[derive(Clone, Copy, PartialEq, Eq)]
enum Property {
    Other,
    CR,
    LF,
    Control,
    Extend,
    Zwj,
    RegionalIndicator,
    Prepend,
    SpacingMark,
    L,
    V,
    T,
    LV,
    Lvt,
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Conjunct {
    None,
    Consonant,
    Extend,
    Linker,
}
fn property(cp: u32) -> Property {
    let ranges = tables::BREAKS;
    let i = ranges.partition_point(|v| v.1 < cp);
    ranges
        .get(i)
        .filter(|v| v.0 <= cp)
        .map_or(Property::Other, |v| v.2)
}
fn conjunct(cp: u32) -> Conjunct {
    let ranges = tables::CONJUNCT;
    let i = ranges.partition_point(|v| v.1 < cp);
    ranges
        .get(i)
        .filter(|v| v.0 <= cp)
        .map_or(Conjunct::None, |v| v.2)
}
fn pictographic(cp: u32) -> bool {
    let ranges = tables::PICTOGRAPHIC;
    let i = ranges.partition_point(|v| v.1 < cp);
    ranges.get(i).is_some_and(|v| v.0 <= cp)
}
struct Point {
    cp: u32,
    start: usize,
    property: Property,
}
fn boundary(points: &[Point], i: usize) -> bool {
    use Property::*;
    let left = points[i - 1].property;
    let right = points[i].property;
    if left == CR && right == LF {
        return false;
    }
    if matches!(left, CR | LF | Control) || matches!(right, CR | LF | Control) {
        return true;
    }
    if left == L && matches!(right, L | V | LV | Lvt)
        || matches!(left, LV | V) && matches!(right, V | T)
        || matches!(left, Lvt | T) && right == T
    {
        return false;
    }
    if matches!(right, Extend | Zwj | SpacingMark) || left == Prepend {
        return false;
    }
    if conjunct(points[i].cp) == Conjunct::Consonant {
        let mut linker = false;
        let mut j = i;
        while j > 0 {
            j -= 1;
            match conjunct(points[j].cp) {
                Conjunct::Linker => linker = true,
                Conjunct::Extend => {}
                Conjunct::Consonant if linker => return false,
                _ => break,
            }
        }
    }
    if left == Zwj && pictographic(points[i].cp) {
        let mut j = i - 1;
        while j > 0 && points[j - 1].property == Extend {
            j -= 1;
        }
        if j > 0 && pictographic(points[j - 1].cp) {
            return false;
        }
    }
    if left == RegionalIndicator && right == RegionalIndicator {
        let mut count = 0;
        let mut j = i;
        while j > 0 && points[j - 1].property == RegionalIndicator {
            count += 1;
            j -= 1;
        }
        if count % 2 == 1 {
            return false;
        }
    }
    true
}
pub fn segments(input: &[u16]) -> Vec<&[u16]> {
    let mut points = Vec::new();
    let mut i = 0;
    while i < input.len() {
        let first = input[i];
        let paired = (0xd800..=0xdbff).contains(&first)
            && input
                .get(i + 1)
                .is_some_and(|n| (0xdc00..=0xdfff).contains(n));
        let cp = if paired {
            0x10000 + (u32::from(first) - 0xd800) * 1024 + (u32::from(input[i + 1]) - 0xdc00)
        } else {
            u32::from(first)
        };
        points.push(Point {
            cp,
            start: i,
            property: property(cp),
        });
        i += if paired { 2 } else { 1 };
    }
    if points.is_empty() {
        return vec![];
    }
    let mut start = 0;
    let mut out = Vec::new();
    for i in 1..points.len() {
        if boundary(&points, i) {
            let end = points[i].start;
            out.push(&input[start..end]);
            start = end;
        }
    }
    out.push(&input[start..]);
    out
}
