use lua_rust::{Runtime, Value};

fn run(source: &str) -> Vec<Value> {
    Runtime::new(1_000_000).run(source, "pattern.lua").unwrap()
}
fn string(text: &str) -> Value {
    Value::String(text.into())
}
fn number(value: i32) -> Value {
    Value::Number(value as f64)
}

#[test]
fn classes_captures_and_byte_offsets() {
    assert_eq!(
        run("return string.find('abc123','(%a+)(%d+)')"),
        vec![number(1), number(6), string("abc"), string("123")]
    );
    assert_eq!(
        run("return string.match('abc123','()(%a+)()(%d+)()')"),
        vec![
            number(1),
            string("abc"),
            number(4),
            string("123"),
            number(7)
        ]
    );
    assert_eq!(
        run(
            "return string.find('Ω abc','abc'),string.match('ABC','[a-zA-Z]+'),string.match(']-','[]-]+')"
        ),
        vec![number(4), string("ABC"), string("]-")]
    );
}
#[test]
fn balance_frontiers_backreferences_and_backtracking() {
    assert_eq!(
        run(
            "return string.match('x(a(b)c)y','%b()'),string.match('one two','%f[%a]%a+'),string.match('abc-abc','(%a+)%-%1')"
        ),
        vec![string("(a(b)c)"), string("one"), string("abc")]
    );
    assert_eq!(
        run(
            "return string.match('aaaab','a-b'),string.match('aaab','(a*)ab'),string.match('b','a?b')"
        ),
        vec![string("aaaab"), string("aa"), string("b")]
    );
    assert_eq!(
        run("return string.match('aa','^(a?)(a*)$')"),
        vec![string("a"), string("a")]
    );
}
#[test]
fn literal_search_and_relative_initial_positions() {
    assert_eq!(
        run("return string.find('a.b','.',1,true)"),
        vec![number(2), number(2)]
    );
    assert_eq!(
        run("return string.find('abc','',4)"),
        vec![number(4), number(3)]
    );
    assert_eq!(run("return string.find('abc','',5)"), vec![Value::Nil]);
    assert_eq!(
        run("return string.match('xabc','^abc',2), string.find('abc','b',-2)"),
        vec![string("abc"), number(2), number(2)]
    );
}
#[test]
fn independent_iterators_and_empty_match_progress() {
    assert_eq!(
        run(
            "local a=string.gmatch('12','.'); local b=string.gmatch('xy','.'); return a(),b(),a(),b(),a()"
        ),
        vec![string("1"), string("x"), string("2"), string("y")]
    );
    assert_eq!(
        run(
            "local out='' for p,w in string.gmatch('ab cd','()(%a+)') do out=out..p..w end return out"
        ),
        vec![string("1ab4cd")]
    );
    assert_eq!(
        run(
            "local out='' for w in string.gmatch('aab','a*') do out=out..'['..w..']' end return out"
        ),
        vec![string("[aa][]")]
    );
    assert_eq!(
        run("local f=string.gmatch('^a^','^'); return f(),f(),f()"),
        vec![string("^"), string("^")]
    );
}
#[test]
fn replacement_captures_callbacks_tables_and_counts() {
    assert_eq!(
        run("return string.gsub('abc123 def456','(%a+)(%d+)','%2:%1:%%')"),
        vec![string("123:abc:% 456:def:%"), number(2)]
    );
    assert_eq!(
        run("return string.gsub('a1 b2','(%a)(%d)',function(a,b) return b..a end)"),
        vec![string("1a 2b"), number(2)]
    );
    assert_eq!(
        run("return string.gsub('a b c','%a',{a='A',b=false,c=7})"),
        vec![string("A b 7"), number(3)]
    );
    assert_eq!(
        run(
            "return string.gsub('ab','.',setmetatable({}, {__index=function(_,k) return k..k end}))"
        ),
        vec![string("aabb"), number(2)]
    );
    assert_eq!(
        run("return string.gsub('abc','','-')"),
        vec![string("-a-b-c-"), number(4)]
    );
    assert_eq!(
        run("return string.gsub('aaa','a','b',2)"),
        vec![string("bba"), number(2)]
    );
    assert_eq!(
        run("return string.gsub('ab','.',function(c) return string.gsub(c..c,c,'X') end)"),
        vec![string("XXXX"), number(2)]
    );
}
#[test]
fn malformed_patterns_are_reported_only_when_evaluated() {
    for source in [
        "return string.match('x','%')",
        "return string.match('x','[')",
        "return string.match('x','%f')",
        "return string.match('x','%b(')",
        "return string.match('x','%1')",
        "return string.match('x','(')",
        "return string.match('x',')')",
        "return string.gsub('x','.','%q')",
        "return string.gsub('x','.','%2')",
        "return string.gsub('x','.',function() return {} end)",
    ] {
        assert!(
            Runtime::new(10000).run(source, "bad.lua").is_err(),
            "{source}"
        );
    }
    assert_eq!(
        run("return type(string.gmatch('a','(')),string.gsub('abc','x','%q')"),
        vec![string("function"), string("abc"), number(0)]
    );
}
