use lua_rust::{Runtime, Value};

#[test]
fn next_resumes_after_deleted_keys_and_skips_deleted_successors() {
    for (source, expected) in [
        (
            "local t={a=1,b=2};local k=next(t);t[k]=nil;local n,v=next(t,k);return n..':'..v",
            "b:2",
        ),
        (
            "local t={a=1,b=2,c=3,d=4};t.a=nil;t.b=nil;t.c=nil;local k,v=next(t,'a');return k..':'..v",
            "d:4",
        ),
        (
            "local t={a=1};t.a=nil;return tostring(next(t,'a'))..':'..select('#',next(t,'a'))",
            "nil:1",
        ),
        (
            "local t={1,2,3};table.remove(t);return tostring(next(t,3))",
            "2",
        ),
        (
            "local t={a=1,b=false};rawset(t,'a',nil);local k,v=next(t,'a');return k..':'..tostring(v)",
            "b:false",
        ),
    ] {
        assert_eq!(
            Runtime::new(100_000).run(source, "iteration.lua").unwrap(),
            vec![Value::String(expected.into())]
        );
    }
}

#[test]
fn pairs_allows_deleting_every_visited_entry() {
    for count in [0, 1, 2, 31, 128] {
        let source = format!(
            "local t={{}};for i=1,{count} do t[i]=i end;local count,sum=0,0;for k,v in pairs(t) do t[k]=nil;count=count+1;sum=sum+v end;return count,sum,next(t),rawlen(t)"
        );
        assert_eq!(
            Runtime::new(100_000).run(source, "iteration.lua").unwrap(),
            vec![
                Value::Integer(count),
                Value::Integer(count * (count + 1) / 2),
                Value::Nil,
                Value::Integer(0)
            ]
        );
    }
}

#[test]
fn reinsertion_preserves_streaming_order_and_original_numeric_key_type() {
    for (source, expected) in [
        (
            "local t={a=1,b=2};t.a=nil;t.a=3;local k,v=next(t);return k..':'..v",
            "a:3",
        ),
        (
            "local t={[1.0]='a',b=2};t[1]=nil;t[1]='c';local k,v=next(t);return math.type(k)..':'..v",
            "float:c",
        ),
        (
            "local t={a=1,b=2};t.a=nil;t.c=3;t.a=4;local keys={};for k in pairs(t) do keys[#keys+1]=k end;return table.concat(keys,',')",
            "a,b,c",
        ),
    ] {
        assert_eq!(
            Runtime::new(100_000).run(source, "iteration.lua").unwrap(),
            vec![Value::String(expected.into())]
        );
    }
}

#[test]
fn next_validates_arguments_and_unknown_cursors_with_streaming_errors() {
    for (source, message) in [
        ("return next()", "Value expected"),
        ("return next(nil)", "Expected Lua table"),
        ("return next(false)", "Expected Lua table"),
        ("return next('x')", "Expected Lua table"),
        ("return next({},'missing')", "Invalid key to next"),
        (
            "local t={a=1};t.b=nil;return next(t,'b')",
            "Invalid key to next",
        ),
        ("return next({},0/0)", "Invalid key to next"),
    ] {
        let error = Runtime::new(100_000)
            .run(source, "iteration.lua")
            .unwrap_err();
        assert_eq!(error.message, message, "{source}");
        assert_eq!(error.location, None, "{source}");
    }
}

#[test]
fn public_entries_exclude_deleted_values_without_losing_false_or_reinsertions() {
    let mut runtime = Runtime::new(100_000);
    let table = runtime
        .run("return {a=1,b=false,c=3}", "iteration.lua")
        .unwrap()
        .remove(0);
    runtime
        .raw_set(&table, Value::String("a".into()), Value::Nil)
        .unwrap();
    runtime
        .raw_set(&table, Value::String("c".into()), Value::Nil)
        .unwrap();
    assert_eq!(
        runtime.entries(&table).unwrap(),
        vec![(Value::String("b".into()), Value::Bool(false))]
    );
    assert_eq!(
        runtime.raw_get(&table, &Value::String("a".into())),
        Value::Nil
    );
    runtime
        .raw_set(&table, Value::String("a".into()), Value::Integer(4))
        .unwrap();
    assert_eq!(
        runtime.entries(&table).unwrap(),
        vec![
            (Value::String("a".into()), Value::Integer(4)),
            (Value::String("b".into()), Value::Bool(false))
        ]
    );
}

