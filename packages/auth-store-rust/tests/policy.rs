use auth_store_rust::{
    KeychainPlan, Operation, parse_document, resolve_backend, validate_defaults,
};
use mcp_protocol_rust::json::Value;
fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn keychain_plans_validate_identity_and_secret_and_strip_only_one_line_break() {
    let plan = KeychainPlan::new(&text(" service "), &text("\u{feff}account ")).unwrap();
    assert!(plan.command(Operation::Set, Some(&text("bad\n"))).is_err());
    assert_eq!(
        plan.command(Operation::Get, None).unwrap()[2],
        text("service")
    );
    let result = Value::Object(vec![
        (text("exitCode"), Value::Number(0.0)),
        (text("stdout"), Value::String(text("s\r\n\r\n"))),
    ]);
    assert_eq!(
        plan.complete(Operation::Get, &result).unwrap(),
        Value::String(text("s\r\n"))
    );
    assert!(KeychainPlan::new(&text(" "), &text("a")).is_err());
}
#[test]
fn encrypted_documents_require_own_version_one_string_fields_and_defaults_cannot_escape() {
    assert!(parse_document(&text("{}")).is_none());
    assert!(
        parse_document(&text(
            r#"{"version":1,"iv":"a","authTag":"b","ciphertext":""}"#
        ))
        .is_some()
    );
    assert!(validate_defaults(&text("a/../b"), false, &text("c")).is_err());
    assert!(validate_defaults(&text("a"), false, &text("b/c")).is_err());
    assert!(validate_defaults(&text("a"), false, &text("b")).is_ok());
    assert_eq!(
        resolve_backend(Some(&text(" file ")), &text("linux")).unwrap(),
        "file"
    );
    assert!(resolve_backend(Some(&text("keychain")), &text("linux")).is_err());
}
#[test]
fn credential_path_plans_preserve_platform_ancestor_exception_and_default_scope() {
    use auth_store_rust::protected_paths;
    assert_eq!(
        protected_paths(&text("/home/user/.app/credentials"), 1, 47, None, true),
        [
            text("/home/user"),
            text("/home/user/.app"),
            text("/home/user/.app/credentials")
        ]
    );
    assert_eq!(
        protected_paths(
            &text("/home/user/.app/a/b"),
            1,
            47,
            Some(&text("/home/user/.app")),
            true
        ),
        [
            text("/home/user/.app"),
            text("/home/user/.app/a"),
            text("/home/user/.app/a/b")
        ]
    );
    assert_eq!(
        protected_paths(
            &text("/outside/file"),
            1,
            47,
            Some(&text("/home/user")),
            false
        ),
        [text("/outside"), text("/outside/file")]
    );
    assert_eq!(
        protected_paths(&text("C:\\home\\user\\file"), 3, 92, None, true),
        [text("C:\\home\\user"), text("C:\\home\\user\\file")]
    );
}
#[test]
fn migration_policy_and_rollback_keep_null_and_empty_credentials_distinct() {
    use auth_store_rust::{migration_write_needed, rollback_plan};
    assert!(migration_write_needed(None, &[], Some(&[])));
    assert!(!migration_write_needed(
        Some(&[]),
        &text("old"),
        Some(&text("old"))
    ));
    let Value::Array(steps) = rollback_plan(None, Some(&[]), true) else {
        panic!("array expected")
    };
    assert_eq!(steps[0].get("action"), Some(&Value::String(text("delete"))));
    assert_eq!(steps[1].get("action"), Some(&Value::String(text("set"))));
    assert_eq!(steps[1].get("value"), Some(&Value::String(vec![])));
}

#[test]
fn backend_selection_is_independent_of_host_platform() {
    use auth_store_rust::select_backend;
    assert_eq!(select_backend(None), Ok("file"));
    assert_eq!(
        select_backend(Some(
            &" \u{feff}keychain ".encode_utf16().collect::<Vec<_>>()
        )),
        Ok("keychain")
    );
    assert!(select_backend(Some(&"KEYCHAIN".encode_utf16().collect::<Vec<_>>())).is_err());
}
