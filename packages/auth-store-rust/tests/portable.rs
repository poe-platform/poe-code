use auth_store_rust::portable::{document_field, key_field, normalize_path, path_ancestors};
use mcp_protocol_rust::json::Value;

fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}

#[test]
fn portable_paths_normalize_without_losing_utf16_and_include_every_ancestor() {
    assert_eq!(
        normalize_path(&text("//a/./b/../secret/")).unwrap(),
        text("/a/secret")
    );
    assert_eq!(
        normalize_path(&[47, 0xd800, 47, 120]).unwrap(),
        [47, 0xd800, 47, 120]
    );
    assert!(normalize_path(&text("/a/../")).is_err());
    assert!(normalize_path(&text("/a\0b")).is_err());
    assert_eq!(
        path_ancestors(&text("/a/b/secret")),
        [text("/a"), text("/a/b"), text("/a/b/secret")]
    );
}

#[test]
fn portable_key_and_document_fields_reject_wrong_kinds_and_values() {
    for (index, value) in [
        Value::String(text("secret")),
        Value::String(text("AES-GCM")),
        Value::Number(256.0),
        Value::Bool(true),
        Value::Bool(true),
    ]
    .iter()
    .enumerate()
    {
        assert!(key_field(index, value));
        assert!(!key_field(index, &Value::Null));
    }
    assert!(document_field(0, &Value::Number(1.0)));
    assert!(!document_field(0, &Value::String(text("1"))));
    for index in 1..4 {
        assert!(document_field(index, &Value::String(vec![])));
        assert!(!document_field(index, &Value::Number(1.0)));
    }
}
