use lua_rust::{Runtime, Value};

#[test]
fn non_variadic_functions_reject_varargs_before_execution() {
    for source in [
        "local function f() if false then return ... end end",
        "local function outer(...) local function inner() return ... end; return inner end",
        "local f=function() return {...} end",
    ] {
        let mut vm = Runtime::new(100_000);
        assert_eq!(
            vm.run(format!("changed=true; {source}"), "vararg.lua")
                .unwrap_err()
                .to_string(),
            "cannot use '...' outside a vararg function",
            "{source}"
        );
        assert_eq!(vm.global("changed"), Value::Nil);
    }
}

#[test]
fn vararg_scope_is_restored_after_parsing_nested_functions() {
    let mut vm = Runtime::new(100_000);
    assert_eq!(
        vm.run("local function outer(...) local function inner() return 7 end; return select('#',...),inner(),... end; return outer(4,5)", "vararg.lua").unwrap(),
        vec![Value::Integer(2), Value::Integer(7), Value::Integer(4), Value::Integer(5)]
    );
    assert_eq!(
        vm.run("local function outer() local function inner(...) return ... end; return inner(4,5) end; return outer()", "vararg.lua").unwrap(),
        vec![Value::Integer(4), Value::Integer(5)]
    );
    assert_eq!(
        vm.run("local function f() end; return ...", "vararg.lua")
            .unwrap(),
        Vec::<Value>::new()
    );
}

#[test]
fn nested_variadic_functions_do_not_make_the_parent_variadic() {
    assert_eq!(
        Runtime::new(100_000)
            .run(
                "local function outer() local function inner(...) return ... end; return ... end",
                "vararg.lua"
            )
            .unwrap_err()
            .to_string(),
        "cannot use '...' outside a vararg function"
    );
}
