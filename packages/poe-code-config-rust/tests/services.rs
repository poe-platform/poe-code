use poe_code_config_rust::services::{files, is_api_shape, optional_text};
fn u(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn preserves_file_order_literal_names_and_utf16() {
    assert_eq!(
        files(vec![
            u(""),
            u(" b "),
            u("a"),
            u(" b "),
            vec![0xd800],
            vec![0xd800]
        ]),
        vec![u(" b "), u("a"), vec![0xd800]]
    );
}
#[test]
fn shapes_and_text_have_exact_admission() {
    for shape in [
        "openai-chat-completions",
        "openai-responses",
        "anthropic-messages",
        "google-generations",
    ] {
        assert!(is_api_shape(&u(shape)));
    }
    assert!(!is_api_shape(&u("OPENAI-RESPONSES")));
    assert_eq!(optional_text(&u("\u{feff} a \u{a0}")), Some(u("a")));
    assert_eq!(optional_text(&u("\u{2028} ")), None);
    assert_eq!(optional_text(&[0xd800, 32]), Some(vec![0xd800]));
}
