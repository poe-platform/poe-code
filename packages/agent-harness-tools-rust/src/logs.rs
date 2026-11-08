//! Filename policy, independent of filesystem, crypto and date providers.
pub fn slug_label(value: &[u16]) -> Vec<u16> {
    let mut out = Vec::with_capacity(value.len());
    for unit in value {
        let unit = match unit {
            65..=90 => unit + 32,
            97..=122 | 48..=57 | 45 | 95 => *unit,
            _ => 45,
        };
        if unit != 45 || (!out.is_empty() && out.last() != Some(&45)) {
            out.push(unit);
        }
    }
    if out.last() == Some(&45) {
        out.pop();
    }
    out
}
pub fn plan_slug(base: &[u16], digest: &[u16]) -> Vec<u16> {
    let stem = match base.iter().rposition(|unit| *unit == 46) {
        Some(dot) if dot > 0 => &base[..dot],
        _ => base,
    };
    let mut label = slug_label(stem);
    if label.is_empty() {
        label.extend("plan".encode_utf16());
    }
    label.push(45);
    label.extend(digest);
    label
}
pub fn file_name(role: &[u16], date: &[Vec<u16>; 7]) -> Vec<u16> {
    let mut out = date[0].clone();
    for (index, value) in date.iter().enumerate().skip(1) {
        if index == 3 || index == 6 {
            out.push(45);
        }
        let width: usize = if index == 6 { 3 } else { 2 };
        out.extend(std::iter::repeat_n(48, width.saturating_sub(value.len())));
        out.extend(value);
    }
    out.push(45);
    let label = slug_label(role);
    if label.is_empty() {
        out.extend("role".encode_utf16());
    } else {
        out.extend(label);
    }
    out.extend(".jsonl".encode_utf16());
    out
}
