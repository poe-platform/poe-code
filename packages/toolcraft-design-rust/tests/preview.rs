use toolcraft_design_rust::preview::{
    MAX_CHARS, NOTICE, PreviewBuffer, TerminalStringFilter, limit, retain_tail,
};
fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn terminal_filter_preserves_complete_csi_and_removes_hidden_strings_across_chunks() {
    let mut filter = TerminalStringFilter::default();
    assert_eq!(filter.push(&text("a\x1b]private")), text("a"));
    assert_eq!(filter.push(&text("secret\x1b")), text(""));
    assert_eq!(filter.push(&text("\\b\x1b[3")), text("b"));
    assert_eq!(
        filter.push(&text("1mred\x1b[0m")),
        text("\x1b[31mred\x1b[0m")
    );
    assert!(filter.retained_units() <= 1024);
}
#[test]
fn preview_retains_a_bounded_latest_tail_without_splitting_surrogates() {
    let mut input = text(&"x".repeat(MAX_CHARS));
    input.extend(text("🌍latest"));
    let result = limit(&input);
    assert!(result.len() <= MAX_CHARS);
    assert!(result.starts_with(&text(NOTICE)));
    assert!(result.ends_with(&text("🌍latest")));
    assert_eq!(retain_tail(&text("old\nlatest"), 8.0), text("latest"));
    assert_eq!(retain_tail(&text("a🌍b"), 2.0), text("b"));
    let mut buffer = PreviewBuffer::default();
    for _ in 0..65536 {
        buffer.push(&text("delta"));
    }
    assert!(buffer.retained_units() <= MAX_CHARS);
    assert!(buffer.text().starts_with(&text(NOTICE)));
}
