use mcp_protocol_rust::json::{self, Value};
use tiny_http_mcp_oauth_test_server_rust::{Fixture, options};
fn v(s: &str) -> Value {
    json::parse_utf16(&s.encode_utf16().collect::<Vec<_>>(), Default::default()).unwrap()
}
fn prop(v: &Value, key: &str) -> String {
    json::stringify(v.get(key).unwrap())
}
#[test]
fn configuration_defaults_and_order() {
    let result = options(&v("{}")).unwrap();
    assert_eq!(prop(&result, "mcpPath"), "\"/mcp\"");
    assert_eq!(prop(&result, "scopes"), "[\"mcp.read\"]");
    assert_eq!(prop(&result, "ttlSeconds"), "60");
    for (input, message) in [
        (
            r#"{"mcpPath":"x?y","scopes":[" "]}"#,
            "mcpPath must not include a query or fragment",
        ),
        (
            r#"{"scopes":[" "],"ttlSeconds":0}"#,
            "scopes must contain non-empty values",
        ),
        (
            r#"{"ttlSeconds":0}"#,
            "ttlSeconds must be a positive integer, received 0",
        ),
    ] {
        assert_eq!(options(&v(input)).unwrap_err().message, message);
    }
    assert_eq!(
        options(&v(r#"{"mcpPath":"a//"}"#)).unwrap().get("mcpPath"),
        Some(&v(r#""/a/""#))
    );
}
#[test]
fn admission_retry_and_stale_handles() {
    let mut fixture = Fixture::default();
    assert_eq!(fixture.call("start", v(r#"{"port":0}"#)).unwrap(), v("0"));
    assert!(fixture.call("start", v("{}")).is_err());
    for attempt in 0..9 {
        assert_eq!(
            fixture
                .call(
                    "retry",
                    v(&format!(
                        r#"{{"port":0,"attempt":{attempt},"ownCode":"EADDRINUSE"}}"#
                    ))
                )
                .unwrap(),
            v("true")
        );
    }
    assert_eq!(
        fixture
            .call(
                "retry",
                v(r#"{"port":0,"attempt":9,"ownCode":"EADDRINUSE"}"#)
            )
            .unwrap(),
        v("false")
    );
    let first = fixture.call("bound", v("{}")).unwrap();
    assert_eq!(
        fixture.call("close_needed", first.clone()).unwrap(),
        v("true")
    );
    fixture.call("closed", first.clone()).unwrap();
    fixture.call("start", v("{}")).unwrap();
    let second = fixture.call("bound", v("{}")).unwrap();
    assert_ne!(first, second);
    assert_eq!(fixture.call("close_needed", first).unwrap(), v("false"));
    assert_eq!(fixture.call("close_needed", second).unwrap(), v("true"));
}
#[test]
fn failed_admission_resets_and_invalid_port_does_not_lock() {
    let mut fixture = Fixture::default();
    for port in ["-1", "1.5", "70000", r#"{"nativeNonFinite":true}"#] {
        assert!(
            fixture
                .call("start", v(&format!("{{\"port\":{port}}}")))
                .is_err()
        );
    }
    fixture.call("start", v("{}")).unwrap();
    fixture.call("failed", v("{}")).unwrap();
    fixture.call("start", v("{}")).unwrap();
}
#[test]
fn separate_ports_and_rejection_priority() {
    let mut fixture = Fixture::default();
    assert!(
        fixture
            .call("ports", v(r#"{"port":80,"oauthPort":80,"sameHost":true}"#))
            .is_err()
    );
    assert_eq!(
        fixture
            .call("ports", v(r#"{"port":0,"oauthPort":80,"sameHost":true}"#))
            .unwrap(),
        v("false")
    );
    assert_eq!(
        fixture
            .call("ports", v(r#"{"port":81,"oauthPort":80,"sameHost":true}"#))
            .unwrap(),
        v("true")
    );
    assert_eq!(
        fixture
            .call(
                "first_rejection",
                v(r#"[{"status":"fulfilled"},{"status":"rejected"},{"status":"rejected"}]"#)
            )
            .unwrap(),
        v("1")
    );
    assert_eq!(
        fixture
            .call("first_rejection", v(r#"[{"status":"fulfilled"}]"#))
            .unwrap(),
        v("null")
    );
}
#[test]
fn ephemeral_reservations_reject_collisions_without_failing_startup() {
    let mut fixture = Fixture::default();
    assert_eq!(
        fixture
            .call(
                "ports",
                v(r#"{"port":80,"oauthPort":80,"sameHost":true,"reserved":true}"#)
            )
            .unwrap(),
        v("false")
    );
}
