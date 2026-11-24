use lua_rust::{Runtime, Value};

fn run(source: &str) -> Vec<Value> {
    Runtime::new(100_000).run(source, "jumps.lua").unwrap()
}

#[test]
fn backward_jumps_discard_local_bindings() {
    assert_eq!(
        run(
            "local seen={}; local i=0; ::again:: i=i+1; local x=(x or 0)+1; seen[i]=x; if i<2 then goto again end; return table.concat(seen,',')"
        ),
        vec![Value::String(b"1,1".to_vec())]
    );
    assert_eq!(
        run(
            "local saved=_ENV; local i=0; ::again:: i=i+1; local _ENV={x=(_ENV==saved and 1 or 2)}; if i<2 then goto again end; return x"
        ),
        vec![Value::Integer(1)]
    );
}

#[test]
fn jumps_preserve_closed_values_and_outer_locals() {
    for source in [
        "local f={}; local i=0; ::again:: i=i+1; local x=i; f[i]=function() return x end; if i<2 then goto again end; return f[1](),f[2]()",
        "local f={}; local i=0; ::again:: i=i+1; local x=i; goto target; ::target:: f[i]=function() return x end; if i<2 then goto again end; return f[1](),f[2]()",
        "local f={}; local i=0; ::again:: i=i+1; goto target; ::target:: local x=i; f[i]=function() return x end; if i<2 then goto again end; return f[1](),f[2]()",
    ] {
        assert_eq!(run(source), vec![Value::Integer(1), Value::Integer(2)]);
    }
    assert_eq!(
        run("local x=3; do local x=7; goto done end; ::done:: return x"),
        vec![Value::Integer(3)]
    );
}

#[test]
fn forward_jumps_cannot_enter_local_scopes() {
    for source in [
        "goto done; local x=7; ::done:: return x",
        "do goto done end; local x=7; ::done:: return x",
        "goto done; local function f() end; ::done:: return 7",
        "repeat goto done; local x=1; ::done:: until true; return 7",
    ] {
        assert_eq!(
            Runtime::new(100_000)
                .run(source, "jumps.lua")
                .unwrap_err()
                .to_string(),
            "goto jumps into the scope of a local variable",
            "{source}"
        );
    }
}

#[test]
fn invalid_jumps_are_rejected_before_execution() {
    for source in [
        "if false then goto missing end; return 7",
        "if false then break end; return 7",
        "::outer:: local function f() if false then goto outer end end; return 7",
        "do goto done end; do ::done:: end; return 7",
        "while false do local f=function() break end end; return 7",
    ] {
        let mut vm = Runtime::new(100_000);
        assert_eq!(
            vm.run(format!("changed=true; {source}"), "jumps.lua")
                .unwrap_err()
                .to_string(),
            "no visible label for goto or break outside loop",
            "{source}"
        );
        assert_eq!(vm.global("changed"), Value::Nil);
    }
}

#[test]
fn duplicate_labels_are_rejected_in_their_own_block() {
    assert_eq!(
        Runtime::new(100_000)
            .run("::same:: ::same:: return 7", "jumps.lua")
            .unwrap_err()
            .to_string(),
        "label already defined in this block"
    );
    assert_eq!(
        run("local x=1; ::same:: do goto same; ::same:: x=2 end; return x"),
        vec![Value::Integer(2)]
    );
}

#[test]
fn trailing_labels_and_loop_breaks_preserve_lua_scope_rules() {
    assert!(run("goto done; local x=7; ::done::").is_empty());
    assert!(run("goto done; local x=7; ::other::; ::done::;").is_empty());
    assert_eq!(
        run("local i=0; repeat i=i+1; local x=i; ::done:: until x==2; return i"),
        vec![Value::Integer(2)]
    );
    assert_eq!(
        run("local x=0; for i=1,3 do x=x+i; if i==2 then break end end; return x"),
        vec![Value::Integer(3)]
    );
    assert_eq!(
        run("local i=0; while true do i=i+1; if i==2 then break end end; return i"),
        vec![Value::Integer(2)]
    );
    assert_eq!(
        run("local i=0; repeat i=i+1; if i==2 then break end until false; return i"),
        vec![Value::Integer(2)]
    );
}
