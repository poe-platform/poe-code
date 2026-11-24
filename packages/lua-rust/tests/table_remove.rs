use lua_rust::{Runtime, Value};

#[test]
fn removal_after_the_end_preserves_existing_elements() {
    for (source, expected) in [
        (
            "local t={1,2}; local x=table.remove(t,3); return tostring(x)..':'..table.concat(t,',')",
            "nil:1,2",
        ),
        (
            "local t={[0]=7}; local x=table.remove(t,1); return tostring(x)..':'..tostring(t[0])",
            "nil:7",
        ),
        (
            "local t={[0]=7}; local x=table.remove(t); return tostring(x)..':'..tostring(t[0])",
            "7:nil",
        ),
        (
            "local t={1,2}; return table.remove(t,nil)..':'..table.concat(t,',')",
            "2:1",
        ),
    ] {
        assert_eq!(
            Runtime::new(100_000).run(source, "remove.lua").unwrap(),
            vec![Value::String(expected.into())]
        );
    }
}

#[test]
fn removal_uses_length_and_preserves_callback_order() {
    let source = "local values={3,1,2}; local events=''; local t=setmetatable({}, {__len=function(a,b) events=events..'L'..tostring(rawequal(a,b)); return 3 end,__index=function(_,i) events=events..'R'..i; return values[i] end,__newindex=function(_,i,v) events=events..'W'..i; values[i]=v end}); local v=table.remove(t,2); return v..':'..events..':'..table.concat(values,',')";
    assert_eq!(
        Runtime::new(100_000).run(source, "remove.lua").unwrap(),
        vec![Value::String("1:LtrueR2R3W2W3:3,2".into())]
    );
    assert_eq!(Runtime::new(100_000).run("local t=setmetatable({[-2]=7},{__len=function() return -2 end}); return table.remove(t),t[-2]", "remove.lua").unwrap(), vec![Value::Integer(7),Value::Nil]);
}

#[test]
fn invalid_positions_fail_before_mutating_the_table() {
    for (position, message) in [
        ("0", "table:30: Position out of bounds"),
        ("4", "table:30: Position out of bounds"),
        ("1.5", "Number has no integer representation"),
        ("2147483648", "Number has no integer representation"),
        ("false", "Expected Lua number"),
    ] {
        let mut vm = Runtime::new(100_000);
        vm.run("t={1,2}", "remove.lua").unwrap();
        assert_eq!(
            vm.run(format!("table.remove(t,{position})"), "remove.lua")
                .unwrap_err()
                .to_string(),
            message
        );
        assert_eq!(
            vm.run("return table.concat(t,',')", "remove.lua").unwrap(),
            vec![Value::String("1,2".into())]
        );
    }
}
