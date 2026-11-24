use lua_rust::{Runtime, Value};

#[test]
fn failed_table_arguments_leave_existing_values_unchanged() {
    for source in [
        "table.insert(t,0,7)",
        "table.insert(t,1,2,3)",
        "table.move(t,-2147483648,0,1)",
        "table.move(t,1,2,2147483647)",
        "table.sort(t,false)",
    ] {
        let mut vm = Runtime::new(100_000);
        vm.run("t={3,1,2}", "tables.lua").unwrap();
        assert!(vm.run(source, "tables.lua").is_err(), "{source}");
        assert_eq!(
            vm.run("return table.concat(t,',')", "tables.lua").unwrap(),
            vec![Value::String("3,1,2".into())]
        );
    }
}

#[test]
fn quicksort_preserves_values_across_orders_sizes_and_duplicate_keys() {
    for size in [0, 1, 2, 3, 4, 31, 100, 257, 1024] {
        for expression in ["i", "n-i", "i%7", "math.min(i,n-i)"] {
            let source = format!(
                "local n={size}; local t={{}}; for i=1,n do t[i]={expression} end; table.sort(t); return table.unpack(t)"
            );
            let actual = Runtime::new(1_000_000).run(source, "tables.lua").unwrap();
            let mut expected: Vec<i32> = (1..=size)
                .map(|i| match expression {
                    "i" => i,
                    "n-i" => size - i,
                    "i%7" => i % 7,
                    _ => i.min(size - i),
                })
                .collect();
            expected.sort();
            assert_eq!(
                actual,
                expected.into_iter().map(Value::Integer).collect::<Vec<_>>(),
                "{size}/{expression}"
            );
        }
    }
}

#[test]
fn random_pivots_do_not_advance_the_math_random_sequence() {
    let source = "math.randomseed(17); local t={}; for i=1,1024 do t[i]=math.min(i,1025-i) end; table.sort(t); for i=2,#t do assert(t[i-1]<=t[i]) end; return #t,t[1],t[#t],tostring(math.random())";
    assert_eq!(
        Runtime::new(1_000_000).run(source, "tables.lua").unwrap(),
        vec![
            Value::Integer(1024),
            Value::Integer(1),
            Value::Integer(512),
            Value::String("0.50513732433319".into())
        ]
    );
}

#[test]
fn insert_arity_empty() {
    let result = Runtime::new(100_000).run(
        r#"local function probe() table.insert({}); return 'unexpected' end; return probe()"#,
        "/upper.lua",
    );
    assert_eq!(
        result.unwrap_err().to_string(),
        "table:24: Wrong number of arguments to insert"
    );
}

#[test]
fn insert_arity_extra() {
    let result = Runtime::new(100_000).run(
        r#"local function probe() table.insert({},1,2,3); return 'unexpected' end; return probe()"#,
        "/upper.lua",
    );
    assert_eq!(
        result.unwrap_err().to_string(),
        "table:24: Wrong number of arguments to insert"
    );
}

