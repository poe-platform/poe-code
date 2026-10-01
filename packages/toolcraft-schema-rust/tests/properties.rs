use mcp_protocol_rust::json::{self, Limits, Value};
use toolcraft_schema_rust::{CompiledSchema, FormatValidator, ValidationOptions};

#[test]
fn property_hints_keep_complete_annotations_and_native_candidate_roots() {
    let schema = json::parse(
        br##"{
      "$defs":{"ID":{"type":"integer","minimum":1}},
      "allOf":[
        {"properties":{"id":{"$ref":"#/$defs/ID"}},"required":["id"]},
        {"properties":{"nested":{"type":"array","items":{"type":"string"}}}}
      ]
    }"##,
        Limits::default(),
    )
    .unwrap();
    let compiled = CompiledSchema::compile(schema, Default::default()).unwrap();
    let properties = compiled.properties().unwrap();
    assert_eq!(properties.len(), 2);
    assert_eq!(properties[0].name, "id".encode_utf16().collect::<Vec<_>>());
    assert!(properties[0].required);
    assert_eq!(properties[0].schemas.len(), 2);
    assert!(!properties[1].required);
    assert_eq!(
        properties[1].schemas[0].get("items").unwrap().get("type"),
        Some(&Value::String("string".encode_utf16().collect()))
    );
    assert!(
        compiled
            .validate_candidates(
                &properties[0].sources,
                &Value::Number(2.0),
                Default::default()
            )
            .unwrap()
            .is_empty()
    );
    let issues = compiled
        .validate_candidates(
            &properties[0].sources,
            &Value::Number(0.0),
            Default::default(),
        )
        .unwrap();
    assert!(issues[0].path.is_empty());
    assert_eq!(
        issues[0].keyword,
        "minimum".encode_utf16().collect::<Vec<_>>()
    );
    for sources in [&[][..], &[usize::MAX][..]] {
        assert_eq!(
            compiled
                .validate_candidates(sources, &Value::Null, Default::default())
                .unwrap_err(),
            "Invalid property projection source"
        );
    }
}

struct Formats(Vec<Vec<u16>>);
impl FormatValidator for Formats {
    fn check(&mut self, name: &[u16], _: &[u16]) -> Result<Option<bool>, String> {
        self.0.push(name.to_vec());
        Ok(Some(name == "first".encode_utf16().collect::<Vec<_>>()))
    }
}

#[test]
fn candidate_acceptance_does_not_skip_later_format_callbacks() {
    let schema = json::parse(
        br#"{"anyOf":[
      {"properties":{"value":{"format":"first"}}},
      {"properties":{"value":{"format":"second"}}}
    ]}"#,
        Limits::default(),
    )
    .unwrap();
    let compiled = CompiledSchema::compile(schema, Default::default()).unwrap();
    let property = compiled.properties().unwrap().remove(0);
    let mut formats = Formats(Vec::new());
    let issues = compiled
        .validate_candidates(
            &property.sources,
            &Value::String(vec![120]),
            ValidationOptions {
                formats: Some(&mut formats),
            },
        )
        .unwrap();
    assert!(issues.is_empty());
    assert_eq!(
        formats.0,
        ["first", "second"].map(|value| value.encode_utf16().collect::<Vec<_>>())
    );
}
