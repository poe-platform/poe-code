use mcp_protocol_rust::json::{self, ErrorKind, Limits, Value};

fn units(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}

#[test]
fn raw_unpaired_surrogates_are_preserved_only_in_strings() {
    for unit in [0xd800, 0xdbff, 0xdc00, 0xdfff] {
        assert_eq!(
            json::parse_utf16(&[34, unit, 34], Limits::default()).unwrap(),
            Value::String(vec![unit])
        );
        assert!(json::parse_utf16(&[unit], Limits::default()).is_err());
    }
}

#[test]
fn normalizing_a_surrogate_does_not_make_an_invalid_escape_valid() {
    for input in [vec![34, 92, 0xd800, 34], vec![34, 92, 0xdc00, 34]] {
        assert!(json::parse_utf16(&input, Limits::default()).is_err());
    }
    assert_eq!(
        json::parse_utf16(&[34, 92, 92, 0xd800, 34], Limits::default()).unwrap(),
        Value::String(vec![92, 0xd800])
    );
}

#[test]
fn escaped_quotes_do_not_change_string_state() {
    assert_eq!(
        json::parse_utf16(&[34, 92, 34, 0xd800, 34], Limits::default()).unwrap(),
        Value::String(vec![34, 0xd800])
    );
    assert!(json::parse_utf16(&[34, 34, 0xd800], Limits::default()).is_err());
}

#[test]
fn raw_and_escaped_surrogate_property_keys_share_identity() {
    let mut input = units("{\"");
    input.push(0xd800);
    input.extend(units("\":1,\"\\ud800\":2}"));
    assert_eq!(
        json::parse_utf16(&input, Limits::default()).unwrap(),
        Value::Object(vec![(vec![0xd800], Value::Number(2.0))])
    );
}

#[test]
fn byte_limit_counts_utf8_without_normalization_expansion() {
    for (input, bytes) in [
        (vec![34, 0xd800, 34], 5),
        (units("\"🦀\""), 6),
        (units("\"é\""), 4),
    ] {
        assert!(
            json::parse_utf16(
                &input,
                Limits {
                    max_bytes: bytes,
                    ..Limits::default()
                }
            )
            .is_ok()
        );
        assert_eq!(
            json::parse_utf16(
                &input,
                Limits {
                    max_bytes: bytes - 1,
                    ..Limits::default()
                }
            )
            .unwrap_err()
            .kind,
            ErrorKind::ByteLimit
        );
    }
}

#[test]
fn utf16_input_uses_the_same_grammar_and_resource_limits() {
    for input in ["null", "123.5", "[{}, true, null]", "{\"a\":\"🦀\\ud800\"}"] {
        assert_eq!(
            json::parse_utf16(&units(input), Limits::default()).unwrap(),
            json::parse(input.as_bytes(), Limits::default()).unwrap()
        );
    }
    for input in ["[1,]", "\"\\x\"", "00", "true false", "{\"x\":}"] {
        assert!(json::parse_utf16(&units(input), Limits::default()).is_err());
    }
    assert_eq!(
        json::parse_utf16(
            &units("[[]]"),
            Limits {
                max_depth: 1,
                ..Limits::default()
            }
        )
        .unwrap_err()
        .kind,
        ErrorKind::DepthLimit
    );
    assert_eq!(
        json::parse_utf16(
            &units("[1]"),
            Limits {
                max_nodes: 1,
                ..Limits::default()
            }
        )
        .unwrap_err()
        .kind,
        ErrorKind::NodeLimit
    );
}
