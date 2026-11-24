use lua_rust::{Runtime, Value};

#[test]
fn omitted_required_values_are_not_explicit_nil() {
    for call in [
        "assert()",
        "type()",
        "tostring()",
        "tonumber()",
        "select()",
        "next()",
        "pairs()",
        "ipairs()",
        "getmetatable()",
        "rawlen()",
        "rawget()",
        "rawget({})",
        "rawset()",
        "rawset({})",
        "rawset({},'a')",
        "rawequal()",
        "rawequal(nil)",
        "setmetatable()",
        "setmetatable({})",
        "(ipairs({}))()",
        "(ipairs({}))({})",
    ] {
        let error = Runtime::new(100_000)
            .run(format!("return {call}"), "base.lua")
            .unwrap_err();
        assert_eq!(error.message, "Value expected", "{call}");
        assert_eq!(error.location, None, "{call}");
    }
}

#[test]
fn missing_rawset_value_preserves_the_existing_entry() {
    let mut runtime = Runtime::new(100_000);
    runtime.run("t={a='KEEP'}", "base.lua").unwrap();
    let result = runtime.run("rawset(t,'a')", "base.lua");
    assert_eq!(
        runtime.raw_get(&runtime.global("t"), &Value::String("a".into())),
        Value::String("KEEP".into())
    );
    assert_eq!(result.unwrap_err().message, "Value expected");
    runtime.run("rawset(t,'a',nil)", "base.lua").unwrap();
    assert_eq!(
        runtime.raw_get(&runtime.global("t"), &Value::String("a".into())),
        Value::Nil
    );
}

#[test]
fn explicit_nil_and_extra_arguments_keep_their_meaning() {
    let source = "local t={a=1};local same=rawset(t,'a',nil,'ignored')==t;local m=setmetatable(t,nil);return type(nil),tostring(nil),tonumber(nil),rawget(t,nil),rawget(t,0/0),rawequal(nil,nil),getmetatable(nil),same,m==t,assert(true,nil,3)";
    assert_eq!(
        Runtime::new(100_000).run(source, "base.lua").unwrap(),
        vec![
            Value::String("nil".into()),
            Value::String("nil".into()),
            Value::Nil,
            Value::Nil,
            Value::Nil,
            Value::Bool(true),
            Value::Nil,
            Value::Bool(true),
            Value::Bool(true),
            Value::Bool(true),
            Value::Nil,
            Value::Integer(3)
        ]
    );
}

#[test]
fn raw_operations_validate_targets_and_keys_before_mutating() {
    for (source, message) in [
        ("return rawget(3,'a')", "Expected Lua table"),
        ("return rawget(nil,nil)", "Expected Lua table"),
        ("return rawset(false,'a',1)", "Expected Lua table"),
        ("return rawlen(false)", "Expected Lua table"),
        ("return rawset(t,nil,1)", "Table index is nil"),
        ("return rawset(t,0/0,1)", "Table index is NaN"),
        ("t[nil]=1", "Table index is nil"),
        ("t[0/0]=1", "Table index is NaN"),
    ] {
        let mut runtime = Runtime::new(100_000);
        runtime.run("t={a='KEEP'}", "base.lua").unwrap();
        let error = runtime.run(source, "base.lua").unwrap_err();
        assert_eq!(error.message, message, "{source}");
        assert_eq!(error.location, None, "{source}");
        assert_eq!(
            runtime.entries(&runtime.global("t")).unwrap(),
            vec![(Value::String("a".into()), Value::String("KEEP".into()))]
        );
    }
    let source = "local seen;local t=setmetatable({a=7},{__index=function() error('index') end,__newindex=function() error('newindex') end,__len=function() error('length') end});rawset(t,'b',8);return rawget(t,'missing'),rawget(t,'a'),rawget(t,'b'),rawlen(t),rawlen('aΩ')";
    assert_eq!(
        Runtime::new(100_000).run(source, "base.lua").unwrap(),
        vec![
            Value::Nil,
            Value::Integer(7),
            Value::Integer(8),
            Value::Integer(0),
            Value::Integer(3)
        ]
    );
}

