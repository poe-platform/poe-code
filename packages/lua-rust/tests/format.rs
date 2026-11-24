use lua_rust::{Runtime, Value};

fn run(source: &str) -> Value {
    Runtime::new(1_000_000)
        .run(source, "format.lua")
        .unwrap()
        .remove(0)
}

#[test]
fn formats_numeric_fields_and_calls_tostring_metamethods() {
    assert_eq!(
        run("return string.format('%s:%04d:%.2f','item',7,1.25)"),
        Value::String("item:0007:1.25".into())
    );
    assert_eq!(
        run(
            "return string.format('%s',setmetatable({}, {__tostring=function() return string.format('%04d',7) end}))"
        ),
        Value::String("0007".into())
    );
}

#[test]
fn floats_use_javascript_rounding_and_hex_literals() {
    assert_eq!(
        run("return string.format('%.0f|%.0e|%.1g|%a|%q',2.5,2.5,2.5,1.25,-0.0)"),
        Value::String("3|3e+0|3|0x1.4p+0|-0x0p+0".into())
    );
}

#[test]
fn formatted_strings_preserve_bytes_and_utf16_precision() {
    assert_eq!(
        run("return string.format('%s%c',string.char(255,0),321)"),
        Value::String(vec![255, 0, 65])
    );
    assert_eq!(
        run("return string.format('%.2s','é😀')"),
        Value::String(vec![195, 169, 237, 160, 189])
    );
    assert_eq!(
        run("return string.format('%q',string.char(0)..'7')"),
        Value::String(b"\"\\0007\"".to_vec())
    );
}

#[test]
fn invalid_format_fields_and_missing_arguments_fail() {
    for (source, message) in [
        (
            "return string.format('%100d',1)",
            "Format width or precision too long",
        ),
        ("return string.format('%d')", "No value for format"),
        ("return string.format('%.0g',1)", "Invalid numeric format"),
        (
            "return string.format('%5a',1)",
            "Modifiers for hexadecimal float format not implemented",
        ),
        (
            "return string.format('%2s',string.char(0))",
            "String contains zeros",
        ),
        (
            "return string.format('%.1s','a'..string.char(255))",
            "Invalid UTF-8 string",
        ),
    ] {
        assert_eq!(
            Runtime::new(1_000_000)
                .run(source, "format.lua")
                .unwrap_err()
                .message,
            message,
            "{source}"
        );
    }
}
