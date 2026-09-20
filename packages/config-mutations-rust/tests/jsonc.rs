use config_mutations_rust::jsonc::{self, PathSegment};
use mcp_protocol_rust::json::Value;
fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn string(text: &str) -> Value {
    Value::String(units(text))
}

#[test]
fn comments_and_trailing_commas_do_not_change_strings_or_proto_keys() {
    let source = units(
        "{ // line\r\n \"__proto__\": {\"x\":1,}, /* block */ \"text\":\"https://x/*a*/ // b\",\"arr\":[true,null,],}",
    );
    let value = jsonc::parse_object(&source).unwrap();
    assert_eq!(value.get("text"), Some(&string("https://x/*a*/ // b")));
    assert_eq!(
        value.get("__proto__").unwrap().get("x"),
        Some(&Value::Number(1.0))
    );
    assert_eq!(
        value.get("arr"),
        Some(&Value::Array(vec![Value::Bool(true), Value::Null]))
    );
    for source in ["", " \u{feff}\u{a0}", "null"] {
        assert_eq!(
            jsonc::parse_object(&units(source)).unwrap(),
            Value::Object(vec![])
        );
    }
}
#[test]
fn parser_preserves_utf16_duplicate_keys_and_numeric_overflow() {
    let mut source = units("{\"key\":\"");
    source.push(0xd800);
    source.extend(units("\",\"x\":1,\"x\":2,\"big\":1e400}"));
    let value = jsonc::parse_object(&source).unwrap();
    assert_eq!(value.get("key"), Some(&Value::String(vec![0xd800])));
    assert_eq!(value.get("x"), Some(&Value::Number(2.0)));
    assert_eq!(value.get("big"), Some(&Value::Number(f64::INFINITY)));
    for source in ["[]", "true", "1", "\"text\""] {
        assert_eq!(
            jsonc::parse_object(&units(source)).unwrap_err().to_string(),
            "Expected JSON object."
        );
    }
}
#[test]
fn lexical_and_grammar_failures_have_stable_diagnostics_and_utf16_positions() {
    for (source, error) in [
        ("{", "CloseBraceExpected"),
        ("{\"a\" 1}", "ColonExpected"),
        ("{\"a\":}", "ValueExpected"),
        ("{\"a\":1 \"b\":2}", "CommaExpected"),
        ("{\"a\":\"\\q\"}", "InvalidEscapeCharacter"),
        ("/* unclosed", "UnexpectedEndOfComment"),
        ("{\"a\":1e}", "UnexpectedEndOfNumber"),
    ] {
        let actual = jsonc::parse_object(&units(source)).unwrap_err();
        assert_eq!(
            actual.to_string(),
            format!("JSON parse error: {error}"),
            "{source}"
        );
    }
    assert!(jsonc::parse_object(&units("{\"a\":\"unterminated}")).is_err());
}
#[test]
fn edits_replace_insert_delete_and_append_without_destroying_other_comments() {
    let original = units(
        "{\n  // retained\n  \"keep\": 1,\n  \"nested\": {\"old\": true},\n  \"list\": [1, 2]\n}",
    );
    let next = jsonc::modify(
        &original,
        &[
            PathSegment::Key(units("nested")),
            PathSegment::Key(units("new")),
        ],
        Some(string("value")),
    )
    .unwrap();
    assert!(String::from_utf16(&next).unwrap().contains("// retained"));
    assert_eq!(
        jsonc::parse_object(&next)
            .unwrap()
            .get("nested")
            .unwrap()
            .get("new"),
        Some(&string("value"))
    );
    let next = jsonc::modify(
        &next,
        &[PathSegment::Key(units("list")), PathSegment::Index(-1)],
        Some(Value::Number(3.0)),
    )
    .unwrap();
    assert_eq!(
        jsonc::parse_object(&next).unwrap().get("list"),
        Some(&Value::Array(vec![
            Value::Number(1.0),
            Value::Number(2.0),
            Value::Number(3.0)
        ]))
    );
    let next = jsonc::modify(
        &next,
        &[
            PathSegment::Key(units("nested")),
            PathSegment::Key(units("old")),
        ],
        None,
    )
    .unwrap();
    assert!(
        jsonc::parse_object(&next)
            .unwrap()
            .get("nested")
            .unwrap()
            .get("old")
            .is_none()
    );
    assert_eq!(next.last(), Some(&10));
}
#[test]
fn missing_paths_build_containers_and_missing_removals_preserve_source() {
    let source = units("{}\n");
    let result = jsonc::modify(
        &source,
        &[PathSegment::Key(units("a")), PathSegment::Key(units("b"))],
        Some(Value::Bool(true)),
    )
    .unwrap();
    assert_eq!(
        jsonc::parse_object(&result)
            .unwrap()
            .get("a")
            .unwrap()
            .get("b"),
        Some(&Value::Bool(true))
    );
    assert_eq!(
        jsonc::modify(&source, &[PathSegment::Key(units("missing"))], None).unwrap(),
        source
    );
    assert!(jsonc::modify(&units(""), &[], None).is_err());
    assert!(
        jsonc::modify(
            &units("{\"a\":1}"),
            &[PathSegment::Key(units("a")), PathSegment::Key(units("b"))],
            Some(Value::Bool(true))
        )
        .is_err()
    );
}
#[test]
fn indentation_and_pretty_json_match_ecmascript_strings_and_numbers() {
    assert_eq!(
        jsonc::detect_indent(&units("{\r\n\t\"a\":1\r\n}")),
        units("\t")
    );
    assert_eq!(jsonc::detect_indent(&units("{}")), units("  "));
    let object = Value::Object(vec![(
        units("a"),
        Value::Array(vec![
            Value::Number(-0.0),
            Value::Number(f64::INFINITY),
            Value::String(vec![0xd800]),
        ]),
    )]);
    assert_eq!(
        jsonc::serialize(&object),
        units("{\n  \"a\": [\n    0,\n    null,\n    \"\\ud800\"\n  ]\n}\n")
    );
}

#[test]
fn numeric_property_names_follow_javascript_enumeration_order() {
    let value = jsonc::parse_object(&units(
        "{\"20\":1,\"name\":2,\"2\":3,\"02\":4,\"4294967295\":5,\"0\":6}",
    ))
    .unwrap();
    let Value::Object(properties) = value else {
        panic!()
    };
    assert_eq!(
        properties
            .iter()
            .map(|(key, _)| String::from_utf16(key).unwrap())
            .collect::<Vec<_>>(),
        ["0", "2", "20", "name", "02", "4294967295"]
    );
    let manual = Value::Object(vec![
        (units("20"), Value::Number(1.0)),
        (units("2"), Value::Number(3.0)),
    ]);
    assert_eq!(
        jsonc::serialize(&manual),
        units("{\n  \"2\": 3,\n  \"20\": 1\n}\n")
    );
}

#[test]
fn last_array_item_removal_does_not_join_neighboring_numbers() {
    for source in [
        "{\"list\":[1,2,3]}",
        "{\"list\":[1,2,123,]}",
        "{\"list\":[1,2,{\"nested\":true} /* kept */]}",
    ] {
        let updated = jsonc::modify(
            &units(source),
            &[PathSegment::Key(units("list")), PathSegment::Index(2)],
            None,
        )
        .unwrap();
        assert_eq!(
            jsonc::parse_object(&updated).unwrap().get("list"),
            Some(&Value::Array(vec![Value::Number(1.0), Value::Number(2.0)]))
        );
    }
}
