//! Plan identifiers, readiness and queue presentation policy.
pub fn file_id(filename: &[u16]) -> Option<Vec<u16>> {
    let stem = filename.strip_suffix(&[46, 109, 100])?;
    let prefix = stem
        .iter()
        .take_while(|unit| matches!(**unit, 48..=57))
        .count();
    Some(
        if prefix > 0 && stem.get(prefix) == Some(&45) && prefix + 1 < stem.len() {
            stem[prefix + 1..].to_vec()
        } else {
            stem.to_vec()
        },
    )
}
pub fn readiness(value: Option<&[u16]>) -> Option<Vec<u16>> {
    match value {
        None | Some([100, 114, 97, 102, 116]) => Some("draft".encode_utf16().collect()),
        Some([114, 101, 97, 100, 121]) => Some("ready".encode_utf16().collect()),
        _ => None,
    }
}
pub fn readiness_label(label: &[u16], ready: bool) -> Vec<u16> {
    let mut out = label.to_vec();
    if ready {
        out.extend([32, 0x2713]);
    }
    out
}
pub fn compare_readiness(left: bool, right: bool) -> i32 {
    i32::from(right) - i32::from(left)
}
pub fn queue_summary(
    completed_plans: u32,
    plans: u32,
    completed_messages: u32,
    messages: u32,
    pending: u32,
) -> Vec<u16> {
    let mut out = format!("{completed_plans}/{plans} plans");
    if messages > 0 {
        out.push_str(&format!(" · {completed_messages}/{messages} messages"));
    }
    if pending > 0 {
        out.push_str(&format!(" · {pending} pending"));
    }
    out.encode_utf16().collect()
}
