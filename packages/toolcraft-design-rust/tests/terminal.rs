use toolcraft_design_rust::terminal::{grapheme_width, plain, truncate};
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn segments(text: &[u16]) -> Result<Vec<Vec<u16>>, ()> {
    Ok(text.iter().map(|c| vec![*c]).collect())
}
#[test]
fn plain_rows_apply_cursor_controls_and_concealment() {
    assert_eq!(
        plain(
            &u("old\rnew\x1b[K\nvisible\x1b[8msecret\x1b[28mafter"),
            segments
        )
        .unwrap(),
        u("new visible      after")
    );
    assert_eq!(
        plain(&u("abc\x08X\x1b]hidden\x07"), segments).unwrap(),
        u("abX")
    );
}
#[test]
fn widths_cover_combining_flags_wide_and_emoji_segments() {
    assert_eq!(grapheme_width(&u("界")), 2);
    assert_eq!(grapheme_width(&u("🇺🇸")), 2);
    assert_eq!(grapheme_width(&u("\u{301}")), 0);
    assert_eq!(truncate(&[u("a"), u("界"), u("b")], 3.), u("a…"));
}
