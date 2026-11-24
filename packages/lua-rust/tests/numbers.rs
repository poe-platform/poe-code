use lua_rust::{Runtime, Value};

fn text(source: &str) -> String {
    let values = Runtime::new(100_000).run(source, "numbers.lua").unwrap();
    assert_eq!(values.len(), 1);
    values[0].text()
}

#[test]
fn integer_and_float_arithmetic_keep_their_types() {
    assert_eq!(
        text(
            "local a,b=2147483647,2; return table.concat({a+1,a*b,math.type(1.0),7//2,7//2.0,'2'+1,7^2},',')"
        ),
        "-2147483648,-2,float,3,3.0,3.0,49.0"
    );
    assert_eq!(
        text("local a=-1; return table.concat({a>>1,a<<31,a>>32,1<<-2147483648},',')"),
        "2147483647,-2147483648,0,0"
    );
}

#[test]
fn numeric_tokens_and_strings_share_lua_parsing() {
    assert_eq!(
        text(
            "return table.concat({0xffffffff,0x1.8p2,tonumber('2147483648'),tonumber(' -0X.8p+2 '),math.type(tonumber('1.0')),tostring(tonumber('inf'))},',')"
        ),
        "-1,6.0,2147483648.0,-2.0,float,nil"
    );
}

#[test]
fn numeric_rendering_matches_fourteen_digit_javascript_rounding() {
    assert_eq!(
        text(
            "return table.concat({1.0,1e20,1e21,1e-6,1e-7,10000000000000.5,-10000000000000.5,-0.0},',')"
        ),
        "1.0,100000000000000000000.0,1e+21,0.000001,1e-7,10000000000001.0,-10000000000001.0,0.0"
    );
}

#[test]
fn equal_integer_float_keys_update_the_same_entry() {
    assert_eq!(
        text(
            "local t={[1]='a',[1.0]='b'}; local k=next(t); return t[1]..':'..math.type(k)..':'..tostring(rawequal(1,1.0))"
        ),
        "b:integer:true"
    );
}

#[test]
fn loops_preserve_integer_and_float_control_values() {
    assert_eq!(
        text(
            "local r={} for i=1,2 do r[#r+1]=i..':'..math.type(i) end for i=1.0,2 do r[#r+1]=i..':'..math.type(i) end for i=3,1.2,-1 do r[#r+1]=i end return table.concat(r,',')"
        ),
        "1:integer,2:integer,1.0:float,2.0:float,3,2"
    );
}

#[test]
fn integer_operations_reject_fractional_and_out_of_range_operands() {
    for source in [
        "return 1&1.5",
        "return 1<<2147483648.0",
        "local a=1; return a//0",
        "local a=1; return a%0",
    ] {
        assert!(
            Runtime::new(100_000).run(source, "numbers.lua").is_err(),
            "{source}"
        );
    }
    assert_eq!(
        Runtime::new(100_000)
            .run("return math.tointeger(2147483648.0)", "numbers.lua")
            .unwrap(),
        vec![Value::Nil]
    );
}
