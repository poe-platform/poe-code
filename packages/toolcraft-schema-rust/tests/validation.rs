use mcp_protocol_rust::json::{self, Limits, Value};
use toolcraft_schema_rust::CompiledSchema;

fn value(source: &str) -> Value {
    json::parse(source.as_bytes(), Limits::default()).unwrap()
}

fn valid(schema: &str, data: &str) -> bool {
    CompiledSchema::compile(value(schema), Default::default())
        .unwrap()
        .validate(&value(data))
        .unwrap()
        .is_empty()
}

#[test]
fn boolean_and_type_schemas_use_json_schema_semantics() {
    for data in ["null", "true", "1", "1.5", "\"x\"", "[]", "{}"] {
        assert!(valid("true", data));
        assert!(!valid("false", data));
    }
    assert!(valid(r#"{"type":["integer","null"]}"#, "1.0"));
    assert!(valid(r#"{"type":["integer","null"]}"#, "null"));
    assert!(!valid(r#"{"type":["integer","null"]}"#, "1.1"));
    assert!(!valid(r#"{"type":"object"}"#, "[]"));
}

#[test]
fn enum_and_const_compare_objects_by_keys_and_arrays_by_order() {
    assert!(valid(r#"{"const":{"a":1,"b":2}}"#, r#"{"b":2,"a":1}"#));
    assert!(!valid(r#"{"const":[1,2]}"#, "[2,1]"));
    assert!(valid(r#"{"enum":[null,{"x":1}]}"#, r#"{"x":1}"#));
    assert!(!valid(r#"{"enum":[]}"#, "null"));
}

#[test]
fn scalar_limits_count_unicode_scalars_and_tolerate_decimal_multiple_rounding() {
    assert!(valid(
        r#"{"type":"string","minLength":2,"maxLength":2}"#,
        r#""🦀\ud800""#
    ));
    assert!(!valid(r#"{"maxLength":1}"#, r#""🦀🦀""#));
    assert!(valid(r#"{"multipleOf":0.1}"#, "0.3"));
    assert!(!valid(r#"{"minimum":2,"exclusiveMaximum":4}"#, "4"));
    assert!(!valid(r#"{"multipleOf":2}"#, "3"));
}

#[test]
fn object_properties_requirements_dependencies_and_additional_properties_compose() {
    let schema = r#"{"type":"object","properties":{"name":{"type":"string"},"age":{"type":"integer","minimum":0}},"required":["name"],"additionalProperties":false,"dependentRequired":{"age":["name"]}}"#;
    assert!(valid(schema, r#"{"name":"A","age":2}"#));
    for data in [
        r#"{"age":2}"#,
        r#"{"name":1}"#,
        r#"{"name":"A","extra":true}"#,
    ] {
        assert!(!valid(schema, data));
    }
}

#[test]
fn array_tuples_contains_and_uniqueness_follow_the_selected_draft() {
    let modern = r#"{"prefixItems":[{"type":"integer"}],"items":{"type":"string"},"contains":{"const":"yes"},"minContains":1,"maxContains":1,"uniqueItems":true}"#;
    assert!(valid(modern, r#"[1,"yes"]"#));
    assert!(!valid(modern, r#"[1,"yes","yes"]"#));
    let legacy = r#"{"$schema":"http://json-schema.org/draft-07/schema#","items":[{"type":"integer"}],"additionalItems":false}"#;
    assert!(valid(legacy, "[1]"));
    assert!(!valid(legacy, "[1,2]"));
}

#[test]
fn applicators_conditionals_and_unevaluated_members_preserve_branch_annotations() {
    let schema = r#"{"anyOf":[{"properties":{"a":true},"required":["a"]},{"properties":{"b":true},"required":["b"]}],"unevaluatedProperties":false}"#;
    assert!(valid(schema, r#"{"a":1,"b":2}"#));
    assert!(!valid(schema, r#"{"a":1,"c":3}"#));
    assert!(valid(
        r#"{"if":{"type":"integer"},"then":{"minimum":2},"else":{"type":"string"}}"#,
        "\"x\""
    ));
    assert!(!valid(
        r#"{"oneOf":[{"type":"integer"},{"type":"number"}]}"#,
        "1"
    ));
    assert!(valid(r#"{"not":{"type":"string"}}"#, "1"));
}

#[test]
fn local_references_preserve_pointer_escaping_recursion_and_draft_siblings() {
    let schema = r##"{"$defs":{"a/b~c":{"type":"integer"}},"$ref":"#/$defs/a~1b~0c","minimum":2}"##;
    assert!(valid(schema, "2"));
    assert!(!valid(schema, "1"));
    let recursive =
        r##"{"type":"object","properties":{"next":{"$ref":"#"},"value":{"type":"integer"}}}"##;
    assert!(valid(recursive, r#"{"next":{"value":1}}"#));
    assert!(!valid(recursive, r#"{"next":{"value":"bad"}}"#));
    assert!(valid(
        r##"{"$schema":"http://json-schema.org/draft-07/schema#","definitions":{"n":{"type":"integer"}},"$ref":"#/definitions/n","minimum":2}"##,
        "1"
    ));
    assert!(valid(r##"{"$ref":"#"}"##, "1"));
}

#[test]
fn invalid_schema_shapes_and_unresolved_references_fail_before_validation() {
    for schema in [
        "null",
        "[]",
        r#"{"type":"invalid"}"#,
        r#"{"type":["string","string"]}"#,
        r#"{"minLength":-1}"#,
        r#"{"multipleOf":0}"#,
        r#"{"required":["x","x"]}"#,
        r#"{"properties":{"x":1}}"#,
        r#"{"anyOf":[]}"#,
        r##"{"$ref":"#/missing"}"##,
    ] {
        assert!(
            CompiledSchema::compile(value(schema), Default::default()).is_err(),
            "{schema}"
        );
    }
}

#[test]
fn diagnostic_paths_retain_surrogates_and_required_values_are_undefined() {
    let compiled = CompiledSchema::compile(
        value(r#"{"properties":{"\ud800":{"type":"string"}},"required":["missing"]}"#),
        Default::default(),
    )
    .unwrap();
    let issues = compiled.validate(&value(r#"{"\ud800":1}"#)).unwrap();
    assert_eq!(issues.len(), 2);
    assert_eq!(issues[0].path, vec![vec![0xd800]]);
    assert_eq!(issues[0].keyword, "type");
    assert_eq!(issues[1].received, "undefined");
}
