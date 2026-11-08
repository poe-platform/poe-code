use config_mutations_rust::backup::safe_timestamp;
#[test]
fn filename_timestamp_formats_utf16_without_calendar_or_platform_dependencies() {
    for (input, expected) in [
        ("2026-09-20T12:34:56.789Z", "2026-09-20T12-34-56-789Z"),
        ("+010000-01-01T00:00:00.000Z", "+010000-01-01T00-00-00-000Z"),
        ("🦀:.value", "🦀--value"),
    ] {
        assert_eq!(
            safe_timestamp(&input.encode_utf16().collect::<Vec<_>>()),
            expected.encode_utf16().collect::<Vec<_>>()
        );
    }
    assert_eq!(
        safe_timestamp(&[0xd800, 58, 0xdc00, 46]),
        [0xd800, 45, 0xdc00, 45]
    );
}
