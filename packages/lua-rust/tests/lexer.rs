use lua_rust::{Runtime, Value};

#[test]
fn unicode_escapes_preserve_utf8_and_surrogate_bytes() {
    for (source, bytes) in [
        (r"return '\u{41}'", vec![65]),
        (r"return '\u{0}'", vec![0]),
        (r"return '\u{7ff}'", vec![0xdf, 0xbf]),
        (r"return '\u{800}'", vec![0xe0, 0xa0, 0x80]),
        (r"return '\u{d800}'", vec![0xed, 0xa0, 0x80]),
        (r"return '\u{1f600}'", vec![0xf0, 0x9f, 0x98, 0x80]),
        (r"return '\u{10ffff}'", vec![0xf4, 0x8f, 0xbf, 0xbf]),
    ] {
        let mut lua = Runtime::new(1_000_000);
        assert_eq!(
            lua.run(source, "filter.lua").unwrap(),
            vec![Value::String(bytes)],
            "{source}"
        );
    }
}

#[test]
fn invalid_string_escapes_follow_reference_errors() {
    for (source, error) in [
        (r"return '\u{110000}'", "UTF-8 value too large"),
        (r"return '\u41'", "missing '{'"),
        (r"return '\u{41'", "missing '}'"),
        (r"return '\u{}'", "hexadecimal digit expected"),
        (r"return '\u{gg}'", "hexadecimal digit expected"),
        (r"return '\q'", "invalid escape sequence"),
        ("return 'a\rb'", "unfinished string"),
    ] {
        let mut lua = Runtime::new(1_000_000);
        assert_eq!(
            lua.run(source, "filter.lua").unwrap_err().to_string(),
            error,
            "{source}"
        );
    }
}

#[test]
fn long_strings_and_escaped_newlines_normalize_line_endings() {
    for ending in ["\n", "\r", "\r\n", "\n\r"] {
        for source in [
            format!("return [[{ending}a{ending}b]]"),
            format!("return 'a\\{ending}b'"),
        ] {
            let mut lua = Runtime::new(1_000_000);
            assert_eq!(
                lua.run(source, "filter.lua").unwrap(),
                vec![Value::String(b"a\nb".to_vec())]
            );
        }
    }
}

#[test]
fn comments_and_space_escape_accept_carriage_returns_and_vertical_tabs() {
    let mut lua = Runtime::new(1_000_000);
    assert_eq!(
        lua.run("--comment\rreturn 'a\\z\x0bb'", "filter.lua")
            .unwrap(),
        vec![Value::String(b"ab".to_vec())]
    );
}

#[test]
fn carriage_returns_count_as_single_source_lines() {
    for ending in ["\n", "\r", "\r\n", "\n\r"] {
        let mut lua = Runtime::new(1_000_000);
        let error = lua
            .run(
                format!("local x=1{ending}x=x+1{ending}error('oops')"),
                "filter.lua",
            )
            .unwrap_err();
        assert_eq!(error.to_string(), "[string \"filter.lua\"]:3: oops");
    }
}

#[test]
fn numerals_include_adjacent_dots_before_validation() {
    let mut lua = Runtime::new(1_000_000);
    assert_eq!(
        lua.run("return 1..2", "filter.lua")
            .unwrap_err()
            .to_string(),
        "malformed number"
    );
}
