use lua_rust::{Runtime, Value};

fn text(source: &str) -> String {
    Runtime::new(100_000)
        .run(source, "metatables.lua")
        .unwrap()
        .remove(0)
        .text()
}

#[test]
fn strings_share_their_metatable_and_keep_the_original_library() {
    assert_eq!(
        text(
            "local m=getmetatable(''); local old=string; string={}; local r=('abc'):upper(); string=old; return tostring(m==getmetatable('other'))..':'..tostring(m.__index==old)..':'..r"
        ),
        "true:true:ABC"
    );
}

#[test]
fn string_tostring_callbacks_reach_formatting_and_coerce_numeric_results() {
    assert_eq!(
        text(
            "getmetatable('').__tostring=function(s) return '['..s..']' end return string.format('%s|%q','a','a')"
        ),
        "[a]|\"a\""
    );
    assert_eq!(
        text(
            "local t=setmetatable({}, {__tostring=function() return 7.0 end}); return type(tostring(t))..':'..string.format('%s',t)"
        ),
        "string:7.0"
    );
}

#[test]
fn string_index_assignment_and_call_methods_receive_the_original_value() {
    assert_eq!(
        text(
            "local m=getmetatable(''); local seen; m.__index=function(s,k) return s..':'..k end; m.__newindex=function(s,k,v) seen=s..':'..k..':'..v end; m.__call=function(s,v) return s..v end; m.__len=function() return 99 end; local s='abc'; s.x='v'; return s.y..'|'..seen..'|'..s('!')..'|'..#s"
        ),
        "abc:y|abc:x:v|abc!|3"
    );
}

#[test]
fn unary_and_length_callbacks_receive_both_operands() {
    assert_eq!(
        text(
            "local t=setmetatable({}, {__unm=function(a,b) return rawequal(a,b) and 11 end,__bnot=function(a,b) return rawequal(a,b) and 12 end,__len=function(a,b) return rawequal(a,b) and 13 end}); return table.concat({-t,~t,#t},',')"
        ),
        "11,12,13"
    );
}

#[test]
fn bitwise_operators_dispatch_metamethods() {
    assert_eq!(
        text(
            "local t=setmetatable({}, {__band=function() return 1 end,__bor=function() return 2 end,__bxor=function() return 3 end,__shl=function() return 4 end,__shr=function() return 5 end}); return table.concat({t&1,1|t,t~1,1<<t,t>>1},',')"
        ),
        "1,2,3,4,5"
    );
}

#[test]
fn comparisons_choose_callbacks_in_expression_order_and_return_booleans() {
    assert_eq!(
        text(
            "local a=setmetatable({}, {__lt=function() return nil end}); local b=setmetatable({}, {__lt=function() return 'yes' end,__eq=function() return true end}); return table.concat({tostring(a>b),tostring(a<=b),tostring(b<a),tostring(a==b)},',')"
        ),
        "true,false,true,true"
    );
}

#[test]
fn non_function_index_methods_follow_their_own_metatables() {
    assert_eq!(
        text(
            "local m=getmetatable(''); local seen; m.__index=function(s,k) return s..':'..k end; m.__newindex=function(s,k,v) seen=s..':'..k..':'..v end; local t=setmetatable({}, {__index='proxy',__newindex='proxy'}); t.x=7; return t.y..'|'..seen"
        ),
        "proxy:y|proxy:x:7"
    );
}

#[test]
fn invalid_tostring_results_fail_and_string_metatables_are_runtime_local() {
    assert!(
        Runtime::new(100_000)
            .run(
                "return tostring(setmetatable({}, {__tostring=function() return {} end}))",
                "metatables.lua"
            )
            .is_err()
    );
    let mut first = Runtime::new(100_000);
    first
        .run(
            "getmetatable('').__tostring=function() return 'changed' end",
            "metatables.lua",
        )
        .unwrap();
    assert_eq!(
        Runtime::new(100_000)
            .run("return tostring('original')", "metatables.lua")
            .unwrap(),
        vec![Value::String("original".into())]
    );
}

#[test]
fn pairs_callbacks_return_exactly_three_values() {
    assert_eq!(
        text(
            "local t=setmetatable({}, {__pairs=function() return next,{},nil,'extra' end}); return tostring(select('#',pairs(t)))"
        ),
        "3"
    );
    assert_eq!(
        text(
            "local t=setmetatable({}, {__pairs=function() end}); return tostring(select('#',pairs(t)))"
        ),
        "3"
    );
}

#[test]
fn call_metamethods_must_be_functions() {
    let source = "local callable=setmetatable({}, {__call=function() return 'wrong' end}); local t=setmetatable({}, {__call=callable}); return t()";
    assert!(Runtime::new(100_000).run(source, "metatables.lua").is_err());
}
