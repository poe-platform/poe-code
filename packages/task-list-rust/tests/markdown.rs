use task_list_rust::markdown::{active_filename, split_document};
fn text(v: &str) -> Vec<u16> {
    v.encode_utf16().collect()
}
#[test]
fn document_fences_preserve_line_endings_and_remove_only_one_blank_line() {
    let (header, body) =
        split_document(&text("---\r\nname: x\r\n---\r\n\r\n\r\nBody\n"), false).unwrap();
    assert_eq!(header, text("name: x\r"));
    assert_eq!(body, text("\r\nBody\n"));
    assert_eq!(
        split_document(&[text("plain"), vec![0xd800]].concat(), true),
        Some((vec![], [text("plain"), vec![0xd800]].concat()))
    );
    assert_eq!(split_document(&text("plain"), false), None);
    assert_eq!(split_document(&text("---\nname: x"), true), None);
}
#[test]
fn numbered_filename_uses_ascii_decimal_prefix_and_full_utf16_id() {
    assert_eq!(
        active_filename(&text("01-ship.md")),
        Some((text("ship"), Some(1.0)))
    );
    assert_eq!(
        active_filename(&text("2026-roadmap.md")),
        Some((text("roadmap"), Some(2026.0)))
    );
    assert_eq!(
        active_filename(&text("2026-.md")),
        Some((text("2026-"), None))
    );
    assert_eq!(
        active_filename(&text("９-ship.md")),
        Some((text("９-ship"), None))
    );
    assert_eq!(
        active_filename(&[49, 45, 0xd800, 46, 109, 100]),
        Some((vec![0xd800], Some(1.0)))
    );
    for value in [".hidden.md", "a..b.md", "a.MD", "../x.md"] {
        assert_eq!(active_filename(&text(value)), None);
    }
}

#[test]
fn invalid_numbered_suffix_falls_back_to_whole_stem() {
    assert_eq!(
        active_filename(&text("01-.bad.md")),
        Some((text("01-.bad"), None))
    );
    assert_eq!(
        active_filename(&text("01-a\nb.md")),
        Some((text("01-a\nb"), None))
    );
}
