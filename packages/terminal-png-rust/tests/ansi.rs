use terminal_png_rust::ansi::parse;
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn rendered(s: &str) -> String {
    String::from_utf16_lossy(
        &parse(&u(s))
            .into_iter()
            .flat_map(|run| run.text)
            .collect::<Vec<_>>(),
    )
}
#[test]
fn terminal_cursor_cells_and_erase() {
    for (input, output) in [
        ("hello\rX", "Xello"),
        ("old line\nsecond\u{1b}[2J\u{1b}[Hnew", "new"),
        ("\u{1b}[shello\u{1b}[uX", "Xello"),
        ("A\tB\u{1b}[9GC", "A       C"),
        ("测\u{1b}[3GZ", "测Z"),
    ] {
        assert_eq!(rendered(input), output);
    }
}
#[test]
fn unicode_utf16_and_styles() {
    let runs = parse(&u("a\u{1b}[1;38:2::12:34:56mb\u{1b}[22;39mc"));
    assert_eq!(runs.len(), 3);
    assert!(runs[1].style.bold);
    assert!(!runs[2].style.bold);
    assert_eq!(runs[1].style.fg.as_ref().unwrap().rgb(), Some((12, 34, 56)));
    assert_eq!(parse(&[0xd800, 0x61])[0].text, vec![0xd800, 0x61]);
}
#[test]
fn osc_malformed_and_capped_display() {
    assert_eq!(
        rendered("a\u{1b}]8;;https://example\u{7}b\u{1b}]8;;\u{1b}\\c"),
        "abc"
    );
    assert_eq!(rendered("a\u{1b}[38;2;4mB"), "aB");
    assert_eq!(
        parse(&u("top\u{1b}[100000Bbottom"))
            .iter()
            .filter(|run| run.text == u("\n"))
            .count(),
        999
    );
    assert!(rendered(&format!("{}\tZ", "a".repeat(1100))).len() <= 1000);
}
#[test]
fn extended_graphemes_preserve_utf16_boundaries() {
    use terminal_png_rust::grapheme::segments;
    for (text, lengths) in [
        ("e\u{301}x", vec![2, 1]),
        ("👩‍💻│", vec![5, 1]),
        ("🇺🇸🇵🇱", vec![4, 4]),
        ("क्‍क", vec![4]),
        ("\r\nx", vec![2, 1]),
    ] {
        assert_eq!(
            segments(&u(text))
                .iter()
                .map(|r| r.len())
                .collect::<Vec<_>>(),
            lengths
        );
    }
}