#[test]
fn next_ignores_callbacks_and_pairs_retains_custom_iterators() {
    let source = "local t=setmetatable({a=1,b=2},{__index=function() error('unexpected indexing') end,__pairs=function(t) return next,t,'a' end});t.a=nil;local k,v;for key,value in pairs(t) do k,v=key,value end;return k,v";
    assert_eq!(
        Runtime::new(100_000).run(source, "iteration.lua").unwrap(),
        vec![Value::String("b".into()), Value::Integer(2)]
    );
}

#[test]
fn constructors_delay_array_writes_without_reordering_expression_evaluation() {
    for (source, expected) in [
        ("local t={10,[1]=20};return t[1]", Value::Integer(10)),
        (
            "local t={10,a=1,20,b=2};local keys={};for k in pairs(t) do keys[#keys+1]=k end;return table.concat(keys,',')",
            Value::String("a,b,2,1".into()),
        ),
        ("local t={10,[1]=nil};return t[1]", Value::Integer(10)),
        (
            "local t={[1.0]=20,10};local k,v=next(t);return math.type(k)..':'..v",
            Value::String("float:10".into()),
        ),
        (
            "local calls={};local function mark(x) calls[#calls+1]=x;return x end;local t={mark('first'),[mark('key')]=mark('value'),mark('last')};return table.concat(calls,',')..':'..t[1]..':'..t[2]",
            Value::String("first,key,value,last:first:last".into()),
        ),
    ] {
        assert_eq!(
            Runtime::new(100_000).run(source, "iteration.lua").unwrap(),
            vec![expected]
        );
    }
}

#[test]
fn constructors_preserve_array_batch_boundaries_and_open_final_results() {
    for (count, ending, probe, expected) in [
        (
            0,
            "tail()",
            "return next(t),next(t,3),next(t,1)",
            vec![3, 1],
        ),
        (
            49,
            "tail()",
            "return next(t),next(t,52),next(t,50),next(t,1)",
            vec![52, 50, 49],
        ),
        (
            50,
            "tail()",
            "return next(t),next(t,1),next(t,53),next(t,51)",
            vec![50, 53, 51],
        ),
        (
            51,
            "tail()",
            "return next(t),next(t,1),next(t,54),next(t,52),next(t,51)",
            vec![50, 54, 52, 51],
        ),
        (49, "empty()", "return next(t),next(t,1)", vec![49]),
        (50, "empty()", "return next(t),next(t,1)", vec![50]),
        (
            51,
            "empty()",
            "return next(t),next(t,1),next(t,51)",
            vec![50, 51],
        ),
        (
            49,
            "(tail())",
            "return next(t),next(t,50),next(t,1)",
            vec![50, 49],
        ),
        (
            50,
            "(tail())",
            "return next(t),next(t,1),next(t,51)",
            vec![50, 51],
        ),
        (
            51,
            "(empty())",
            "return next(t),next(t,1),next(t,51)",
            vec![50, 51],
        ),
        (
            100,
            "tail()",
            "return next(t),next(t,1),next(t,51),next(t,103),next(t,101)",
            vec![50, 100, 103, 101],
        ),
    ] {
        let fields = (1..=count).map(|n| format!("{n},")).collect::<String>();
        let source = format!(
            "local function tail() return 7,nil,9 end;local function empty() end;local t={{{fields}{ending}}};{probe}"
        );
        let mut expected = expected.into_iter().map(Value::Integer).collect::<Vec<_>>();
        expected.push(Value::Nil);
        assert_eq!(
            Runtime::new(100_000).run(&source, "iteration.lua").unwrap(),
            expected,
            "{count}: {ending}"
        );
    }
}
