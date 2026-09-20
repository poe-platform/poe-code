use config_mutations_rust::{toml, value::Value};
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn string(s: &str) -> Value {
    Value::String(u(s))
}
fn number(n: f64) -> Value {
    Value::Number(n)
}
#[test]
fn parses_comments_dotted_and_quoted_keys_and_inline_values() {
    let source = u(
        "# config\nname = 'agent'\n\"quoted.key\" = \"🦀\"\n__proto__.safe = true\nnested.path = { x = 1, list = [1, 2, 3,], }\n",
    );
    let parsed = toml::parse(&source).unwrap();
    assert_eq!(parsed.get("name"), Some(&string("agent")));
    assert_eq!(parsed.get("quoted.key"), Some(&string("🦀")));
    assert_eq!(
        parsed.get("__proto__").unwrap().get("safe"),
        Some(&Value::Bool(true))
    );
    assert_eq!(
        parsed.get("nested").unwrap().get("path").unwrap().get("x"),
        Some(&number(1.0))
    );
    for text in ["", " \u{feff}\u{a0}", "# comment\n"] {
        assert_eq!(toml::parse(&u(text)).unwrap(), Value::Object(vec![]));
    }
}
#[test]
fn table_headers_and_arrays_of_tables_attach_to_the_latest_parent() {
    let parsed=toml::parse(&u("title = 'config'\n[implicit.child]\nx = 1\n[implicit]\ny = 2\n[[servers]]\nname = 'first'\n[servers.env]\nA = 'one'\n[[servers]]\nname = 'second'\n[[servers.tools]]\nname = 'tool'\n[servers.tools.meta]\nactive = true\n")).unwrap();
    assert_eq!(parsed.get("implicit").unwrap().get("y"), Some(&number(2.0)));
    let Some(Value::Array(servers)) = parsed.get("servers") else {
        panic!()
    };
    assert_eq!(servers.len(), 2);
    assert_eq!(
        servers[0].get("env").unwrap().get("A"),
        Some(&string("one"))
    );
    assert_eq!(servers[1].get("name"), Some(&string("second")));
    let Some(Value::Array(tools)) = servers[1].get("tools") else {
        panic!()
    };
    assert_eq!(
        tools[0].get("meta").unwrap().get("active"),
        Some(&Value::Bool(true))
    );
}
#[test]
fn strings_preserve_utf16_and_decode_multiline_continuations_and_unicode() {
    let mut source = u("raw = '");
    source.push(0xd800);
    source.extend(u("'\ntext = \"\\u0041\\U0001F980\\x42\\e\"\nmultiline = \"\"\"\nfirst\\  \n  second\nthird\"\"\"\nliteral = '''\nline\\n\nnext'''\n"));
    let parsed = toml::parse(&source).unwrap();
    assert_eq!(parsed.get("raw"), Some(&Value::String(vec![0xd800])));
    assert_eq!(parsed.get("text"), Some(&string("A🦀B\u{1b}")));
    assert_eq!(parsed.get("multiline"), Some(&string("firstsecond\nthird")));
    assert_eq!(parsed.get("literal"), Some(&string("line\\n\nnext")));
}
#[test]
fn numbers_validate_radix_separators_safe_integers_and_nonfinite_values() {
    let parsed=toml::parse(&u("hex = 0xDE_AD\noctal = 0o7_55\nbinary = 0b1_01\nfloat = -1_2.5e+2\nzero = -0\nnegative_float_zero = -0.0\ninf = +inf\nnan = -nan\n")).unwrap();
    assert_eq!(parsed.get("hex"), Some(&number(57005.0)));
    assert_eq!(parsed.get("octal"), Some(&number(493.0)));
    assert_eq!(parsed.get("binary"), Some(&number(5.0)));
    assert_eq!(parsed.get("float"), Some(&number(-1250.0)));
    let Some(Value::Number(zero)) = parsed.get("zero") else {
        panic!()
    };
    assert!(!zero.is_sign_negative());
    let Some(Value::Number(zero)) = parsed.get("negative_float_zero") else {
        panic!()
    };
    assert!(zero.is_sign_negative());
    assert_eq!(parsed.get("inf"), Some(&number(f64::INFINITY)));
    let Some(Value::Number(nan)) = parsed.get("nan") else {
        panic!()
    };
    assert!(nan.is_nan());
    for text in [
        "n = 01",
        "n = 1__0",
        "n = 0b2",
        "n = +0x10",
        "n = 9007199254740992",
        "n = 1.",
        "n = .1",
        "n = 1e",
    ] {
        assert!(toml::parse(&u(text)).is_err(), "{text}");
    }
}
#[test]
fn duplicate_and_sealed_tables_cannot_be_redefined() {
    for text in [
        "a = 1\na = 2",
        "a = 1\na.b = 2",
        "a.b = 1\n[a]",
        "[a]\n[a]",
        "a = {}\n[a]",
        "a = []\n[[a]]",
        "[a]\n[[a]]",
        "[[a]]\n[a]",
        "x = { a = 1, a = 2 }",
        "x = { a = {}, a.b = 2 }",
    ] {
        assert!(toml::parse(&u(text)).is_err(), "{text}");
    }
}
#[test]
fn temporal_values_preserve_local_forms_offsets_and_millisecond_precision() {
    for (literal, iso, local, date, time) in [
        (
            "2026-08-26T12:34:56.789Z",
            "2026-08-26T12:34:56.789Z",
            false,
            false,
            false,
        ),
        (
            "2026-08-26T12:34:56.789+05:30",
            "2026-08-26T12:34:56.789+05:30",
            false,
            false,
            false,
        ),
        (
            "2026-08-26 12:34:56.789123",
            "2026-08-26T12:34:56.789",
            true,
            false,
            false,
        ),
        ("2026-08-26", "2026-08-26", true, true, false),
        ("12:34:56.789123", "12:34:56.789", true, false, true),
        ("12:34", "12:34:00.000", true, false, true),
    ] {
        let parsed = toml::parse(&u(&format!("updated = {literal}"))).unwrap();
        let Some(Value::Date(value)) = parsed.get("updated") else {
            panic!("{literal}")
        };
        assert_eq!(value.to_iso_string(), u(iso));
        assert_eq!(value.is_local(), local);
        assert_eq!(value.is_date(), date);
        assert_eq!(value.is_time(), time);
    }
    for literal in [
        "2026-13-01",
        "2026-01-00",
        "24:00:00",
        "12:60:00",
        "12:34:60",
        "2026-01-01T00:00:00+24:00",
    ] {
        assert!(
            toml::parse(&u(&format!("updated = {literal}"))).is_err(),
            "{literal}"
        );
    }
}
#[test]
fn serializer_emits_scalars_before_nested_and_array_tables() {
    let value = Value::Object(vec![
        (
            u("nested"),
            Value::Object(vec![(u("child"), string("value"))]),
        ),
        (u("title"), string("agent")),
        (
            u("list"),
            Value::Array(vec![
                number(1.0),
                Value::Object(vec![(u("two words"), Value::Bool(true))]),
            ]),
        ),
        (
            u("servers"),
            Value::Array(vec![
                Value::Object(vec![(u("name"), string("first"))]),
                Value::Object(vec![(u("name"), string("second"))]),
            ]),
        ),
    ]);
    assert_eq!(
        toml::stringify(&value).unwrap(),
        u(
            "title = \"agent\"\nlist = [ 1, { \"two words\" = true } ]\n\n[nested]\nchild = \"value\"\n\n[[servers]]\nname = \"first\"\n\n[[servers]]\nname = \"second\"\n"
        )
    );
    assert_eq!(
        toml::parse(&toml::stringify(&value).unwrap())
            .unwrap()
            .get("title"),
        Some(&string("agent"))
    );
    assert!(toml::stringify(&Value::Array(vec![])).is_err());
    assert!(
        toml::stringify(&Value::Object(vec![(
            u("list"),
            Value::Array(vec![Value::Null])
        )]))
        .is_err()
    );
    assert_eq!(
        toml::stringify(&Value::Object(vec![
            (u("missing"), Value::Undefined),
            (u("null"), Value::Null)
        ]))
        .unwrap(),
        u("\n")
    );
}

