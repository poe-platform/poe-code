use lua_rust::{Runtime, Value};

#[test]
fn optional_math_arguments_accept_explicit_nil() {
    assert_eq!(
        Runtime::new(100_000)
            .run(
                "return tostring(math.log(1,nil)),tostring(math.atan(0,nil))",
                "math.lua"
            )
            .unwrap(),
        vec![
            Value::String(b"0.0".to_vec()),
            Value::String(b"0.0".to_vec())
        ]
    );
}

#[test]
fn missing_math_arguments_fail_before_type_specific_defaults() {
    for name in ["type", "tointeger", "abs", "min", "max", "modf"] {
        let error = Runtime::new(100_000)
            .run(format!("return math.{name}()"), "math.lua")
            .unwrap_err();
        assert_eq!(error.to_string(), "Value expected", "{name}");
    }
}

#[test]
fn math_numeric_errors_keep_streaming_messages_without_source_locations() {
    for (expression, expected) in [
        ("math.sqrt(nil)", "Expected Lua number"),
        ("math.modf(false)", "Expected Lua number"),
        ("math.fmod(1,0)", "Zero divisor"),
        ("math.fmod(1,nil)", "Expected Lua number"),
        ("math.ceil(false)", "Expected Lua number"),
        ("math.log(1,false)", "Expected Lua number"),
        ("math.atan(0,false)", "Expected Lua number"),
    ] {
        let error = Runtime::new(100_000)
            .run(format!("return {expression}"), "math.lua")
            .unwrap_err();
        assert_eq!(error.to_string(), expected, "{expression}");
    }
}

#[test]
fn explicit_nil_and_numeric_strings_keep_existing_math_results() {
    assert_eq!(Runtime::new(100_000).run("return math.type(nil),math.tointeger(nil),math.min(nil),math.type(math.abs('1')),math.type(math.floor('1'))", "math.lua").unwrap(),vec![Value::Nil,Value::Nil,Value::Nil,Value::String(b"float".to_vec()),Value::String(b"integer".to_vec())]);
}
