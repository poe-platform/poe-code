use lua_rust::{Runtime, Value};

fn run(source: &str) -> Vec<Value> {
    Runtime::new(1_000_000).run(source, "packing.lua").unwrap()
}

#[test]
fn computes_sizes_and_alignment_without_allocating_field_data() {
    assert_eq!(
        run(
            "return string.packsize('bBhHlLjJTfdn'),string.packsize('!8 bXd c3'),string.packsize('!16 i16Xi16'),string.packsize('c2147483639')"
        ),
        [46, 11, 16, 2147483639].map(Value::Integer)
    );
}

#[test]
fn packs_integer_bytes_and_preserves_wide_sign_extension() {
    assert_eq!(
        run("return string.pack('<bBhHi4I4',-7,250,-1024,65000,-2147483648,-1)"),
        vec![Value::String(vec![
            249, 250, 0, 252, 232, 253, 0, 0, 0, 128, 255, 255, 255, 255
        ])]
    );
    assert_eq!(
        run("return string.pack('>i8I8',-1,-1)"),
        vec![Value::String(vec![255; 16])]
    );
    assert_eq!(
        run("return string.unpack('i8',string.pack('i8',-2147483648))"),
        vec![Value::Integer(i32::MIN), Value::Integer(9)]
    );
}

#[test]
fn round_trips_floats_and_absolute_alignment() {
    assert_eq!(
        run("return string.unpack('>i2I2fd',string.pack('>i2I2fd',-123,50000,1.25,-2.5))"),
        vec![
            Value::Integer(-123),
            Value::Integer(50000),
            Value::Number(1.25),
            Value::Number(-2.5),
            Value::Integer(17)
        ]
    );
    assert_eq!(
        run("return string.unpack('!8 bXd d',string.pack('!8 bXd d',7,2.5))"),
        vec![Value::Integer(7), Value::Number(2.5), Value::Integer(17)]
    );
    assert_eq!(
        run("return string.unpack('!4 I4','abcd'..string.pack('I4',123),2)"),
        vec![Value::Integer(123), Value::Integer(9)]
    );
}

#[test]
fn fixed_prefixed_and_zero_strings_preserve_bytes() {
    assert_eq!(
        run("return string.pack('c5s1z','ab','xyz','ok')"),
        vec![Value::String(b"ab\0\0\0\x03xyzok\0".to_vec())]
    );
    assert_eq!(
        run("return string.unpack('c5s1z',string.pack('c5s1z','ab','xyz','ok'))"),
        vec![
            Value::String(b"ab\0\0\0".to_vec()),
            Value::String(b"xyz".to_vec()),
            Value::String(b"ok".to_vec()),
            Value::Integer(13)
        ]
    );
    assert_eq!(
        run("return string.unpack('s2',string.pack('s2',string.char(255,0,128)))"),
        vec![Value::String(vec![255, 0, 128]), Value::Integer(6)]
    );
}

#[test]
fn unpack_preserves_relative_positions_and_existing_boundary_behavior() {
    assert_eq!(
        run("return string.unpack('b','abc',-1),string.unpack('','abc',4)"),
        vec![Value::Integer(99), Value::Integer(4)]
    );
    assert_eq!(
        run("return string.unpack('z','abc',2)"),
        vec![Value::String(b"b".to_vec()), Value::Integer(4)]
    );
    assert_eq!(
        run("return string.unpack('z','abc',4)"),
        vec![Value::String(vec![]), Value::Integer(2)]
    );
    assert_eq!(
        run("return string.unpack('s4',string.pack('i4',-1))"),
        vec![Value::String(vec![]), Value::Integer(4)]
    );
}

#[test]
fn numeric_strings_and_many_fields_use_existing_lua_values() {
    assert_eq!(
        run("return string.unpack('bds1',string.pack('bds1','7','1.25',42))"),
        vec![
            Value::Integer(7),
            Value::Number(1.25),
            Value::String(b"42".to_vec()),
            Value::Integer(13)
        ]
    );
    assert_eq!(
        run("return select('#',string.unpack(string.rep('B',300),string.rep('a',300)))"),
        vec![Value::Integer(301)]
    );
}

#[test]
fn malformed_formats_and_data_report_streaming_errors() {
    for (source, message) in [
        ("string.packsize('z')", "Variable-length format"),
        ("string.packsize('s')", "Variable-length format"),
        (
            "string.packsize('i0')",
            "Integral size out of limits [1,16]",
        ),
        (
            "string.packsize('i17')",
            "Integral size out of limits [1,16]",
        ),
        (
            "string.packsize('!3i3')",
            "Format alignment is not a power of two",
        ),
        ("string.packsize('Xc2')", "Invalid option after 'X'"),
        ("string.packsize('X')", "Invalid option after 'X'"),
        ("string.packsize('c')", "Missing size for format option 'c'"),
        ("string.packsize('q')", "Invalid binary format option"),
        (
            "string.packsize('c2147483647')",
            "Invalid binary format option",
        ),
        (
            "string.packsize('c2147483639c9')",
            "Format result too large",
        ),
        ("string.pack('b',128)", "Integer overflow"),
        ("string.pack('B',-1)", "Integer overflow"),
        ("string.pack('c2','abc')", "String longer than given size"),
        (
            "string.pack('s1',string.rep('a',256))",
            "String length does not fit in given size",
        ),
        (
            "string.pack('z','a'..string.char(0))",
            "String contains zeros",
        ),
        ("string.unpack('i4','a')", "Data string too short"),
        ("string.unpack('','a',0)", "Initial position out of string"),
        (
            "string.unpack('I8',string.pack('I8',-1))",
            "Integer does not fit into Lua integer",
        ),
        (
            "string.pack('b',1.5)",
            "Number has no integer representation",
        ),
        ("string.pack('b')", "Expected Lua number"),
        (
            "string.pack('z',false)",
            "Expected Lua string or number for concatenation",
        ),
    ] {
        assert_eq!(
            Runtime::new(1_000_000)
                .run(source, "packing.lua")
                .unwrap_err()
                .message,
            message,
            "{source}"
        );
    }
}