#[test]
fn table_array_headers_require_two_adjacent_closing_brackets() {
    for source in ["[[section]", "[[section] ]", "[[section]\nkey=1"] {
        assert!(toml::parse(&u(source)).is_err(), "{source}");
    }
}

#[test]
fn bounds_dotted_paths_and_combined_literal_nesting_before_tree_conversion() {
    let source = format!("{}x = 1", "a.".repeat(1000));
    assert!(toml::parse(&u(&source)).is_err());
    let source = format!(
        "{}x = {}1{}",
        "a.".repeat(600),
        "[".repeat(600),
        "]".repeat(600)
    );
    assert!(toml::parse(&u(&source)).is_err());
}

#[test]
fn parser_and_serializer_support_admitted_depth_on_default_test_stacks() {
    let depth = 999;
    let source = format!("value = {}1{}", "[".repeat(depth), "]".repeat(depth));
    let parsed = toml::parse(&u(&source)).unwrap();
    let serialized = toml::stringify(&parsed).unwrap();
    assert_eq!(
        serialized,
        u(&format!(
            "value = {}1{}\n",
            "[ ".repeat(depth),
            " ]".repeat(depth)
        ))
    );
    let source = format!("{}value = 1", "key.".repeat(999));
    assert!(toml::parse(&u(&source)).is_ok());
}
