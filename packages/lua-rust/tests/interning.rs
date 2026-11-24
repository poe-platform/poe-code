use lua_rust::{Runtime, Value};

fn text(source: &str) -> String {
    Runtime::new(100_000)
        .run(source, "interning.lua")
        .unwrap()
        .remove(0)
        .text()
}

#[test]
fn quoted_and_long_strings_share_first_seen_interned_bytes() {
    assert_eq!(text(r"return tostring('\1\35'=='\18\3')"), "true");
    assert_eq!(
        text("local a=[[\x01#]]; local b=[[\x12\x03]]; return tostring(a==b)"),
        "true"
    );
}

#[test]
fn identifiers_and_keywords_share_the_literal_intern_table() {
    assert_eq!(
        text(r"a=7; local s='\6\1'; return tostring(s:byte())"),
        "97"
    );
    assert_eq!(
        text(r"local s='\7\2\6\5\7\4\7\5\7\2\6\14'; return tostring(('return'):byte())"),
        "7"
    );
}

#[test]
fn global_names_preserve_arbitrary_interned_bytes() {
    assert_eq!(
        text(
            r"local prefix='\6\246\1'; oa=8; return tostring(_G[string.char(6,246,1)])..':'..tostring(_G[string.char(111,97)])"
        ),
        "8:nil"
    );
}

#[test]
fn field_and_method_names_preserve_interned_bytes() {
    assert_eq!(
        text(
            r"local prefix='\6\246\1'; local t={x=9}; function t:oa() return self.x end return tostring(t[string.char(6,246,1)]==t.oa)..':'..t:oa()"
        ),
        "true:9"
    );
    assert_eq!(
        text(
            r"local p='\7\3\6\5\6\12\6\6'; local t={}; function t:f() return self end return tostring(t:f()==nil)"
        ),
        "true"
    );
}

#[test]
fn invalid_utf8_names_remain_distinct_in_local_bindings_and_labels() {
    assert_eq!(
        text(r"local p='\6\246\1'; local q='\6\247\1'; local oa,oq=11,22; return oa..':'..oq"),
        "11:22"
    );
    assert_eq!(
        text(
            r"local p='\6\246\1'; local q='\6\247\1'; local v=0; goto oa; ::oq:: v=9; goto finish; ::oa:: v=7; ::finish:: return tostring(v)"
        ),
        "7"
    );
}

#[test]
fn only_source_tokens_are_interned_and_each_chunk_has_its_own_table() {
    assert_eq!(
        text(r"local s='\1\35'; return tostring(s==string.char(18,3))"),
        "false"
    );
    let mut runtime = Runtime::new(100_000);
    runtime.run(r"return '\1\35'", "first.lua").unwrap();
    assert_eq!(
        runtime.run(r"return '\18\3'", "second.lua").unwrap(),
        vec![Value::String(vec![18, 3])]
    );
}
