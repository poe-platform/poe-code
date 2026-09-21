use mcp_protocol_rust::json::{self, Value};
use terminal_pilot_rust::command;
fn value(s: &str) -> Value {
    json::parse_utf16(&s.encode_utf16().collect::<Vec<_>>(), Default::default()).unwrap()
}
#[test]
fn command_surface_and_admission_precede_effect_plans() {
    assert_eq!(command::definitions().len(), 13);
    assert_eq!(command::tools().len(), 26);
    assert!(
        command::prepare("press-key", &value(r#"{"key":"NotAKey"}"#))
            .unwrap_err()
            .message
            .contains("key")
    );
    assert!(command::prepare("wait-for", &value(r#"{"pattern":" "}"#)).is_err());
    assert!(command::prepare("wait-for", &value(r#"{"pattern":"x","timeout":-1}"#)).is_err());
    let plan = command::prepare(
        "wait-for",
        &value(r#"{"pattern":"x","literal":true,"scope":"screen","timeout":0}"#),
    )
    .unwrap();
    assert_eq!(plan.get("route"), Some(&value(r#""session""#)));
    assert_eq!(plan.get("regexp"), Some(&Value::Bool(false)));
    assert_eq!(
        plan.get("args").unwrap(),
        &value(r#"["x",{"timeout":0,"scope":"screen"}]"#)
    );
}
#[test]
fn rust_shapes_validates_and_cases_effect_results() {
    let created =
        command::finish("create-session", &value(r#"{"name":"s1","pid":12}"#), false).unwrap();
    assert_eq!(created, value(r#"{"session":"s1","pid":12}"#));
    assert_eq!(
        command::finish("wait-for-exit", &value(r#"{"result":7}"#), true).unwrap(),
        value(r#"{"exit_code":7}"#)
    );
    assert!(
        command::finish("create-session", &value(r#"{"name":"s1","pid":-1}"#), false)
            .unwrap_err()
            .message
            .contains("pid")
    );
    assert_eq!(
        command::finish(
            "read-history",
            &value(r#"{"result":["ready"],"exitCode":null}"#),
            false
        )
        .unwrap(),
        value(r#"{"lines":["ready"],"exitCode":null}"#)
    );
}
