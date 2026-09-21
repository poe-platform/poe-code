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

#[test]
fn endpoint_events_are_opt_in_bounded_and_preserved_across_chunks() {
    let input = units(
        "event: keepalive\ndata: ignored\n\nevent: endpoint\ndata: /messages?session=abc\n\n",
    );
    let mut ordinary = SseParser::new(1024).unwrap();
    assert!(ordinary.push(&input).unwrap().is_empty());
    for split in 0..=input.len() {
        let mut parser = SseParser::new(1024).unwrap().with_endpoint_events();
        let mut messages = parser.push(&input[..split]).unwrap();
        messages.extend(parser.push(&input[split..]).unwrap());
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].data, units("/messages?session=abc"));
        assert_eq!(messages[0].event, Some(units("endpoint")));
    }
    let mut bounded = SseParser::new(16).unwrap().with_endpoint_events();
    assert!(
        bounded
            .push(&units("event: endpoint\ndata: /messages\n\n"))
            .is_err()
    );
}

#[test]
fn arbitrary_named_events_are_an_explicit_streaming_mode() {
    let input = units(
        "event: response.output_text.delta\ndata: {\"delta\":\"hello\"}\n\nevent: error\ndata: failed\n\n",
    );
    let mut default = SseParser::new(1024).unwrap();
    assert!(default.push(&input).unwrap().is_empty());
    for split in 0..=input.len() {
        let mut parser = SseParser::new(1024).unwrap().with_all_events();
        let mut events = parser.push(&input[..split]).unwrap();
        events.extend(parser.push(&input[split..]).unwrap());
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].event, Some(units("response.output_text.delta")));
        assert_eq!(events[0].data, units("{\"delta\":\"hello\"}"));
        assert_eq!(events[1].event, Some(units("error")));
    }
    let mut bounded = SseParser::new(16).unwrap().with_all_events();
    assert!(bounded.push(&input).is_err());
}

#[test]
fn framing_failure_releases_partial_fields_and_preserves_only_completed_cursor() {
    let mut parser = SseParser::new(16).unwrap();
    parser.push(&units("id: saved\ndata: first\n\n")).unwrap();
    parser.push(&units("data: 12345678\n")).unwrap();
    assert!(parser.push(&units("data: 12345678\n")).is_err());
    assert_eq!(parser.last_event_id(), Some(units("saved")));
    for _ in 0..32 {
        let events = parser.push(&units("data: ok\n\n")).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, units("ok"));
        assert_eq!(events[0].id, None);
    }
}
