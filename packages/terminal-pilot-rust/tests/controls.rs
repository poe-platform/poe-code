use terminal_pilot_rust::{key_sequence, strip_ansi};
#[test]
fn stripping_preserves_utf16_and_terminators() {
    for (input, expected) in [
        ("A\x1b[31mB\x1b[0mC", "ABC"),
        ("A\x1b]title\x07B", "AB"),
        ("A\x1bPpayload\x1b\\B", "AB"),
        ("A\u{009b}31mB", "AB"),
        ("A\x1b[31", "A"),
    ] {
        assert_eq!(
            strip_ansi(&input.encode_utf16().collect::<Vec<_>>()),
            expected.encode_utf16().collect::<Vec<_>>()
        );
    }
    assert_eq!(
        strip_ansi(&[0xd800, 0x1b, 0x37, 0xdfff]),
        vec![0xd800, 0xdfff]
    );
}
#[test]
fn named_control_alt_and_literal_keys() {
    for (input, expected) in [
        ("Enter", "\r"),
        ("aRrOwUp", "\x1b[A"),
        ("Control+c", "\x03"),
        ("Alt+ArrowUp", "\x1b\x1b[A"),
        ("Alt+Alt+x", "\x1b\x1bx"),
        ("x", "x"),
    ] {
        assert_eq!(
            key_sequence(&input.encode_utf16().collect::<Vec<_>>()).unwrap(),
            expected.encode_utf16().collect::<Vec<_>>()
        );
    }
    for input in ["", "Control+1", "Alt+", "unknown", "💻"] {
        assert!(key_sequence(&input.encode_utf16().collect::<Vec<_>>()).is_err());
    }
    assert_eq!(key_sequence(&[0xd800]).unwrap(), vec![0xd800]);
}
