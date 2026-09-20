use tiny_stdio_mcp_test_server_rust::{Tool, caesar_encrypt, next_spawn_count};

fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

#[test]
fn cipher_wraps_ascii_and_preserves_every_other_utf16_unit() {
    assert_eq!(
        caesar_encrypt(&units("Hello, xyz ABC!"), 3.0).unwrap(),
        units("Khoor, abc DEF!")
    );
    assert_eq!(
        caesar_encrypt(&units("abc ABC"), -1.0).unwrap(),
        units("zab ZAB")
    );
    let text = vec![0, 0xd800, 0xdc00, 0xffff, 97, 90];
    assert_eq!(caesar_encrypt(&text, 26.0).unwrap(), text);
    assert_eq!(caesar_encrypt(&[], 1e300).unwrap(), Vec::<u16>::new());
}

#[test]
fn cipher_rejects_non_integer_and_nonfinite_shifts_even_for_empty_text() {
    for shift in [1.5, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(
            caesar_encrypt(&[], shift).unwrap_err(),
            "Caesar cipher shift must be a finite integer"
        );
    }
}

#[test]
fn spawn_counter_accepts_safe_ascii_decimal_and_ecmascript_whitespace() {
    assert_eq!(next_spawn_count(None).unwrap(), 1);
    for (value, expected) in [
        ("", 1),
        (" 00012\n", 13),
        ("\u{feff}5\u{a0}", 6),
        ("9007199254740991", 9007199254740992),
    ] {
        assert_eq!(next_spawn_count(Some(&units(value))).unwrap(), expected);
    }
    for value in [
        "abc\n",
        "-1",
        "+1",
        "1.0",
        "1e2",
        "0x12",
        "１２",
        "9007199254740992",
    ] {
        assert_eq!(
            next_spawn_count(Some(&units(value))).unwrap_err(),
            "TOOLCRAFT_TEST_SPAWN_COUNT_FILE must contain a non-negative integer"
        );
    }
    assert!(next_spawn_count(Some(&vec![57; 1000])).is_err());
}

#[test]
fn supported_tools_do_not_admit_inherited_names_and_describe_wire_schemas() {
    assert_eq!(Tool::from_name(&units("encrypt")), Some(Tool::Encrypt));
    assert_eq!(
        Tool::from_name(&units("word-of-the-day")),
        Some(Tool::WordOfTheDay)
    );
    for name in ["constructor", "__proto__", "toString", "missing", ""] {
        assert_eq!(Tool::from_name(&units(name)), None);
    }
    let descriptors = Tool::descriptors();
    assert_eq!(descriptors.len(), 2);
    assert_eq!(
        descriptors[0].get("name").unwrap(),
        &mcp_protocol_rust::json::Value::String(units("caesar_cipher_encrypt"))
    );
    assert_eq!(
        descriptors[1].get("name").unwrap(),
        &mcp_protocol_rust::json::Value::String(units("word_of_the_day"))
    );
}
