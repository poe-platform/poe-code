use mcp_protocol_rust::json::{self, ErrorKind, Limits, Value};

fn parse(input: &str) -> Value {
    json::parse(input.as_bytes(), Limits::default()).unwrap()
}

fn text(input: &str) -> Value {
    Value::String(input.encode_utf16().collect())
}

#[test]
fn parses_scalars_and_json_whitespace() {
    for (input, expected) in [
        ("null", Value::Null),
        (" \ttrue\r\n", Value::Bool(true)),
        ("false", Value::Bool(false)),
        ("42", Value::Number(42.0)),
        ("-12.5e+2", Value::Number(-1250.0)),
        ("\"hello\"", text("hello")),
    ] {
        assert_eq!(parse(input), expected, "{input}");
    }
}

#[test]
fn preserves_nested_values_and_object_order() {
    assert_eq!(
        parse(r#"{"z":[null,true,{"a":"value"}],"a":0}"#),
        Value::Object(vec![
            (
                "z".encode_utf16().collect(),
                Value::Array(vec![
                    Value::Null,
                    Value::Bool(true),
                    Value::Object(vec![("a".encode_utf16().collect(), text("value"))]),
                ])
            ),
            ("a".encode_utf16().collect(), Value::Number(0.0)),
        ])
    );
}

#[test]
fn duplicate_keys_replace_values_without_changing_insertion_order() {
    assert_eq!(
        parse(r#"{"first":1,"second":2,"first":3,"__proto__":4}"#),
        Value::Object(vec![
            ("first".encode_utf16().collect(), Value::Number(3.0)),
            ("second".encode_utf16().collect(), Value::Number(2.0)),
            ("__proto__".encode_utf16().collect(), Value::Number(4.0)),
        ])
    );
}

#[test]
fn parses_raw_unicode_and_all_string_escapes() {
    assert_eq!(parse(r#""汉字 🎉 é""#), text("汉字 🎉 é"));
    assert_eq!(
        parse(r#""\"\\\/\b\f\n\r\t\u0041""#),
        text("\"\\/\u{8}\u{c}\n\r\tA")
    );
}

#[test]
fn preserves_paired_and_unpaired_utf16_surrogates() {
    assert_eq!(parse(r#""\uD83D\uDE00""#), text("😀"));
    assert_eq!(
        parse(r#""\uD800x\uDC00""#),
        Value::String(vec![0xd800, 0x78, 0xdc00])
    );
    assert_eq!(
        json::stringify(&Value::String(vec![0xd800, 0x78, 0xdc00])),
        r#""\ud800x\udc00""#
    );
}

#[test]
fn rejects_malformed_json_instead_of_accepting_extensions() {
    for input in [
        "",
        " ",
        "undefined",
        "NaN",
        "Infinity",
        "tru",
        "NULL",
        "[1,]",
        "[,1]",
        "{\"a\":1,}",
        "{'a':1}",
        "{a:1}",
        "{\"a\" 1}",
        "[1 2]",
        "true false",
        "\"unterminated",
        "\"raw\nnewline\"",
        "\"\\x41\"",
        "\"\\u12\"",
        "\"\\uZZZZ\"",
        "01",
        "-01",
        "+1",
        ".1",
        "1.",
        "1e",
        "1e+",
        "--1",
        "1_000",
        "/*x*/0",
        "\u{a0}null",
        "\u{feff}null",
    ] {
        assert!(
            json::parse(input.as_bytes(), Limits::default()).is_err(),
            "{input:?}"
        );
    }
}

#[test]
fn rejects_invalid_utf8_with_the_byte_offset() {
    let error = json::parse(&[b'"', 0xff, b'"'], Limits::default()).unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidUtf8);
    assert_eq!(error.offset, 1);
}

#[test]
fn enforces_byte_limits_at_the_exact_utf8_boundary() {
    let input = "\"🎉\"";
    let mut limits = Limits {
        max_bytes: input.len(),
        ..Limits::default()
    };
    assert_eq!(json::parse(input.as_bytes(), limits).unwrap(), text("🎉"));
    limits.max_bytes -= 1;
    assert_eq!(
        json::parse(input.as_bytes(), limits).unwrap_err().kind,
        ErrorKind::ByteLimit
    );
}

#[test]
fn bounds_container_depth_but_accepts_scalars_at_the_boundary() {
    let limits = Limits {
        max_depth: 2,
        ..Limits::default()
    };
    assert!(json::parse(b"[[0]]", limits).is_ok());
    assert_eq!(
        json::parse(b"[[[]]]", limits).unwrap_err().kind,
        ErrorKind::DepthLimit
    );
    assert_eq!(
        json::parse(b"{\"a\":{\"b\":{}}}", limits).unwrap_err().kind,
        ErrorKind::DepthLimit
    );
}

#[test]
fn bounds_value_count_independently_of_byte_count() {
    let limits = Limits {
        max_nodes: 3,
        ..Limits::default()
    };
    assert!(json::parse(b"[1,2]", limits).is_ok());
    assert_eq!(
        json::parse(b"[1,2,3]", limits).unwrap_err().kind,
        ErrorKind::NodeLimit
    );
}

#[test]
fn defaults_disable_all_budgets() {
    let limits = Limits::default();
    assert_eq!(limits.max_bytes, usize::MAX);
    assert_eq!(limits.max_depth, usize::MAX);
    assert_eq!(limits.max_nodes, usize::MAX);
    let source = format!("\"{}\"", "x".repeat(16 * 1024 * 1024));
    assert!(json::parse(source.as_bytes(), limits).is_ok());
    let source = format!("[{}]", vec!["0"; 262_145].join(","));
    assert!(json::parse(source.as_bytes(), limits).is_ok());
}

#[test]
fn accepts_depth_above_the_previous_ceiling_for_both_encodings() {
    let input = format!("{}0{}", "[".repeat(1000), "]".repeat(1000));
    for limits in [
        Limits::default(),
        Limits {
            max_depth: 1000,
            ..Limits::default()
        },
    ] {
        let value = json::parse(input.as_bytes(), limits).unwrap();
        assert_eq!(json::stringify(&value), input);
        let value = json::parse_utf16(&input.encode_utf16().collect::<Vec<_>>(), limits).unwrap();
        assert_eq!(json::stringify(&value), input);
    }
}

#[test]
fn rejects_deep_untrusted_input_when_a_limit_is_explicit() {
    let input = format!("{}0{}", "[".repeat(10_000), "]".repeat(10_000));
    let limits = Limits {
        max_depth: 128,
        ..Limits::default()
    };
    let error = json::parse(input.as_bytes(), limits).unwrap_err();
    assert_eq!(error.kind, ErrorKind::DepthLimit);
    assert_eq!(error.offset, limits.max_depth);
}

#[test]
fn escaped_and_raw_keys_have_the_same_identity() {
    assert_eq!(
        parse(r#"{"\u0061":1,"a":2,"\ud83d\ude00":3,"😀":4}"#),
        Value::Object(vec![
            ("a".encode_utf16().collect(), Value::Number(2.0)),
            ("😀".encode_utf16().collect(), Value::Number(4.0)),
        ])
    );
}

#[test]
fn every_control_character_round_trips_without_raw_json_controls() {
    let value = Value::String((0..32).collect());
    let encoded = json::stringify(&value);
    assert!(!encoded.as_bytes().iter().any(|byte| *byte < 32));
    assert_eq!(parse(&encoded), value);
}

#[test]
fn preserves_negative_zero_and_javascript_numeric_overflow() {
    let Value::Number(value) = parse("-0") else {
        panic!("expected a number")
    };
    assert!(value.is_sign_negative());
    assert_eq!(parse("1e400"), Value::Number(f64::INFINITY));
    assert_eq!(json::stringify(&Value::Number(-0.0)), "0");
    assert_eq!(json::stringify(&Value::Number(f64::INFINITY)), "null");
}

#[test]
fn serializes_controls_and_round_trips_nested_unicode() {
    for input in [
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}"#,
        r#"["\u0000\n\t\r\b\f",true,null,-125.75,1e-7,1e21]"#,
        r#"{"汉字":"😀","surrogate":"\ud800","array":[[],{}]}"#,
    ] {
        let value = parse(input);
        assert_eq!(parse(&json::stringify(&value)), value);
    }
    assert_eq!(json::stringify(&text("\u{0}\n\t")), r#""\u0000\n\t""#);
}

#[test]
fn iterative_parser_preserves_deep_objects_and_duplicate_keys() {
    let nested = format!("{}null{}", "{\"child\":[".repeat(300), "]}".repeat(300));
    let input = format!(
        "{{\"first\":{},\"second\":true,\"first\":{}}}",
        nested, nested
    );
    let value = json::parse(input.as_bytes(), Limits::default()).unwrap();
    assert_eq!(
        json::stringify(&value),
        format!("{{\"first\":{},\"second\":true}}", nested)
    );
    let limits = Limits {
        max_depth: 600,
        ..Limits::default()
    };
    assert_eq!(
        json::parse(input.as_bytes(), limits).unwrap_err().kind,
        ErrorKind::DepthLimit
    );
    let malformed = format!("{}0{}", "[".repeat(1000), "]".repeat(999));
    assert!(json::parse(malformed.as_bytes(), Limits::default()).is_err());
}
