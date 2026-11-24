use lua_rust::{Runtime, Value};

fn run(source: &str) -> Vec<Value> {
    Runtime::new(1_000_000).run(source, "test.lua").unwrap()
}

#[test]
fn multiple_results_and_lexical_bindings() {
    assert_eq!(
        run(
            "local x=1; local function f() return x,nil,3 end; local x=2; local a,b,c=f(); return a,b,c,(f())"
        ),
        vec![
            Value::Number(1.0),
            Value::Nil,
            Value::Number(3.0),
            Value::Number(1.0)
        ]
    );
    assert_eq!(
        run("local function f(n) if n<2 then return 1 end return n*f(n-1) end return f(5)"),
        vec![Value::Number(120.0)]
    );
    assert_eq!(
        run("local fs={} for i=1,3 do fs[i]=function() return i end end return fs[1](),fs[3]()"),
        vec![Value::Number(1.0), Value::Number(3.0)]
    );
}
#[test]
fn repeat_condition_sees_body_locals() {
    assert_eq!(
        run("local count=0 repeat local done=true; count=count+1 until done return count"),
        vec![Value::Number(1.0)]
    );
}
#[test]
fn empty_varargs_do_not_leak_from_enclosing_call() {
    assert_eq!(
        run(
            "local function outer(...) local function inner(...) return select('#', ...) end return inner() end return outer(1,2)"
        ),
        vec![Value::Number(0.0)]
    );
}
#[test]
fn methods_metatables_and_parallel_assignment() {
    assert_eq!(
        run(
            "local t={value=2}; function t:add(n) self.value=self.value+n end t:add(3); local i=1; local a={10,20}; i,a[i]=2,30; return t.value,a[1],i"
        ),
        vec![Value::Number(5.0), Value::Number(30.0), Value::Number(2.0)]
    );
    assert_eq!(
        run(
            "local t=setmetatable({}, {__len=function() return 12 end,__add=function(a,b) return b*2 end}); return #t,t+3"
        ),
        vec![Value::Number(12.0), Value::Number(6.0)]
    );
}
#[test]
fn precedence_and_short_circuiting() {
    assert_eq!(
        run("return -2^2,2^3^2,1+2*3, false and error('unused'), 0 or 2"),
        vec![
            Value::Number(-4.0),
            Value::Number(512.0),
            Value::Number(7.0),
            Value::Bool(false),
            Value::Number(0.0)
        ]
    );
}
#[test]
fn syntax_and_runtime_errors_keep_the_script_location() {
    assert_eq!(
        Runtime::new(1000)
            .run("function Str(", "bad.lua")
            .unwrap_err()
            .to_string(),
        "Expected 'name', found 'eof'"
    );
    assert_eq!(
        Runtime::new(1000)
            .run("local function f()\n error('broken')\nend\nf()", "bad.lua")
            .unwrap_err()
            .to_string(),
        "[string \"bad.lua\"]:2: broken"
    );
}
#[test]
fn standard_library_lists_and_unicode() {
    assert_eq!(
        run(
            "local t={3,1,2}; table.sort(t); table.insert(t,2,9); local x=table.remove(t); return table.concat(t,','),x,utf8.len('aΩ'),utf8.char(937)"
        ),
        vec![
            Value::String("1,9,2".into()),
            Value::Number(3.0),
            Value::Number(2.0),
            Value::String("Ω".into())
        ]
    );
}
