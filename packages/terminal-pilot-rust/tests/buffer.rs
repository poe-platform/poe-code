use terminal_pilot_rust::buffer::Buffer;
fn write(buffer: &mut Buffer, value: &str) {
    buffer
        .write(&value.encode_utf16().collect::<Vec<_>>())
        .unwrap();
}
fn line(buffer: &Buffer, row: usize) -> String {
    String::from_utf16_lossy(&buffer.render_line(row))
}
#[test]
fn chunks_styles_wrap_and_cursor_are_persistent() {
    let mut b = Buffer::new(6, 3).unwrap();
    write(&mut b, "abcdefg");
    assert_eq!(line(&b, 0), "abcdef");
    assert_eq!(line(&b, 1), "g");
    assert_eq!(b.cursor(), (1, 1));
    write(&mut b, "\x1b[");
    write(&mut b, "31mR\x1b[0m!");
    assert_eq!(line(&b, 1), "g\x1b[31mR\x1b[0m!");
    write(&mut b, "\x1b[2;1H\x1b[2Kx");
    assert_eq!(line(&b, 1), "x");
}
#[test]
fn wide_graphemes_and_resize_keep_cells_valid() {
    let mut b = Buffer::new(8, 3).unwrap();
    write(&mut b, "e");
    write(&mut b, "\u{0301}测");
    assert_eq!(line(&b, 0), "e\u{0301}测");
    assert_eq!(b.cursor(), (3, 0));
    b.resize(2, 2).unwrap();
    assert_eq!(line(&b, 0), "e\u{0301}");
    assert_eq!(b.cursor(), (1, 0));
    assert!(b.resize(0, 1).is_err());
    assert!(Buffer::new(999999, 999999).is_err());
}
#[test]
fn scrolling_alternate_screens_and_saved_styles() {
    let mut b = Buffer::new(8, 2).unwrap();
    write(&mut b, "one\r\ntwo\r\nthree");
    assert_eq!(line(&b, 0), "two");
    assert_eq!(line(&b, 1), "three");
    write(&mut b, "\x1b[?1049hother\x1b[?1049l");
    assert_eq!(line(&b, 1), "three");
    write(&mut b, "\x1b[1;31m\x1b7\x1b[0m\x1b[H!\x1b8X");
    assert!(line(&b, 1).contains("\x1b[1;31mX"));
}
