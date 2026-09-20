use tiny_mcp_client_rust::sse::SseParser;
fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn event_framing_preserves_cursor_and_discards_partial_eof() {
    let mut parser = SseParser::new(1024).unwrap();
    assert!(
        parser
            .push(&units("id: one\ndata: first\r"))
            .unwrap()
            .is_empty()
    );
    let messages = parser.push(&units("\n\r\ndata: second\r\r")).unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].data, units("first"));
    assert_eq!(messages[0].id, Some(units("one")));
    assert_eq!(messages[1].id, None);
    parser
        .push(&units("id: unseen\ndata: unfinished\n"))
        .unwrap();
    parser.flush();
    assert_eq!(parser.last_event_id(), Some(units("one")));
}
#[test]
fn limits_apply_to_lines_and_aggregate_fields_without_retaining_comments() {
    let mut parser = SseParser::new(16).unwrap();
    assert!(
        parser
            .push(&units(&":ping\n".repeat(64)))
            .unwrap()
            .is_empty()
    );
    parser.push(&units("data: 12345678\n")).unwrap();
    assert!(parser.push(&units("data: 12345678\n")).is_err());
    assert!(SseParser::new(0).is_err());
    let mut parser = SseParser::new(16).unwrap();
    assert!(parser.push(&units("data: 😃😃😃")).is_err());
    let mut parser = SseParser::new(16).unwrap();
    assert_eq!(
        parser
            .push(&units(&"data: 12345678\n\n".repeat(32)))
            .unwrap()
            .len(),
        32
    );
}
#[test]
fn utf16_chunks_and_event_selection_match_event_source_fields() {
    let mut parser = SseParser::new(1024).unwrap();
    let mut first = units("data: ");
    first.push(0xd83e);
    parser.push(&first).unwrap();
    let messages = parser.push(&[0xdd8a, 10, 10]).unwrap();
    assert_eq!(messages[0].data, vec![0xd83e, 0xdd8a]);
    assert!(
        parser
            .push(&units("event: other\nid: non-message\ndata: ignored\n\n"))
            .unwrap()
            .is_empty()
    );
    assert_eq!(parser.last_event_id(), Some(units("non-message")));
    let messages = parser
        .push(&units("id: bad\0id\ndata\ndata: tail\n\n"))
        .unwrap();
    assert_eq!(messages[0].data, units("\ntail"));
    assert_eq!(messages[0].id, None);
}
