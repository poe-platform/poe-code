/// Node timers clamp overflowing values to one millisecond. Reject those values
/// before starting an exchange so a configured deadline cannot silently shrink.
pub fn valid_timeout(value: f64) -> bool {
    value.is_finite() && (0.0..=2_147_483_647.0).contains(&value)
}

pub fn valid_protocol_pin(value: &str) -> bool {
    matches!(value, "2025-03-26" | "2026-07-28")
}
