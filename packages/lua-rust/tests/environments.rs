use lua_rust::{Runtime, Value};

fn run(source: &str) -> Vec<Value> {
    Runtime::new(1_000_000)
        .run(source, "environment.lua")
        .unwrap()
}

#[test]
fn chunks_expose_their_lexical_global_environment() {
    assert_eq!(run("return _ENV==_G"), vec![Value::Bool(true)]);
    assert_eq!(run("local _ENV={x=7}; return x"), vec![Value::Integer(7)]);
    assert_eq!(
        run("local t={}; do local _ENV=t; x=9 end; return t.x"),
        vec![Value::Integer(9)]
    );
}

#[test]
fn closures_capture_environment_bindings_at_their_definition() {
    assert_eq!(
        run(
            "local original=_ENV; local f=function() return x end; local _ENV={x=12}; local g=function() return x end; original.x=4; return f(),g()"
        ),
        vec![Value::Integer(4), Value::Integer(12)]
    );
    assert_eq!(
        run("local function f(_ENV) return x end; return f({x=9})"),
        vec![Value::Integer(9)]
    );
}

#[test]
fn global_reads_and_writes_use_environment_metatables() {
    assert_eq!(
        run(
            "local env={}; setmetatable(env,{__index=function(t,k) return k=='x' and 42 end}); local _ENV=env; return x"
        ),
        vec![Value::Integer(42)]
    );
    assert_eq!(
        run(
            "setmetatable(_G,{__index=function(t,k) return k=='missing' and 42 end}); return missing"
        ),
        vec![Value::Integer(42)]
    );
    assert_eq!(
        run(
            "local t={}; setmetatable(_G,{__newindex=function(_,k,v) t[k]=v*2 end}); missing=7; return t.missing,rawget(_G,'missing')==nil"
        ),
        vec![Value::Integer(14), Value::Bool(true)]
    );
}

#[test]
fn assignment_captures_the_target_environment_before_writing() {
    assert_eq!(
        run("local first,second={},{}; local _ENV=first; _ENV,x=second,7; return first.x,second.x"),
        vec![Value::Integer(7), Value::Nil]
    );
}

#[test]
fn successive_chunks_share_the_root_environment_cell() {
    let mut vm = Runtime::new(1_000_000);
    vm.run("saved=function() return x end", "bootstrap.lua")
        .unwrap();
    let saved = vm.global("saved");
    vm.run("_ENV={x=13}", "filter.lua").unwrap();
    assert_eq!(vm.call(saved, vec![]).unwrap(), vec![Value::Integer(13)]);
    assert_eq!(
        vm.run("return x", "next.lua").unwrap(),
        vec![Value::Integer(13)]
    );
    assert_eq!(vm.global("x"), Value::Nil);
}

#[test]
fn installed_string_library_keeps_its_own_environment_cell() {
    assert_eq!(
        run("local format=string.format; _ENV={}; return format('%s',42)"),
        vec![Value::String(b"42".to_vec())]
    );
}

#[test]
fn missing_environment_functions_report_streaming_errors() {
    assert_eq!(
        Runtime::new(1_000_000)
            .run("_ENV={}; absent()", "environment.lua")
            .unwrap_err()
            .message,
        "Expected Lua function"
    );
}

#[test]
fn invalid_environments_report_index_and_assignment_errors_without_locations() {
    for (source, message) in [
        (
            "local _ENV=nil; return missing",
            "Expected Lua table for indexing",
        ),
        (
            "local _ENV=nil; missing=7",
            "Expected Lua table for assignment",
        ),
        (
            "local e={}; setmetatable(e,{__index=e}); local _ENV=e; return missing",
            "'__index' chain too long; possible loop",
        ),
        (
            "local e={}; setmetatable(e,{__newindex=e}); local _ENV=e; missing=7",
            "'__newindex' chain too long; possible loop",
        ),
    ] {
        assert_eq!(
            Runtime::new(1_000_000)
                .run(source, "environment.lua")
                .unwrap_err()
                .to_string(),
            message,
            "{source}"
        );
    }
}
