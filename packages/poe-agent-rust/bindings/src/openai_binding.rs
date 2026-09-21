use napi_derive::napi;
use poe_agent_rust::openai_policy;

#[napi]
pub fn agent_openai_retryable(status: u32, override_header: Option<String>) -> bool {
    openai_policy::retryable(status, override_header.as_deref())
}

#[napi]
pub fn agent_openai_retry_delay(attempt: u32, random: f64) -> f64 {
    openai_policy::retry_delay(attempt, random)
}
