use mcp_protocol_rust::strings::trim_ecmascript;
#[test]
fn trimming_uses_ecmascript_whitespace_and_preserves_utf16_units() {
    assert_eq!(
        trim_ecmascript(&[0xfeff, 0x2000, 0xd800, 0x3000]),
        &[0xd800]
    );
    for unit in [0x85, 0x200b, 0x180e, 0xdfff] {
        assert_eq!(trim_ecmascript(&[unit]), &[unit]);
    }
    assert!(
        trim_ecmascript(&[
            9, 10, 11, 12, 13, 32, 0xa0, 0x1680, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
            0xfeff
        ])
        .is_empty()
    );
}
