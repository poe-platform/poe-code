use toolcraft_design_rust::logging::{self, Format};
fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn log_formats_preserve_guides_and_strip_only_protocol_controls() {
    assert_eq!(
        logging::render(
            "warn",
            &units("first\n\nlast"),
            Format::Terminal,
            &units("▲"),
            &units("│")
        ),
        units("│\n▲  first\n│\n│  last\n")
    );
    assert_eq!(
        logging::render(
            "warn",
            &units("red\x1b[31m\r\nnext"),
            Format::Markdown,
            &[],
            &[]
        ),
        units("- **warning:** red next\n")
    );
    assert_eq!(
        logging::render(
            "info",
            &[0xd800, 10, 27, 91, 51, 49, 109],
            Format::Json,
            &[],
            &[]
        ),
        units("{\"level\":\"info\",\"message\":\"\\ud800\\n\"}\n")
    );
    assert_eq!(
        logging::strip(&units("a\x1b]secret\x07b\x1bPcontent\x1b\\c")),
        units("abcontentc")
    );
}
#[test]
fn log_symbols_use_owned_brand_and_theme_rules() {
    assert_eq!(
        logging::symbol("resolved", "blue", true, true),
        units("\x1b[38;2;47;111;237m◇\x1b[0m")
    );
    assert_eq!(
        logging::symbol("errorResolved", "purple", true, true),
        units("\x1b[38;2;204;0;0m■\x1b[0m")
    );
    assert_eq!(
        logging::symbol("info", "green", false, true),
        units("\x1b[35m●\x1b[0m")
    );
}
