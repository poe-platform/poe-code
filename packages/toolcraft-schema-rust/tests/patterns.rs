use mcp_protocol_rust::json::{self, Limits, Value};
use toolcraft_schema_rust::CompiledSchema;

fn compiled(source: &str) -> CompiledSchema {
    CompiledSchema::compile(
        json::parse(source.as_bytes(), Limits::default()).unwrap(),
        Default::default(),
    )
    .unwrap()
}

#[test]
fn string_patterns_match_unicode_scalars_and_unanchored_substrings() {
    for (schema, accepted, rejected) in [
        (r#"{"pattern":"^a*$"}"#, "aaa", "abc"),
        (r#"{"pattern":"a+"}"#, "xxaayy", "xxbb"),
        (r#"{"pattern":"^\\p{Letter}+$"}"#, "π漢", "123"),
        (r#"{"pattern":"^.$"}"#, "🦀", "🦀🦀"),
        (r#"{"pattern":"^(?:ab|c){2,3}$"}"#, "abc", "ab"),
        (r#"{"pattern":"^(?=a)[^0-9]+$"}"#, "abc", "a1"),
    ] {
        let validator = compiled(schema);
        assert!(
            validator
                .validate(&Value::String(accepted.encode_utf16().collect()))
                .unwrap()
                .is_empty()
        );
        assert!(
            !validator
                .validate(&Value::String(rejected.encode_utf16().collect()))
                .unwrap()
                .is_empty()
        );
        assert!(validator.validate(&Value::Null).unwrap().is_empty());
    }
}

#[test]
fn every_matching_property_pattern_applies_and_excludes_additional_properties() {
    let validator = compiled(
        r#"{"patternProperties":{"a*":{"type":"integer"},"aaa*":{"maximum":20}},"additionalProperties":false}"#,
    );
    for (value, valid) in [
        (r#"{"a":21}"#, true),
        (r#"{"aaaa":18}"#, true),
        (r#"{"aaaa":31}"#, false),
        (r#"{"a":"bad"}"#, false),
    ] {
        let value = json::parse(value.as_bytes(), Limits::default()).unwrap();
        assert_eq!(validator.validate(&value).unwrap().is_empty(), valid);
    }
}

#[test]
fn malformed_patterns_fail_compilation_before_validation() {
    for pattern in ["[", "(", "a{3,2}", "\\q", "[z-a]", "a**", "(?unknown)"] {
        let schema = Value::Object(vec![(
            "pattern".encode_utf16().collect(),
            Value::String(pattern.encode_utf16().collect()),
        )]);
        assert!(
            CompiledSchema::compile(schema, Default::default()).is_err(),
            "{pattern}"
        );
    }
}

#[test]
fn pathological_patterns_fail_with_a_bounded_evaluation_error() {
    let validator = compiled(r#"{"pattern":"(a+)+b"}"#);
    let value = Value::String(vec![u16::from(b'a'); 2_000]);
    let error = validator.validate(&value).unwrap_err();
    assert!(error.starts_with("Pattern evaluation "), "{error}");
}
