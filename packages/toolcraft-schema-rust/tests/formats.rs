use mcp_protocol_rust::json::{self, Limits, Value};
use toolcraft_schema_rust::{CompiledSchema, FormatValidator, ValidationOptions};

struct Formats {
    calls: usize,
}
impl FormatValidator for Formats {
    fn check(&mut self, name: &[u16], value: &[u16]) -> Result<Option<bool>, String> {
        self.calls += 1;
        assert_eq!(name, &[0xd800]);
        Ok(Some(value != "invalid".encode_utf16().collect::<Vec<_>>()))
    }
}

#[test]
fn injected_formats_receive_lossless_names_and_only_string_instances() {
    let schema = json::parse(br#"{"format":"\ud800"}"#, Limits::default()).unwrap();
    let compiled = CompiledSchema::compile(schema, Default::default()).unwrap();
    let mut formats = Formats { calls: 0 };
    assert!(
        compiled
            .validate(
                &Value::Null,
                ValidationOptions {
                    formats: Some(&mut formats)
                }
            )
            .unwrap()
            .is_empty()
    );
    assert_eq!(formats.calls, 0);
    let issues = compiled
        .validate(
            &Value::String("invalid".encode_utf16().collect()),
            ValidationOptions {
                formats: Some(&mut formats),
            },
        )
        .unwrap();
    assert_eq!(formats.calls, 1);
    assert_eq!(issues[0].expected.last(), Some(&0xd800));
    assert_eq!(issues[0].keyword, issues[0].expected);
    assert!(
        compiled
            .validate(
                &Value::String("invalid".encode_utf16().collect()),
                Default::default()
            )
            .unwrap()
            .is_empty()
    );
}

struct Failing;
impl FormatValidator for Failing {
    fn check(&mut self, _: &[u16], _: &[u16]) -> Result<Option<bool>, String> {
        Err("injected failure".into())
    }
}

#[test]
fn callback_errors_propagate_without_retaining_evaluation_state() {
    let schema = json::parse(br#"{"format":"key"}"#, Limits::default()).unwrap();
    let compiled = CompiledSchema::compile(schema, Default::default()).unwrap();
    let value = Value::String("value".encode_utf16().collect());
    assert_eq!(
        compiled
            .validate(
                &value,
                ValidationOptions {
                    formats: Some(&mut Failing)
                }
            )
            .unwrap_err(),
        "injected failure"
    );
    assert!(
        compiled
            .validate(&value, Default::default())
            .unwrap()
            .is_empty()
    );
}
