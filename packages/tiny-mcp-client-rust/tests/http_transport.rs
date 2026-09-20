use tiny_mcp_client_rust::http_transport::{HttpState, ResponseKind, response_kind};

fn units(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
fn modern(id: &str) -> Vec<u16> {
    units(&format!(
        r#"{{"jsonrpc":"2.0","id":{id},"method":"ping","params":{{"_meta":{{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}}}}"#
    ))
}

#[test]
fn modern_request_slots_match_cancellation_and_duplicate_id_settlement() {
    let mut state = HttpState::default();
    let first = state.prepare(&modern("1")).unwrap();
    let second = state.prepare(&modern("1")).unwrap();
    state.finish(&first);
    let cancel = state
        .prepare(&units(
            r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}"#,
        ))
        .unwrap();
    assert!(cancel.cancelled);
    assert_eq!(cancel.cancel_slot, second.slot);
    state.finish(&second);
    let cancel = state
        .prepare(&units(
            r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}"#,
        ))
        .unwrap();
    assert_eq!(cancel.cancel_slot, None);
    assert_eq!(state.active_count(), 0);
}

#[test]
fn legacy_session_identity_and_get_reconnect_are_sticky_and_disposal_is_once() {
    let mut state = HttpState::default();
    state.capture_session(Some(&units("session"))).unwrap();
    state.capture_session(Some(&[])).unwrap();
    assert!(state.capture_session(Some(&units("other"))).is_err());
    assert!(state.begin_get());
    assert!(!state.begin_get());
    assert!(!state.finish_get());
    state.set_event_id(Some(units("cursor")));
    assert!(state.begin_get());
    assert!(state.finish_get());
    let disposed = state.dispose().unwrap();
    assert_eq!(disposed.session, Some(units("session")));
    assert!(state.dispose().is_none());
    assert!(!state.begin_get());
}

#[test]
fn response_media_types_require_exact_normalized_mime_and_ignore_202() {
    assert_eq!(
        response_kind(200, Some(" Application/JSON ; charset=utf-8")),
        ResponseKind::Json
    );
    assert_eq!(
        response_kind(200, Some("text/event-stream; charset=utf-8")),
        ResponseKind::Sse
    );
    assert_eq!(response_kind(202, Some("text/plain")), ResponseKind::Ignore);
    assert_eq!(response_kind(200, None), ResponseKind::Ignore);
    assert_eq!(
        response_kind(200, Some("text/plain; hint=application/json")),
        ResponseKind::Unsupported
    );
}

#[test]
fn finished_modern_request_churn_releases_every_native_slot() {
    let mut state = HttpState::default();
    for index in 0..4096 {
        let post = state.prepare(&modern(&index.to_string())).unwrap();
        state.finish(&post);
        assert_eq!(state.active_count(), 0);
    }
}
