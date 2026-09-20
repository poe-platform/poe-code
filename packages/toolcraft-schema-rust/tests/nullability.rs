use mcp_protocol_rust::json::{self, Limits, Value};
use toolcraft_schema_rust::{CompiledSchema, nullability::normalize_legacy_nullability};

fn value(source: &str) -> Value {
    json::parse(source.as_bytes(), Limits::default()).unwrap()
}

#[test]
fn nullable_reference_targets_keep_validation_and_resource_identity() {
    let source = value(
        r##"{"$id":"https://example.test/root","type":"object","nullable":true,"properties":{"definition":{"type":"integer","nullable":true},"use":{"$ref":"#/properties/definition"}},"required":["use"]}"##,
    );
    let normalized = normalize_legacy_nullability(&source).unwrap();
    assert_eq!(normalized.get("$id"), source.get("$id"));
    let validator = CompiledSchema::compile(normalized, Default::default()).unwrap();
    for (data, expected) in [
        ("null", true),
        (r#"{"use":null}"#, true),
        (r#"{"use":7}"#, true),
        (r#"{"use":"wrong"}"#, false),
        ("{}", false),
    ] {
        assert_eq!(
            validator
                .validate(&value(data), Default::default())
                .unwrap()
                .is_empty(),
            expected
        );
    }
}

#[test]
fn non_schema_annotation_values_and_booleans_are_preserved() {
    let source = value(
        r#"{"nullable":false,"default":{"nullable":true},"properties":{"yes":true,"no":false},"contentSchema":{"nullable":true}}"#,
    );
    let result = normalize_legacy_nullability(&source).unwrap();
    assert!(result.get("nullable").is_none());
    for name in ["default", "properties", "contentSchema"] {
        assert_eq!(result.get(name), source.get(name));
    }
    assert_eq!(
        normalize_legacy_nullability(&Value::Bool(false)).unwrap(),
        Value::Bool(false)
    );
}

#[test]
fn normalization_bounds_recursive_schema_work_and_rejects_malformed_references() {
    let mut source = Value::Object(vec![]);
    for _ in 0..130 {
        source = Value::Object(vec![("items".encode_utf16().collect(), source)]);
    }
    assert_eq!(
        normalize_legacy_nullability(&source).unwrap_err(),
        "Schema resource limit exceeded"
    );
    for source in [
        r##"{"$id":"http://["}"##,
        r##"{"$ref":"#/properties/%FF"}"##,
    ] {
        assert!(normalize_legacy_nullability(&value(source)).is_err());
    }
}
