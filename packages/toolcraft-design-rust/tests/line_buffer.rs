use toolcraft_design_rust::line_buffer::LineBuffer;
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn framing_is_transactional_and_preserves_hidden_filter_state() {
    let mut b = LineBuffer::default();
    let (lines, tail) = b.prepare(&u("first\r\nnext\x1b]hidden"));
    assert_eq!(lines, vec![u("first")]);
    assert_eq!(b.preview(), u(""));
    assert_eq!(b.line(&lines[0]), u("first"));
    b.line_emitted();
    b.finish(&tail);
    assert_eq!(b.preview(), u("next"));
    let (lines, tail) = b.prepare(&u("\x07 final\n"));
    assert_eq!(lines, vec![u("next final")]);
    b.line_emitted();
    b.finish(&tail);
    assert!(!b.has_pending());
}
#[test]
fn pending_is_bounded_and_omission_clears_after_successful_line() {
    let mut b = LineBuffer::default();
    let (_, tail) = b.prepare(&u(&"x".repeat(20000)));
    b.finish(&tail);
    assert!(b.preview().len() <= 16384);
    assert!(String::from_utf16_lossy(&b.preview()).contains("Output truncated"));
    let (lines, tail) = b.prepare(&u("\nclean"));
    assert!(b.line(&lines[0]).len() <= 16384);
    b.line_emitted();
    b.finish(&tail);
    assert_eq!(b.preview(), u("clean"));
    b.reset_pending();
    assert!(!b.has_pending());
}
