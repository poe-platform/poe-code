use tiny_stdio_mcp_server_rust::stdio::{InputError, LineInput};

fn strings(lines: Vec<Vec<u16>>) -> Vec<String> {
    lines
        .into_iter()
        .map(|line| String::from_utf16(&line).unwrap())
        .collect()
}

#[test]
fn frames_cr_lf_crlf_and_final_unterminated_lines_across_every_byte_boundary() {
    let source = "one\r\n\r\ntwé🦀\nthree\rfour";
    for boundary in 0..=source.len() {
        let mut input = LineInput::new(64).unwrap();
        let mut lines = Vec::new();
        input
            .push_bytes(&source.as_bytes()[..boundary], |line| lines.push(line))
            .unwrap();
        input
            .push_bytes(&source.as_bytes()[boundary..], |line| lines.push(line))
            .unwrap();
        input.finish(|line| lines.push(line)).unwrap();
        assert_eq!(
            strings(lines),
            ["one", "", "twé🦀", "three", "four"],
            "{boundary}"
        );
    }
}

#[test]
fn admits_exact_byte_budget_and_preserves_preceding_lines_when_a_later_line_overflows() {
    let mut input = LineInput::new(4).unwrap();
    let mut lines = Vec::new();
    assert_eq!(
        input.push_bytes("🦀\nxxxxx\nlater\n".as_bytes(), |line| lines.push(line)),
        Err(InputError::LineLimit)
    );
    assert_eq!(strings(lines), ["🦀"]);
    assert_eq!(input.push_bytes(b"x", |_| {}), Err(InputError::Closed));
}

#[test]
fn rejects_invalid_utf8_as_soon_as_the_prefix_is_invalid_and_incomplete_utf8_at_eof() {
    for source in [
        &[0xff][..],
        &[0x80],
        &[0xc0],
        &[0xed, 0xa0],
        &[0xf4, 0x90],
        &[0xf0, 0x9f, b'\n'],
    ] {
        let mut input = LineInput::new(64).unwrap();
        assert_eq!(
            input.push_bytes(source, |_| panic!("No altered line may be emitted")),
            Err(InputError::InvalidUtf8)
        );
    }
    let mut input = LineInput::new(64).unwrap();
    input.push_bytes(&[0xf0, 0x9f], |_| {}).unwrap();
    assert_eq!(input.finish(|_| {}), Err(InputError::InvalidUtf8));
}

#[test]
fn utf16_chunks_preserve_lone_surrogates_and_charge_pairs_as_four_utf8_bytes() {
    let mut input = LineInput::new(4).unwrap();
    let mut lines = Vec::new();
    input
        .push_utf16(&[0xd83e], |line| lines.push(line))
        .unwrap();
    input
        .push_utf16(&[0xdd80, 10, 0xd800, 10], |line| lines.push(line))
        .unwrap();
    assert_eq!(lines, [vec![0xd83e, 0xdd80], vec![0xd800]]);
    input.finish(|_| panic!("No trailing empty line")).unwrap();
    assert_eq!(input.finish(|_| {}), Err(InputError::Closed));
}

#[test]
fn string_chunks_do_not_repair_incomplete_utf8_bytes() {
    let mut input = LineInput::new(64).unwrap();
    input.push_bytes(&[0xf0, 0x9f], |_| {}).unwrap();
    assert_eq!(
        input.push_utf16(&[0x61], |_| {}),
        Err(InputError::InvalidUtf8)
    );
}

#[test]
fn per_line_capacity_resets_and_zero_capacity_is_rejected() {
    assert!(matches!(LineInput::new(0), Err(InputError::InvalidLimit)));
    let mut input = LineInput::new(1).unwrap();
    let mut lines = Vec::new();
    input
        .push_bytes(b"a\rb\nc\r\nd", |line| lines.push(line))
        .unwrap();
    input.finish(|line| lines.push(line)).unwrap();
    assert_eq!(strings(lines), ["a", "b", "c", "d"]);
}
