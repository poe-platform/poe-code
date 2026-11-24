use lua_rust::{Runtime, Value};

#[test]
fn utf8_arguments_use_streaming_conversion_errors() {
    for (source, expected) in [
        ("return utf8.char(nil)", "Expected Lua number"),
        (
            "return utf8.char(65.5)",
            "Number has no integer representation",
        ),
        (
            "return utf8.char(2147483648)",
            "Number has no integer representation",
        ),
        (
            "return utf8.len(nil)",
            "Expected Lua string or number for concatenation",
        ),
        (
            "return utf8.len('abc',2147483648)",
            "Number has no integer representation",
        ),
        ("return utf8.offset('abc')", "Expected Lua number"),
    ] {
        let mut lua = Runtime::new(1_000_000);
        assert_eq!(
            lua.run(source, "filter.lua").unwrap_err().to_string(),
            expected,
            "{source}"
        );
    }
}

#[test]
fn utf8_range_and_decoding_errors_are_unlocated() {
    for (source, expected) in [
        ("return utf8.char(-1)", "Value out of range"),
        ("return utf8.len('abc',0)", "Initial position out of string"),
        ("return utf8.len('abc',1,4)", "Final position out of string"),
        (
            "return utf8.codepoint(string.char(255))",
            "Invalid UTF-8 code",
        ),
        ("return utf8.offset('abc',1,0)", "Position out of range"),
        (
            "return utf8.offset('é',1,2)",
            "Initial position is a continuation byte",
        ),
    ] {
        let mut lua = Runtime::new(1_000_000);
        assert_eq!(
            lua.run(source, "filter.lua").unwrap_err().to_string(),
            expected,
            "{source}"
        );
    }
}

#[test]
fn utf8_iterator_restarts_after_invalid_integer_positions() {
    for position in ["nil", "1.5", "2147483648"] {
        let mut lua = Runtime::new(1_000_000);
        assert_eq!(
            lua.run(
                format!("local f,s=utf8.codes('abc');return f(s,{position})"),
                "filter.lua"
            )
            .unwrap(),
            vec![Value::Integer(1), Value::Integer(97)],
            "{position}"
        );
    }
}
