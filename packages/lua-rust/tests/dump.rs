use lua_rust::{Runtime, Value};

#[test]
fn dump_exports_lua53_bytecode_with_optional_debug_information() {
    let mut lua = Runtime::new(1_000_000);
    let values = lua.run("local f=function() return 42 end; return string.dump(f,true), string.dump(f,false), string.dump(f,0)", "/upper.lua").unwrap();
    let hex = "1b4c7561530019930d0a1a0a0404040408785600000000000000287740000000000000000000000000020300000001000000260000012600800001000000132a0000000000000000000000000000000000000000000000";
    let expected: Vec<u8> = hex
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect();
    assert_eq!(values[0], Value::String(expected));
    assert_eq!(values[0], values[2]);
    let Value::String(debug) = &values[1] else {
        panic!("missing dump")
    };
    assert_eq!(debug.len(), 109);
    assert!(debug.windows(10).any(|bytes| bytes == b"/upper.lua"));
}

#[test]
fn dump_retains_lexical_capture_descriptors() {
    let mut lua = Runtime::new(1_000_000);
    let values = lua
        .run(
            "local el; local x=2; local f=function(y) return x+y end; return string.dump(f,true)",
            "/upper.lua",
        )
        .unwrap();
    let hex = "1b4c7561530019930d0a1a0a04040404087856000000000000002877400100000000000000000001000204000000450000004d00800066000001260080000000000001000000010100000000000000000000000000000000";
    let expected: Vec<u8> = hex
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect();
    assert_eq!(values, vec![Value::String(expected)]);
}

#[test]
fn dump_distinguishes_native_functions_from_nonfunctions() {
    for (expression, expected) in [
        ("nil", "Expected Lua function"),
        ("string.len", "Unable to dump native function"),
    ] {
        let mut lua = Runtime::new(1_000_000);
        assert_eq!(
            lua.run(format!("return string.dump({expression})"), "/upper.lua")
                .unwrap_err()
                .to_string(),
            expected
        );
    }
}

#[test]
fn dump_debug_lines_follow_operator_positions() {
    let mut lua = Runtime::new(1_000_000);
    lua.run("pandoc={Str=function(s)return s end}", "probe")
        .unwrap();
    lua.run("function Str(el) local f=function(a)\n local x = a\n + 1\n return x\nend;return pandoc.Str((string.dump(f,false):gsub('.',function(c) return string.format('%02x',string.byte(c)) end))) end", "/upper.lua").unwrap();
    let values = lua.call(lua.global("Str"), vec![Value::Nil]).unwrap();
    assert_eq!(values,vec![Value::String("1b4c7561530019930d0a1a0a0404040408785600000000000000287740000b2f75707065722e6c75610000000000000000010003040000004d00400080008000a600000126008000010000001301000000000000000000000004000000030000000400000004000000020000000000000000000000".into())]);
}
