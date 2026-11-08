use mcp_protocol_rust::json::{self, Limits, Value};
use toolcraft_schema_rust::{CompileOptions, CompiledSchema};

fn value(source: &str) -> Value {
    json::parse(source.as_bytes(), Limits::default()).unwrap()
}

fn valid(schema: &str, data: &str, registry: &[(&str, &str)]) -> bool {
    CompiledSchema::compile(
        value(schema),
        CompileOptions {
            registry: registry
                .iter()
                .map(|(uri, schema)| ((*uri).into(), value(schema)))
                .collect(),
        },
    )
    .unwrap()
    .validate(&value(data), Default::default())
    .unwrap()
    .is_empty()
}

#[test]
fn nested_resources_resolve_relative_ids_anchors_and_original_parent_pointers() {
    let schema = r##"{"$id":"https://example.test/a/root.json","$defs":{"nested":{"$id":"../nested.json","$defs":{"n":{"$anchor":"number","type":"integer"}}}},"$ref":"../nested.json#number"}"##;
    assert!(valid(schema, "1", &[]));
    assert!(!valid(schema, "\"bad\"", &[]));
    assert!(valid(
        r##"{"$id":"urn:example:root","$defs":{"inner":{"$id":"urn:example:inner","type":"integer"}},"$ref":"#/$defs/inner"}"##,
        "1",
        &[]
    ));
    assert!(!valid(
        r##"{"$defs":{"percent%name":{"type":"integer"}},"$ref":"#/$defs/percent%25name"}"##,
        "\"bad\"",
        &[]
    ));
}

#[test]
fn registered_retrieval_aliases_preserve_declared_base_for_nested_references() {
    let registry = [
        (
            "https://retrieve.test/one.json",
            r##"{"$id":"https://declared.test/root.json","$defs":{"item":{"$ref":"item.json"}}}"##,
        ),
        ("https://declared.test/item.json", r#"{"type":"integer"}"#),
    ];
    let schema = r##"{"$ref":"https://retrieve.test/one.json#/$defs/item"}"##;
    assert!(valid(schema, "1", &registry));
    assert!(!valid(schema, "\"bad\"", &registry));
}

#[test]
fn parent_pointers_reach_descendants_across_multiple_resource_boundaries() {
    let schema = r##"{"$id":"https://test.test/root","$defs":{"one":{"$id":"one","$defs":{"two":{"$id":"two","$defs":{"leaf":{"type":"integer"}}}}}},"$ref":"#/$defs/one/$defs/two/$defs/leaf"}"##;
    assert!(valid(schema, "1", &[]));
    assert!(!valid(schema, "\"bad\"", &[]));
}

#[test]
fn dynamic_references_use_first_matching_dynamic_anchor_and_scope_does_not_leak() {
    let schema = r##"{"$id":"https://test.test/root","$ref":"list","$defs":{"kind":{"$dynamicAnchor":"items","type":"string"},"list":{"$id":"list","type":"array","items":{"$dynamicRef":"#items"},"$defs":{"default":{"$dynamicAnchor":"items"}}}}}"##;
    assert!(valid(schema, r#"["one"]"#, &[]));
    assert!(!valid(schema, "[1]", &[]));
    let static_anchor = schema.replace(
        "\"$dynamicAnchor\":\"items\",\"type\":\"string\"",
        "\"$anchor\":\"items\",\"type\":\"string\"",
    );
    assert!(valid(&static_anchor, "[1]", &[]));
}

#[test]
fn registry_references_are_checked_only_in_reachable_documents() {
    assert!(valid(
        "true",
        "1",
        &[("https://test.test/unused", r##"{"$ref":"missing"}"##)]
    ));
    assert!(
        CompiledSchema::compile(
            value(r##"{"$ref":"https://test.test/unused"}"##),
            CompileOptions {
                registry: vec![(
                    "https://test.test/unused".into(),
                    value(r##"{"$ref":"missing"}"##)
                )],
            }
        )
        .is_err()
    );
}

#[test]
fn custom_metaschema_vocabulary_controls_child_validation_keywords() {
    let schema = r#"{"$schema":"https://test.test/meta","properties":{"bad":false,"number":{"minimum":10}}}"#;
    let registry = [(
        "https://test.test/meta",
        r#"{"$vocabulary":{"https://json-schema.org/draft/2020-12/vocab/core":true}}"#,
    )];
    assert!(valid(schema, r#"{"number":1}"#, &registry));
    assert!(!valid(schema, r#"{"bad":1}"#, &registry));
}
