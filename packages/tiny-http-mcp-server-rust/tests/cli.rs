use mcp_protocol_rust::json::{self, Limits, Value};
use tiny_http_mcp_server_rust::cli::{
    Shutdown, SignalAction, module_kind, numeric_plan, oauth_plan,
};
fn value(text: &str) -> Value {
    json::parse(text.as_bytes(), Limits::default()).unwrap()
}
#[test]
fn numeric_admission_matches_decimal_whitespace_rounding_and_error_order() {
    assert_eq!(
        numeric_plan(&value("{}")).unwrap().get("port"),
        Some(&Value::Number(3000.0))
    );
    assert_eq!(numeric_plan(&value(r#"{"port":" 00065535 ","max-request-bytes":"9007199254740993","max-stream-buffer-bytes":"0"}"#)).unwrap().get("maxRequestBytes"),Some(&Value::Number(9007199254740992.0)));
    for input in [
        r#"{"port":"0x20"}"#,
        r#"{"port":"1e2"}"#,
        r#"{"port":"-1"}"#,
        r#"{"port":"\ud800"}"#,
    ] {
        assert_eq!(
            numeric_plan(&value(input)),
            Err("--port must be an integer.".into())
        );
    }
    assert_eq!(
        numeric_plan(&value(r#"{"port":"65536"}"#)),
        Err("--port must be an integer between 0 and 65535.".into())
    );
    assert_eq!(
        numeric_plan(&value(
            r#"{"port":"bad","max-response-bytes":"bad","max-batch-size":"bad"}"#
        )),
        Err("--max-batch-size must be an integer.".into())
    );
    assert_eq!(
        numeric_plan(&value(r#"{"max-request-bytes":"0"}"#)),
        Err("--max-request-bytes must be an integer greater than or equal to 1.".into())
    );
}
#[test]
fn oauth_required_fields_and_normalized_scope_lists_preserve_original_order() {
    assert_eq!(oauth_plan(&value("{}")).unwrap(), None);
    assert_eq!(
        oauth_plan(&value(r#"{"oauth-required-scope":["read"]}"#)),
        Err("--oauth-resource is required when configuring OAuth.".into())
    );
    assert_eq!(oauth_plan(&value(r#"{"oauth-resource":"resource"}"#)),Err("--oauth-authorization-server must be provided at least once when --oauth-resource is set.".into()));
    let data = value(
        r#"{"oauth-resource":"resource","oauth-authorization-server":["issuer"],"oauth-verifier-module":"module","oauth-supported-scope":[" read "],"oauth-required-scope":["\ufeffwrite\u00a0"],"oauth-verifier-export":""}"#,
    );
    let plan = oauth_plan(&data).unwrap().unwrap();
    assert_eq!(plan.get("scopesSupported"), Some(&value(r#"["read"]"#)));
    assert_eq!(plan.get("requiredScopes"), Some(&value(r#"["write"]"#)));
    assert_eq!(plan.get("verifierExport"), Some(&value(r#""default""#)));
}
#[test]
fn module_classification_preserves_file_and_platform_paths_without_url_guessing() {
    for (path, kind) in [
        ("file:///tmp/verifier.mjs", "file"),
        ("./verify.mjs", "path"),
        ("/tmp/verify.mjs", "path"),
        ("C:\\verify.mjs", "path"),
        ("z:/verify.mjs", "path"),
        ("C:relative", "bare"),
        ("pkg/export", "bare"),
        ("data:text/javascript,export default {}", "bare"),
    ] {
        assert_eq!(module_kind(&path.encode_utf16().collect::<Vec<_>>()), kind);
    }
}
#[test]
fn shutdown_settles_once_and_ignores_late_signal_and_completion_churn() {
    let mut state = Shutdown::default();
    assert_eq!(state.signal(), SignalAction::Start);
    assert_eq!(state.signal(), SignalAction::Force);
    assert!(state.settle());
    for _ in 0..4096 {
        assert_eq!(state.signal(), SignalAction::Ignore);
        assert!(!state.settle());
    }
    let mut early = Shutdown::default();
    assert!(early.settle());
    assert_eq!(early.signal(), SignalAction::Ignore);
}
