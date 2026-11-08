use poe_agent_rust::openai_policy::{retry_delay, retryable};

#[test]
fn retry_overrides_and_statuses_follow_the_sdk() {
    for status in [408, 409, 429, 500, 503] {
        assert!(retryable(status, None));
        assert!(!retryable(status, Some("false")));
    }
    for status in [200, 400, 401, 404, 422] {
        assert!(!retryable(status, None));
        assert!(retryable(status, Some("true")));
    }
    assert!(!retryable(400, Some("TRUE")));
}

#[test]
fn retry_backoff_has_jitter_and_a_cap() {
    assert_eq!(retry_delay(0, 0.0), 500.0);
    assert_eq!(retry_delay(1, 0.5), 875.0);
    assert_eq!(retry_delay(1000, 0.0), 8000.0);
}
