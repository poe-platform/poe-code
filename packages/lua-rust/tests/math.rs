use lua_rust::{Runtime, Value};

fn run(source: &str) -> Vec<Value> {
    Runtime::new(1_000_000).run(source, "math.lua").unwrap()
}

#[test]
fn unsigned_comparison_uses_32_bit_integer_values() {
    assert_eq!(
        run("return math.ult(-1,0),math.ult(0,-1),math.ult(1,1),math.ult('2','3')"),
        [false, true, false, true].map(Value::Bool)
    );
}

#[test]
fn seeded_sequence_matches_javascript_floating_multiplication() {
    assert_eq!(
        run(
            "math.randomseed(17); return tostring(math.random()),math.random(10),math.random(-10,10)"
        ),
        vec![
            Value::String(b"0.50513732433319".to_vec()),
            Value::Integer(3),
            Value::Integer(-10)
        ]
    );
    assert_eq!(
        run("math.randomseed(-17); return tostring(math.random()),math.random(-10,10)"),
        vec![
            Value::String(b"0.80517071485519".to_vec()),
            Value::Integer(4)
        ]
    );
}

#[test]
fn seeds_coerce_wrap_and_reset_the_runtime_sequence() {
    for seed in ["17.75", "4294967313", "'17'"] {
        assert_eq!(
            run(&format!(
                "math.randomseed({seed}); return tostring(math.random())"
            )),
            vec![Value::String(b"0.50513732433319".to_vec())]
        );
    }
    for seed in ["0", "0/0", "math.huge"] {
        assert_eq!(
            run(&format!(
                "math.randomseed({seed}); return tostring(math.random())"
            )),
            vec![Value::String(b"0.175741314888".to_vec())]
        );
    }
    assert_eq!(
        run(
            "math.randomseed(17); local a=math.random(); math.randomseed(17); return a==math.random(),select('#',math.randomseed(17))"
        ),
        vec![Value::Bool(true), Value::Integer(0)]
    );
}

#[test]
fn random_ranges_and_values_have_lua_numeric_types() {
    assert_eq!(
        run(
            "local a=math.random(); return a>=0 and a<1,math.type(a),math.random(1),math.random(-2147483648,-2147483648),math.type(math.random(0,2147483647))"
        ),
        vec![
            Value::Bool(true),
            Value::String(b"float".to_vec()),
            Value::Integer(1),
            Value::Integer(i32::MIN),
            Value::String(b"integer".to_vec())
        ]
    );
}

#[test]
fn random_state_survives_chunks_and_is_owned_by_each_runtime() {
    let mut a = Runtime::new(1_000_000);
    let mut b = Runtime::new(1_000_000);
    a.run("math.randomseed(17)", "first.lua").unwrap();
    b.run("math.randomseed(17)", "first.lua").unwrap();
    let first = a.run("return math.random()", "second.lua").unwrap();
    a.run("return math.random()", "third.lua").unwrap();
    assert_eq!(first, b.run("return math.random()", "second.lua").unwrap());
    b.run("return math.random()", "third.lua").unwrap();
    assert!(a.run("math.random(0)", "invalid.lua").is_err());
    b.run("return math.random()", "fourth.lua").unwrap();
    assert_eq!(
        a.run("return math.random()", "fifth.lua").unwrap(),
        b.run("return math.random()", "fifth.lua").unwrap()
    );
}

#[test]
fn invalid_math_arguments_match_streaming_diagnostics() {
    for (source, message) in [
        ("math.ult()", "Value expected"),
        ("math.ult(1.5,2)", "Number has no integer representation"),
        ("math.ult(1)", "Expected Lua number"),
        ("math.random(0)", "Interval is empty"),
        ("math.random(-2147483648,2147483647)", "Interval too large"),
        ("math.random(1,2,3)", "Wrong number of arguments"),
        ("math.randomseed()", "Value expected"),
        ("math.randomseed(nil)", "Expected Lua number"),
        ("math.random(nil)", "Expected Lua number"),
    ] {
        assert_eq!(
            Runtime::new(1_000_000)
                .run(source, "math.lua")
                .unwrap_err()
                .message,
            message,
            "{source}"
        );
    }
}
