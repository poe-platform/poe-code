use tiny_http_mcp_server_rust::sse::format_event;
#[test]
fn sse_preserves_empty_lines_cr_lf_and_lone_surrogates() {
    let data = "a\r\nb\rc\n"
        .encode_utf16()
        .chain([0xd800])
        .collect::<Vec<_>>();
    let out = format_event(
        &data,
        Some(&"1".encode_utf16().collect::<Vec<_>>()),
        Some(&"message".encode_utf16().collect::<Vec<_>>()),
    );
    let expected = "id: 1\nevent: message\ndata: a\ndata: b\ndata: c\ndata: "
        .encode_utf16()
        .chain([0xd800])
        .chain("\n\n".encode_utf16())
        .collect::<Vec<_>>();
    assert_eq!(out, expected);
}
