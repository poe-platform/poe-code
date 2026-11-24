use lua_rust::{Runtime, Value};

#[test]
fn assignments_and_generic_iterators_report_the_calling_statement() {
    for source in [
        "local t=setmetatable({},{__newindex=function() error('broken',2) end})\n\nt.x=1",
        "local _ENV=setmetatable({},{__newindex=function() error('broken',2) end})\n\nx=1",
        "local function iter() error('broken',2) end\n\nfor x in iter do local y=x end",
        "local function iter() error('broken',2) end\n\nfor x in\n iter\ndo end",
    ] {
        let error = Runtime::new(100_000).run(source, "errors.lua").unwrap_err();
        assert_eq!(error.location, Some(("errors.lua".into(), 3)), "{source}");
    }
}

#[test]
fn errors_preserve_value_kinds_without_stringifying_objects() {
    for (call, expected) in [
        ("error()", "Lua filter execution failed"),
        ("error(nil)", "Lua filter execution failed"),
        ("error(false)", "Lua filter execution failed"),
        ("error({})", "Lua filter execution failed"),
        ("error(function() end)", "Lua filter execution failed"),
        ("error(42)", "42"),
        ("error(1.5)", "1.5"),
        ("assert(false,nil)", "Lua filter execution failed"),
        ("assert(false,false)", "Lua filter execution failed"),
        ("assert(false,42)", "42"),
    ] {
        let error = Runtime::new(100_000).run(call, "errors.lua").unwrap_err();
        assert_eq!(error.to_string(), expected, "{call}");
        assert_eq!(error.location, None, "{call}");
    }
}

#[test]
fn error_levels_validate_integers_and_keep_nil_defaults() {
    for (level, expected) in [
        ("0", "broken"),
        ("-1", "broken"),
        ("99", "broken"),
        ("1.5", "Number has no integer representation"),
        ("2147483648", "Number has no integer representation"),
        ("false", "Expected Lua number"),
        ("nil", "[string \"errors.lua\"]:1: broken"),
        ("'1'", "[string \"errors.lua\"]:1: broken"),
    ] {
        let error = Runtime::new(100_000)
            .run(format!("error('broken',{level})"), "errors.lua")
            .unwrap_err();
        assert_eq!(error.to_string(), expected, "{level}");
    }
    let error = Runtime::new(100_000)
        .run("error({},false)", "errors.lua")
        .unwrap_err();
    assert_eq!(error.to_string(), "Expected Lua number");
}

#[test]
fn errors_select_current_and_parent_call_lines() {
    for (level, line) in [(1, 3), (2, 5)] {
        let source = format!(
            "local function outer()\n local function fail()\n  error('broken',{level})\n end\n fail()\nend\nouter()"
        );
        let error = Runtime::new(100_000).run(source, "errors.lua").unwrap_err();
        assert_eq!(error.location, Some(("errors.lua".into(), line)));
    }
}

#[test]
fn tail_calls_remove_only_the_completed_caller_from_error_locations() {
    for (body, level, line) in [
        ("return error('broken',LEVEL)", 1, Some(5)),
        ("return error('broken',LEVEL)", 2, Some(7)),
        ("return error('broken',LEVEL)", 3, None),
        ("return (error('broken',LEVEL))", 1, Some(3)),
        ("return 1,error('broken',LEVEL)", 1, Some(3)),
        ("return tostring(error('broken',LEVEL))", 1, Some(3)),
    ] {
        let body = body.replace("LEVEL", &level.to_string());
        let source = format!(
            "local function outer()\n local function fail()\n  {body}\n end\n fail()\nend\nouter()"
        );
        let error = Runtime::new(100_000).run(source, "errors.lua").unwrap_err();
        assert_eq!(
            error.location,
            line.map(|n| ("errors.lua".into(), n)),
            "{body}"
        );
    }
}

#[test]
fn native_callback_frames_count_without_acquiring_a_lua_location() {
    let mut runtime = Runtime::new(100_000);
    let error = runtime
        .run(
            "tostring(setmetatable({},{__tostring=function() error('broken',2) end}))",
            "errors.lua",
        )
        .unwrap_err();
    assert_eq!(error.to_string(), "broken");
    let error = runtime
        .run(
            "tostring(setmetatable({},{__tostring=function() error('broken',3) end}))",
            "errors.lua",
        )
        .unwrap_err();
    assert_eq!(error.location, Some(("errors.lua".into(), 1)));
}

#[test]
fn error_frames_are_restored_after_failed_runs_and_public_calls() {
    let mut runtime = Runtime::new(100_000);
    runtime
        .run("function fail() error('broken',2) end", "first.lua")
        .unwrap();
    let error = runtime.call(runtime.global("fail"), vec![]).unwrap_err();
    assert_eq!(error.to_string(), "broken");
    let error = runtime.run("\nfail()", "second.lua").unwrap_err();
    assert_eq!(error.location, Some(("second.lua".into(), 2)));
    assert_eq!(
        runtime
            .run("return assert(true,nil,3)", "third.lua")
            .unwrap(),
        vec![Value::Bool(true), Value::Nil, Value::Integer(3)]
    );
}
