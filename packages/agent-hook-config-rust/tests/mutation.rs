use agent_hook_config_rust::{
    GeneratedEntry, Handler,
    files::{is_fully_generated, mutate_file, read_settings},
};
use mcp_protocol_rust::json::{self, Limits, Value};
fn u(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
fn parse(value: &str) -> Value {
    json::parse(value.as_bytes(), Limits::default()).unwrap()
}
fn entry(matcher: Option<&str>) -> GeneratedEntry {
    GeneratedEntry {
        event: u("Stop"),
        matcher: matcher.map(u),
        generated_id: u("generated-current-0"),
        handler: Handler {
            kind: u("command"),
            command: Some(u("new")),
            args: None,
            timeout: None,
            status_message: Some(u("[generated:poe-code:current] new")),
        },
    }
}
#[test]
fn file_mutation_preserves_unknown_fields_user_order_and_empty_groups() {
    let file = parse(
        r#"{"extra":{"preserve":true},"hooks":{"Empty":[],"Stop":[{"custom":42,"hooks":[{"type":"command","command":"first"},{"type":"command","statusMessage":"[generated:poe-code:old] stale"},{"type":"command","command":"last"}]},{"matcher":"","hooks":[]},{"matcher":"stale","hooks":[{"statusMessage":"[generated:poe-code:old]"}]}]}}"#,
    );
    let result = mutate_file(
        file.clone(),
        &[entry(None), entry(Some(""))],
        &u("current"),
        false,
        &u("/hooks.json"),
    )
    .unwrap();
    assert_eq!(result.removed, 2);
    assert_eq!(result.written, 2);
    assert_eq!(result.file.get("extra"), file.get("extra"));
    let hooks = result.file.get("hooks").unwrap();
    assert_eq!(hooks.get("Empty"), Some(&Value::Array(vec![])));
    let Value::Array(groups) = hooks.get("Stop").unwrap() else {
        panic!()
    };
    assert_eq!(groups.len(), 2);
    assert_eq!(groups[0].get("custom"), Some(&Value::Number(42.0)));
    let Value::Array(handlers) = groups[0].get("hooks").unwrap() else {
        panic!()
    };
    assert_eq!(handlers.len(), 3);
    assert_eq!(handlers[0].get("command"), Some(&Value::String(u("first"))));
    assert_eq!(handlers[1].get("command"), Some(&Value::String(u("last"))));
    assert_eq!(handlers[2].get("command"), Some(&Value::String(u("new"))));
    assert_eq!(
        file.get("hooks").unwrap().get("Stop").unwrap(),
        &parse(
            r#"[{"custom":42,"hooks":[{"type":"command","command":"first"},{"type":"command","statusMessage":"[generated:poe-code:old] stale"},{"type":"command","command":"last"}]},{"matcher":"","hooks":[]},{"matcher":"stale","hooks":[{"statusMessage":"[generated:poe-code:old]"}]}]"#
        )
    );
}
#[test]
fn mutation_validates_existing_groups_before_generated_marker_and_timeout() {
    let mut incoming = entry(None);
    incoming.handler.status_message = None;
    let error = mutate_file(
        parse(r#"{"hooks":{"Stop":[null]}}"#),
        &[incoming.clone()],
        &u("current"),
        false,
        &u("/hooks.json"),
    )
    .unwrap_err();
    assert_eq!(error, u("Malformed hooks in /hooks.json"));
    let error = mutate_file(
        parse("{}"),
        &[incoming.clone()],
        &u("current"),
        false,
        &u("/hooks.json"),
    )
    .unwrap_err();
    assert!(String::from_utf16_lossy(&error).contains("must start with"));
    incoming.handler.status_message = Some(u("[generated:poe-code:current] new"));
    incoming.handler.timeout = Some(f64::INFINITY);
    assert_eq!(
        mutate_file(
            parse("{}"),
            &[incoming],
            &u("current"),
            false,
            &u("/hooks.json")
        )
        .unwrap_err(),
        u("Generated hook entry \"generated-current-0\" must have a finite timeout")
    );
}
#[test]
fn reading_and_generated_file_admission_preserve_handlers_and_require_generated_ownership() {
    let value = parse(
        r#"{"hooks":{"Stop":[{"hooks":[{"type":"http","url":"https://test","extra":true}]}]}}"#,
    );
    let entries = read_settings(&value, &u("/settings.json")).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].event, u("Stop"));
    assert_eq!(entries[0].matcher, None);
    assert_eq!(entries[0].handler.get("extra"), Some(&Value::Bool(true)));
    assert!(!is_fully_generated(&value));
    assert!(!is_fully_generated(&parse(r#"{"hooks":{"Stop":[]}}"#)));
    assert!(is_fully_generated(&parse(
        r#"{"hooks":{"Stop":[{"hooks":[{"statusMessage":"[generated:poe-code:round] new"}]}]}}"#
    )));
    assert!(!is_fully_generated(&parse(
        r#"{"metadata":true,"hooks":{"Stop":[{"hooks":[{"statusMessage":"[generated:poe-code:round] new"}]}]}}"#
    )));
}
