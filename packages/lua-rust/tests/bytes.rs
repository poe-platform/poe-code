use lua_rust::{Runtime, Value};

fn run(source: &str) -> Vec<Value> {
    Runtime::new(1_000_000).run(source, "bytes.lua").unwrap()
}
fn numbers(values: &[u8]) -> Vec<Value> {
    values.iter().map(|v| Value::Number(*v as f64)).collect()
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
