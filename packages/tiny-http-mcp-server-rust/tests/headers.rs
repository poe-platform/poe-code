use mcp_protocol_rust::json::{self, Limits, Value};
use tiny_http_mcp_server_rust::headers::validate_modern;
fn v(s: &str) -> Value {
    json::parse(s.as_bytes(), Limits::default()).unwrap()
}
#[test]
fn modern_name_mirror_decodes_utf8_and_notifications_only_require_version() {
    let headers = v(
        r#"{"mcp-protocol-version":"2026-07-28","mcp-method":"tools/call","mcp-name":"=?base64?5LiW55WM?="}"#,
    );
    let request = v(
        r#"{"id":1,"method":"tools/call","params":{"name":"世界","_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}"#,
    );
    assert_eq!(validate_modern(&headers, &request), None);
    let notification = v(
        r#"{"method":"notifications/initialized","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}"#,
    );
    assert_eq!(validate_modern(&headers, &notification), None);
    assert_eq!(validate_modern(&v("{}"), &request).unwrap().code, -32020);
    assert_eq!(
        validate_modern(&headers, &v(r#"{"method":"ping"}"#))
            .unwrap()
            .code,
        -32602
    );
}
