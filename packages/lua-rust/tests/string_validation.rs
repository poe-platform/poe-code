use lua_rust::{Runtime, Value};

#[test]
fn simple_string_helpers_validate_values_with_streaming_errors() {
    for expression in [
        "string.upper(nil)",
        "string.lower({})",
        "string.len()",
        "string.reverse(false)",
    ] {
        let error = Runtime::new(100_000)
            .run(format!("return {expression}"), "/upper.lua")
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "Expected Lua string or number for concatenation",
            "{expression}"
        );
    }
}

#[test]
fn character_values_validate_integer_conversion_before_byte_range() {
    for (expression, expected) in [
        ("string.char(65.5)", "Number has no integer representation"),
        (
            "string.char(4294967296)",
            "Number has no integer representation",
        ),
        ("string.char(-1)", "Value out of range"),
        ("string.char(false)", "Expected Lua number"),
    ] {
        let error = Runtime::new(100_000)
            .run(format!("return {expression}"), "/upper.lua")
            .unwrap_err();
        assert_eq!(error.to_string(), expected, "{expression}");
    }
}

#[test]
fn pattern_searches_validate_text_patterns_and_signed_integer_positions() {
    for (expression, expected) in [
        (
            "string.find('abc','a',4294967297)",
            "Number has no integer representation",
        ),
        (
            "string.match('abc','a',4294967297)",
            "Number has no integer representation",
        ),
        (
            "string.find('abc','a',1.5)",
            "Number has no integer representation",
        ),
        ("string.find('abc','a',false)", "Expected Lua number"),
        (
            "string.find('abc',nil)",
            "Expected Lua string or number for concatenation",
        ),
        (
            "string.find(nil,'a')",
            "Expected Lua string or number for concatenation",
        ),
    ] {
        let error = Runtime::new(100_000)
            .run(format!("return {expression}"), "/upper.lua")
            .unwrap_err();
        assert_eq!(error.to_string(), expected, "{expression}");
    }
}

#[test]
fn string_helpers_preserve_numeric_coercion_and_empty_characters() {
    assert_eq!(
        Runtime::new(100_000)
            .run(
                "return string.char(), string.reverse(123), string.lower(1.5), string.len(1.0)",
                "test"
            )
            .unwrap(),
        vec![
            Value::String(vec![]),
            Value::String(b"321".to_vec()),
            Value::String(b"1.5".to_vec()),
            Value::Integer(3)
        ]
    );
}

#[test]
fn shared_lua_string_helpers_preserve_unlocated_conversion_errors() {
    for (expression, expected) in [
        (
            "string.gmatch(nil,'a')",
            "Expected Lua string or number for concatenation",
        ),
        (
            "string.gmatch('a',nil)",
            "Expected Lua string or number for concatenation",
        ),
        (
            "string.gsub(nil,'a','b')",
            "Expected Lua string or number for concatenation",
        ),
        (
            "string.gsub('a',nil,'b')",
            "Expected Lua string or number for concatenation",
        ),
        (
            "string.gsub('a','a','b',1.5)",
            "Number has no integer representation",
        ),
        (
            "string.format(nil)",
            "Expected Lua string or number for concatenation",
        ),
    ] {
        let error = Runtime::new(100_000)
            .run(format!("return {expression}"), "/upper.lua")
            .unwrap_err();
        assert_eq!(error.to_string(), expected, "{expression}");
    }
}
