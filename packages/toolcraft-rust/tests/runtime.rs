use toolcraft_rust::{
    ApiVersionIssue, api_version_issue, candidate_distances, http_error_class, is_log_level,
    should_emit_diagnostic,
};

fn utf16(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}

#[test]
fn suggestion_distance_uses_utf16_and_adjacent_transpositions() {
    let candidates = ["widgets", "widgts", "wigtds"].map(utf16);
    assert_eq!(
        candidate_distances(&utf16("widgts"), &candidates),
        vec![1, 0, 2]
    );
    assert_eq!(
        candidate_distances(&[0xd800], &[vec![0xd801], vec![0xd800], vec![]]),
        vec![1, 0, 1]
    );
    assert_eq!(candidate_distances(&utf16("🦀"), &[utf16("")]), vec![2]);
    assert_eq!(candidate_distances(&utf16("CA"), &[utf16("ABC")]), vec![3]);
}

#[test]
fn api_versions_follow_the_existing_numeric_triplet_contract() {
    assert_eq!(
        api_version_issue(">=2.4.0", Some("2.3.9")),
        Some(ApiVersionIssue::TooOld)
    );
    assert_eq!(api_version_issue(">=2.4.0", Some("2.4.0")), None);
    assert_eq!(
        api_version_issue(">=\u{feff}002.04.0\u{a0}", Some("2.4.0")),
        None
    );
    assert_eq!(
        api_version_issue(">=1.0.0", None),
        Some(ApiVersionIssue::MissingRunner)
    );
    for requirement in ["1.0.0", ">=1.0", ">=1.0.-1", ">=1.0.0-beta", ">=١.0.0"] {
        assert_eq!(
            api_version_issue(requirement, None),
            Some(ApiVersionIssue::InvalidRequirement)
        );
    }
    for runner in [" 1.0.0", "1.0.0\n", "1.0.0-beta", "1.0.1e2"] {
        assert_eq!(
            api_version_issue(">=1.0.0", Some(runner)),
            Some(ApiVersionIssue::InvalidRunner)
        );
    }
    // Number() rounds integer components before comparison in JavaScript.
    assert_eq!(
        api_version_issue(">=9007199254740993.0.0", Some("9007199254740992.0.0")),
        None
    );
    assert_eq!(
        api_version_issue(&format!(">={}.0.0", "9".repeat(400)), Some("1.0.0")),
        Some(ApiVersionIssue::InvalidRequirement)
    );
}

#[test]
fn logging_and_http_policies_cover_all_categories() {
    let levels = ["silent", "error", "warn", "info", "debug", "trace"];
    for (event_rank, event) in levels.iter().enumerate() {
        assert!(is_log_level(event));
        for (configured_rank, configured) in levels.iter().enumerate() {
            assert_eq!(
                should_emit_diagnostic(event, configured),
                event_rank != 0 && configured_rank != 0 && event_rank <= configured_rank
            );
        }
    }
    assert!(!is_log_level("toString"));
    assert!(!should_emit_diagnostic("invalid", "trace"));
    for (status, class) in [
        (200.0, "HttpError"),
        (400.0, "BadRequestError"),
        (401.0, "AuthenticationError"),
        (403.0, "PermissionDeniedError"),
        (404.0, "NotFoundError"),
        (409.0, "ConflictError"),
        (422.0, "UnprocessableEntityError"),
        (429.0, "RateLimitError"),
        (499.0, "ClientError"),
        (500.0, "InternalServerError"),
        (503.0, "ServiceUnavailableError"),
        (599.0, "ServerError"),
        (400.5, "ClientError"),
        (f64::NAN, "HttpError"),
        (f64::INFINITY, "ServerError"),
    ] {
        assert_eq!(http_error_class(status), class);
    }
}