#[test]
fn metatable_validation_preserves_the_original_and_error_order() {
    for (call, message) in [
        ("setmetatable(1,{})", "Expected Lua table"),
        ("setmetatable(t,7)", "Expected Lua table"),
        ("setmetatable(t,nil)", "Cannot change a protected metatable"),
        ("setmetatable(t,{})", "Cannot change a protected metatable"),
    ] {
        let mut runtime = Runtime::new(100_000);
        runtime
            .run("t=setmetatable({a=7},{__metatable=false})", "base.lua")
            .unwrap();
        let error = runtime
            .run(format!("return {call}"), "base.lua")
            .unwrap_err();
        assert_eq!(error.message, message, "{call}");
        assert_eq!(error.location, None, "{call}");
        assert_eq!(
            runtime
                .run("return getmetatable(t),t.a", "base.lua")
                .unwrap(),
            vec![Value::Bool(false), Value::Integer(7)]
        );
    }
}

#[test]
fn select_preserves_byte_prefix_counts_ranges_and_integer_validation() {
    for (source, expected) in [
        ("return select('#more',1,nil,3)", vec![Value::Integer(3)]),
        ("return select('#\\0',1,nil)", vec![Value::Integer(2)]),
        (
            "return select('2',1,nil,3)",
            vec![Value::Nil, Value::Integer(3)],
        ),
        (
            "return select(-2,1,nil,3)",
            vec![Value::Nil, Value::Integer(3)],
        ),
        ("return select(2147483647,1,2)", vec![]),
        ("return select(1)", vec![]),
    ] {
        assert_eq!(
            Runtime::new(100_000).run(source, "base.lua").unwrap(),
            expected,
            "{source}"
        );
    }
    for (source, message) in [
        (
            "return select(1.5,1,2)",
            "Number has no integer representation",
        ),
        (
            "return select(2147483648,1)",
            "Number has no integer representation",
        ),
        ("return select(nil,1)", "Expected Lua number"),
        ("return select('no',1)", "Expected Lua number"),
        ("return select(0,1)", "index out of range"),
        ("return select(-3,1,2)", "index out of range"),
    ] {
        let error = Runtime::new(100_000).run(source, "base.lua").unwrap_err();
        assert_eq!(error.message, message, "{source}");
        assert_eq!(error.location, None, "{source}");
    }
}

#[test]
fn ipairs_iterator_validates_indices_and_keeps_index_callbacks() {
    for (source, message) in [
        ("local f=ipairs({});return f({},nil)", "Expected Lua number"),
        (
            "local f=ipairs({});return f({},0.5)",
            "Number has no integer representation",
        ),
        (
            "local f=ipairs({});return f({},2147483648)",
            "Number has no integer representation",
        ),
        (
            "local f=ipairs({});return f(nil,0)",
            "Expected Lua table for indexing",
        ),
    ] {
        let error = Runtime::new(100_000).run(source, "base.lua").unwrap_err();
        assert_eq!(error.message, message, "{source}");
        assert_eq!(error.location, None, "{source}");
    }
    let source = "local seen;local t=setmetatable({},{__index=function(_,k) seen=k;return false end});local f=ipairs(t);local k,v=f(t,2147483647);return k,v,seen";
    assert_eq!(
        Runtime::new(100_000).run(source, "base.lua").unwrap(),
        vec![
            Value::Integer(i32::MIN),
            Value::Bool(false),
            Value::Integer(i32::MIN)
        ]
    );
}

#[test]
fn tostring_rejects_invalid_callback_results_with_the_reference_error() {
    let source = "return tostring(setmetatable({},{__tostring=function() return false end}))";
    let error = Runtime::new(100_000).run(source, "base.lua").unwrap_err();
    assert_eq!(error.message, "'__tostring' must return a string");
    assert_eq!(error.location, None);
}
