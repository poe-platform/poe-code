use lua_rust::{Runtime, Value};

fn run(source: &str) -> Vec<Value> {
    Runtime::new(1_000_000).run(source, "bytes.lua").unwrap()
}
fn numbers(values: &[u8]) -> Vec<Value> {
    values.iter().map(|v| Value::Number(*v as f64)).collect()
}

#[test]
fn byte_default_end_uses_the_unclamped_start() {
    for position in ["0", "-4", "-5", "-99", "4", "2147483647", "-2147483648"] {
        assert!(run(&format!("return string.byte('abc',{position})")).is_empty());
    }
    assert_eq!(run("return string.byte('abc',0,2)"), numbers(b"ab"));
    assert_eq!(run("return string.byte('abc',-99,-1)"), numbers(b"abc"));
    assert_eq!(run("return string.byte('abc',-1)"), numbers(b"c"));
}

#[test]
fn optional_string_arguments_accept_explicit_nil() {
    assert_eq!(run("return string.byte('abc',nil)"), numbers(b"a"));
    assert_eq!(run("return string.byte('abc',2,nil)"), numbers(b"b"));
    assert_eq!(
        run("return string.sub('abc',2,nil),string.rep('ab',2,nil)"),
        vec![Value::String("bc".into()), Value::String("abab".into())]
    );
}

#[test]
fn string_positions_and_repetition_counts_require_32_bit_integers() {
    for call in [
        "string.sub('abc',1.5)",
        "string.sub('abc',1,1.5)",
        "string.byte('abc',1.5)",
        "string.byte('abc',1,1.5)",
        "string.rep('abc',1.5)",
        "string.byte('abc',2147483648)",
        "string.sub('abc',-2147483649)",
        "string.rep('abc',0/0)",
    ] {
        assert_eq!(
            Runtime::new(100_000)
                .run(call, "bytes.lua")
                .unwrap_err()
                .to_string(),
            "Number has no integer representation",
            "{call}"
        );
    }
    assert_eq!(
        run("return string.sub(1234,'2','3'),string.rep(12,'2',7),string.byte(1234,'2')"),
        vec![
            Value::String("23".into()),
            Value::String("12712".into()),
            Value::Integer(50)
        ]
    );
}

#[test]
fn string_arguments_are_validated_before_empty_results() {
    for (call, error) in [
        ("string.sub('abc')", "Expected Lua number"),
        ("string.byte('abc',false)", "Expected Lua number"),
        ("string.rep('abc',false)", "Expected Lua number"),
        (
            "string.rep('abc',-1,true)",
            "Expected Lua string or number for concatenation",
        ),
        (
            "string.sub(false,2,1)",
            "Expected Lua string or number for concatenation",
        ),
    ] {
        assert_eq!(
            Runtime::new(100_000)
                .run(call, "bytes.lua")
                .unwrap_err()
                .to_string(),
            error,
            "{call}"
        );
    }
}

#[test]
fn repetition_checks_combined_length_and_shortcuts_empty_output() {
    for source in [
        "return string.rep('ab',1073741824)",
        "return string.rep('x',2147483647,':')",
    ] {
        assert_eq!(
            Runtime::new(100_000)
                .run(source, "bytes.lua")
                .unwrap_err()
                .to_string(),
            "Resulting string too large"
        );
    }
    assert_eq!(Runtime::new(100_000).run("return string.rep('',2147483647),string.rep('',1,':'),string.rep('x',-2147483648,':')", "bytes.lua").unwrap(), vec![Value::String(Vec::new());3]);
}

#[test]
fn characters_and_escapes_preserve_every_byte() {
    assert_eq!(
        run("local s=string.char(0,128,255,65); return #s,s:byte(1,-1)"),
        numbers(&[4, 0, 128, 255, 65])
    );
    assert_eq!(
        run(r"return string.byte('\000\128\255\x80\xff',1,-1)"),
        numbers(&[0, 128, 255, 128, 255])
    );
}

#[test]
fn slices_reverse_and_tostring_preserve_utf8_fragments() {
    assert_eq!(
        run(
            "local s='Ω'; return s:sub(1,1):byte(),s:sub(2):byte(),s:reverse():reverse()==s,tostring(s:reverse())==s:reverse()"
        ),
        vec![
            Value::Number(206.0),
            Value::Number(169.0),
            Value::Bool(true),
            Value::Bool(true)
        ]
    );
}