#[test]
fn insert_fraction() {
    let result=Runtime::new(100_000).run(r#"local function probe() table.insert({1,2},1.5,3); return 'unexpected' end; return probe()"#, "/upper.lua");
    assert_eq!(
        result.unwrap_err().to_string(),
        "Number has no integer representation"
    );
}

#[test]
fn insert_length() {
    let result=Runtime::new(100_000).run(r#"local function probe() local values={3,1,2}; local events=''; local t=setmetatable({}, {__len=function() events=events..'L'; return 3 end,__index=function(_,i) events=events..'R'..i; return values[i] end,__newindex=function(_,i,v) events=events..'W'..i; values[i]=v end}); table.insert(t,2,7); return events..':'..table.concat(values,',') end; return probe()"#, "/upper.lua");
    assert_eq!(
        result.unwrap(),
        vec![Value::String("LR3W4R2W3W2:3,7,1,2".into())]
    );
}

#[test]
fn concat_nil() {
    let result = Runtime::new(100_000).run(
        r#"local function probe() return table.concat({1,2},nil,nil,nil) end; return probe()"#,
        "/upper.lua",
    );
    assert_eq!(result.unwrap(), vec![Value::String("12".into())]);
}

#[test]
fn concat_explicit_length() {
    let result=Runtime::new(100_000).run(r#"local function probe() local events=''; local t=setmetatable({}, {__len=function() events=events..'L'; return 7 end,__index=function(_,i) events=events..'R'..i; return i end}); local x=table.concat(t,':',2,3); return x..':'..events end; return probe()"#, "/upper.lua");
    assert_eq!(result.unwrap(), vec![Value::String("2:3:LR2R3".into())]);
}

#[test]
fn unpack_nil() {
    let result=Runtime::new(100_000).run(r#"local function probe() return table.concat({table.unpack({1,2},nil,nil)},',') end; return probe()"#, "/upper.lua");
    assert_eq!(result.unwrap(), vec![Value::String("1,2".into())]);
}

#[test]
fn unpack_explicit_length() {
    let result=Runtime::new(100_000).run(r#"local function probe() local events=''; local t=setmetatable({}, {__len=function() events=events..'L'; return 7 end,__index=function(_,i) events=events..'R'..i; return i end}); local a,b=table.unpack(t,2,3); return events..':'..a..','..b end; return probe()"#, "/upper.lua");
    assert_eq!(result.unwrap(), vec![Value::String("LR2R3:2,3".into())]);
}

#[test]
fn move_nil_destination() {
    let result=Runtime::new(100_000).run(r#"local function probe() local t={1,2,3}; table.move(t,1,2,2,nil); return table.concat(t,',') end; return probe()"#, "/upper.lua");
    assert_eq!(result.unwrap(), vec![Value::String("1,1,2".into())]);
}

#[test]
fn move_callback_order() {
    let result=Runtime::new(100_000).run(r#"local function probe() local values={1,2,3,4}; local events=''; local mt={__eq=function() events=events..'E'; return true end,__index=function(_,i) events=events..'R'..i; return values[i] end,__newindex=function(_,i,v) events=events..'W'..i; values[i]=v end}; local a=setmetatable({},mt); local b=setmetatable({},mt); table.move(a,1,3,2,b); return events..':'..table.concat(values,',') end; return probe()"#, "/upper.lua");
    assert_eq!(
        result.unwrap(),
        vec![Value::String("ER3W4R2W3R1W2:1,1,2,3".into())]
    );
}

#[test]
fn move_empty_invalid_table() {
    let result=Runtime::new(100_000).run(r#"local function probe() table.move(false,2,1,1); return 'unexpected' end; return probe()"#, "/upper.lua");
    assert_eq!(result.unwrap_err().to_string(), "Expected Lua table");
}

#[test]
fn sort_callback_order() {
    let result=Runtime::new(100_000).run(r#"local function probe() local values={4,1,5,2,3}; local events=''; local t=setmetatable({}, {__len=function() events=events..'L'; return 5 end,__index=function(_,i) events=events..'R'..i..';'; return values[i] end,__newindex=function(_,i,v) events=events..'W'..i..';'; values[i]=v end}); table.sort(t,function(a,b) events=events..'C'..a..','..b..';'; return a<b end); return events..':'..table.concat(values,',') end; return probe()"#, "/upper.lua");
    assert_eq!(result.unwrap(),vec![Value::String("LR1;R5;C3,4;W1;W5;R3;R1;C5,3;R5;C4,5;W3;W5;R3;R4;W3;W4;R2;C1,4;R3;C2,4;R4;C4,4;R3;C4,2;W4;W4;R1;R3;C2,3;W1;W3;R2;R1;C1,2;W2;W1;:1,2,3,4,5".into())]);
}
