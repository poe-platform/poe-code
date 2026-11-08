use mcp_protocol_rust::json::{self, Value};
use terminal_pilot_mcp_rust::{cli, result, tools};
fn v(source: &str) -> Value {
    json::parse_utf16(
        &source.encode_utf16().collect::<Vec<_>>(),
        Default::default(),
    )
    .unwrap()
}
#[test]
fn tool_aliases_and_result_validation_share_declarations() {
    let tools = tools();
    assert_eq!(tools.len(), 26);
    assert_eq!(
        tools[0].get("name"),
        v(r#"{"name":"create_session"}"#).get("name")
    );
    assert_eq!(
        result("terminal_wait_for_exit", &v(r#"{"exitCode":7}"#)).unwrap(),
        v(r#"{"exit_code":7}"#)
    );
    assert_eq!(result("fill", &v("{}")).unwrap(), v("{}"));
    assert_eq!(
        result("create_session", &v(r#"{"session":"s1","pid":-1}"#))
            .unwrap_err()
            .code,
        -32603
    );
    assert_eq!(result("unknown", &v("{}")).unwrap_err().code, -32602);
    assert!(result("read_screen",&v(r#"{"lines":[],"cursor":{"row":0,"col":0},"size":{"cols":0,"rows":1},"exitCode":null}"#)).is_err());
}
#[test]
fn cli_help_and_invalid_arguments_are_portable() {
    assert_eq!(cli(&[]), Ok(false));
    assert_eq!(cli(&["-hh".into()]), Ok(true));
    for argument in ["--http", "--help=yes", "-x", "serve"] {
        assert!(cli(&[argument.into()]).is_err());
    }
    assert!(cli(&["--help".into(), "unexpected".into()]).is_err());
}
#[test]
fn shutdown_admission_is_permanent_and_idempotent() {
    let mut admission = terminal_pilot_mcp_rust::ShutdownAdmission::default();
    assert!(admission.admit().is_ok());
    admission.shutdown();
    assert!(admission.admit().is_err());
    admission.shutdown();
    assert!(admission.admit().is_err());
}