#[test]
fn byte_keys_ordering_and_concatenation_remain_distinct() {
    assert_eq!(
        run(
            r"local a,b='\128','\255'; local t={[a]=1,[b]=2}; return a<b,a~=b,t[a],t[b],string.byte(a..b,1,2)"
        ),
        vec![
            Value::Bool(true),
            Value::Bool(true),
            Value::Number(1.0),
            Value::Number(2.0),
            Value::Number(128.0),
            Value::Number(255.0)
        ]
    );
    assert_eq!(
        run(r"return string.byte(table.concat({'\255','\128'},'\000'),1,-1)"),
        numbers(&[255, 0, 128])
    );
    assert_eq!(
        run(r"return string.byte(string.rep('\255',2,'\128'),1,-1)"),
        numbers(&[255, 128, 255])
    );
}

#[test]
fn patterns_iterators_and_replacements_keep_raw_captures() {
    assert_eq!(
        run(
            r"local s='\255\000\128'; local t={}; for v in s:gmatch('.') do t[#t+1]=v end; return table.concat(t)==s,string.byte(s:match('(.)')),string.byte((s:gsub('.','%0')),1,-1)"
        ),
        vec![
            Value::Bool(true),
            Value::Number(255.0),
            Value::Number(255.0),
            Value::Number(0.0),
            Value::Number(128.0)
        ]
    );
    assert_eq!(
        run(r"return string.byte(('\255\128'):gsub('.',function(v) return v..v end),1,-1)"),
        numbers(&[255, 255, 128, 128])
    );
}

#[test]
fn source_bytes_remain_bytes_inside_literals() {
    let source = b"return string.byte('\xff'),string.byte([[\x80]])";
    assert_eq!(
        Runtime::new(10000).run(source, "raw.lua").unwrap(),
        numbers(&[255, 128])
    );
}

#[test]
fn control_byte_order_matches_existing_lua_collation() {
    assert_eq!(
        run(
            r"local a,b=string.char(1,35),string.char(18,3); return '\2'<'\16','\2'>'\16',a==b,a<=b,a>=b"
        ),
        vec![
            Value::Bool(false),
            Value::Bool(true),
            Value::Bool(false),
            Value::Bool(true),
            Value::Bool(true)
        ]
    );
}

#[test]
fn utf8_ranges_and_invalid_sequences_use_byte_positions() {
    assert_eq!(
        run("return utf8.len('aΩb',2,3),utf8.codepoint('aΩb',2,3)"),
        vec![Value::Number(1.0), Value::Number(937.0)]
    );
    assert_eq!(
        run(r"return utf8.len('a\255b')"),
        vec![Value::Nil, Value::Number(2.0)]
    );
    assert_eq!(
        run(r"return utf8.len('\255a',2),utf8.len('a\255',1,1)"),
        numbers(&[1, 1])
    );
    for source in [
        r"return utf8.codepoint('\255')",
        "return utf8.len('a',0)",
        "return utf8.len('a',1,2)",
        "return utf8.offset('Ω',1,2)",
    ] {
        assert!(
            Runtime::new(10000).run(source, "bad.lua").is_err(),
            "{source}"
        );
    }
}

#[test]
fn utf8_surrogates_iterators_and_charpattern_match_lua() {
    assert_eq!(
        run("return utf8.codepoint(utf8.char(0xd800)),string.byte(utf8.char(0xd800),1,-1)"),
        vec![
            Value::Number(55296.0),
            Value::Number(237.0),
            Value::Number(160.0),
            Value::Number(128.0)
        ]
    );
    assert_eq!(
        run(
            "local out={} for i,c in utf8.codes('aΩ') do out[#out+1]=i;out[#out+1]=c end return table.unpack(out)"
        ),
        vec![
            Value::Number(1.0),
            Value::Number(97.0),
            Value::Number(2.0),
            Value::Number(937.0)
        ]
    );
    assert_eq!(
        run(
            "local chars={} for c in ('aΩ😀'):gmatch(utf8.charpattern) do chars[#chars+1]=c end return #chars,table.concat(chars)=='aΩ😀'"
        ),
        vec![Value::Number(3.0), Value::Bool(true)]
    );
    assert_eq!(
        run(
            "return utf8.offset('aΩb',0,3),utf8.offset('aΩb',2),utf8.offset('aΩb',-1),utf8.offset('aΩb',4),utf8.offset('aΩb',5)"
        ),
        vec![
            Value::Number(2.0),
            Value::Number(2.0),
            Value::Number(4.0),
            Value::Number(5.0),
            Value::Nil
        ]
    );
}
