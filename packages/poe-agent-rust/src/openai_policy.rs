//! OpenAI-compatible HTTP retry decisions, without an SDK runtime dependency.
pub fn retryable(status: u32, override_header: Option<&str>) -> bool {
    match override_header {
        Some("true") => true,
        Some("false") => false,
        _ => matches!(status, 408 | 409 | 429) || status >= 500,
    }
}

pub fn retry_delay(attempt: u32, random: f64) -> f64 {
    let delay = 500.0 * 2.0_f64.powi(attempt.min(4) as i32);
    delay.min(8000.0) * (1.0 - random * 0.25)
}
