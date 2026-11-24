use lua_rust::{Runtime, Value};

#[test]
fn invalid_lengths_match_the_shared_library_error() {
    for source in [
        "return #nil",
        "return #false",
        "return #1",
        "return #(function() end)",
        "return table.unpack(false,2,1)",
    ] {
        let error = Runtime::new(100_000).run(source, "filter.lua").unwrap_err();
        assert_eq!(error.to_string(), "Expected Lua table", "{source}");
    }
}

#[test]
fn pack_preserves_reverse_value_insertion_then_count() {
    let values = Runtime::new(100_000)
        .run("local t=table.pack('a',nil,false,'b');local s='';for k,v in pairs(t) do s=s..tostring(k)..':'..tostring(v)..';' end;return s", "filter.lua")
        .unwrap();
    assert_eq!(values, vec![Value::String("4:b;3:false;1:a;n:4;".into())]);
}

#[test]
fn table_callback_failures_restore_the_runtime_for_later_calls() {
    let mut runtime = Runtime::new(100_000);
    runtime
        .run(
            "table.sort({2,1},function() error('broken',3) end)",
            "first.lua",
        )
        .unwrap_err();
    let values = runtime
        .run(
            "local t={3,1,2};table.sort(t);return table.concat(t,',')",
            "second.lua",
        )
        .unwrap();
    assert_eq!(values, vec![Value::String("1,2,3".into())]);
    let error = runtime.run("error('later',2)", "third.lua").unwrap_err();
    assert_eq!(error.to_string(), "later");
}

#[test]
fn sort_errors_keep_library_helper_frames() {
    for (level, location) in [
        (2, "table:104"),
        (3, "table:136"),
        (4, "[string \"filter.lua\"]:1"),
    ] {
        let error = Runtime::new(100_000)
            .run(
                format!("table.sort({{2,1}},function() error('broken',{level}) end)"),
                "filter.lua",
            )
            .unwrap_err();
        assert_eq!(error.to_string(), format!("{location}: broken"));
    }
}

#[test]
fn length_callbacks_keep_size_and_library_frames() {
    for (level, location) in [
        (2, "table:6"),
        (3, "table:14"),
        (4, "[string \"filter.lua\"]:1"),
    ] {
        let error = Runtime::new(100_000)
            .run(format!("local t=setmetatable({{}},{{__len=function() error('broken',{level}) end}});table.insert(t,1)"), "filter.lua")
            .unwrap_err();
        assert_eq!(error.to_string(), format!("{location}: broken"));
    }
}
