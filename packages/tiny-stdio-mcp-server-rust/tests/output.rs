use tiny_stdio_mcp_server_rust::output::{LineOutput, OutputAction, OutputError};

#[test]
fn writes_stay_ordered_and_callback_before_return_does_not_advance_early() {
    let mut output = LineOutput::new(64).unwrap();
    let (a, actions) = output.enqueue("one".into()).unwrap();
    assert_eq!(
        actions,
        [OutputAction::Write {
            token: a,
            data: "one".into()
        }]
    );
    let (b, actions) = output.enqueue("two".into()).unwrap();
    assert!(actions.is_empty());
    assert!(output.completed(a).is_empty());
    assert_eq!(output.pending(), 2);
    assert_eq!(
        output.returned(a, true),
        [
            OutputAction::Complete { token: a },
            OutputAction::Write {
                token: b,
                data: "two".into()
            }
        ]
    );
    assert!(output.returned(b, true).is_empty());
    assert_eq!(output.completed(b), [OutputAction::Complete { token: b }]);
    assert_eq!(output.pending_bytes(), 0);
    assert_eq!(output.pending(), 0);
}

#[test]
fn backpressure_requires_both_callback_and_drain_in_either_order() {
    for drain_first in [false, true] {
        let mut output = LineOutput::new(64).unwrap();
        let (token, _) = output.enqueue("abc".into()).unwrap();
        output.returned(token, false);
        let first = if drain_first {
            output.drain()
        } else {
            output.completed(token)
        };
        assert!(first.is_empty());
        assert_eq!(output.pending_bytes(), 3);
        let second = if drain_first {
            output.completed(token)
        } else {
            output.drain()
        };
        assert_eq!(second, [OutputAction::Complete { token }]);
    }
}

#[test]
fn utf8_output_budget_includes_submitted_unsettled_frame_and_abort_releases_all() {
    let mut output = LineOutput::new(6).unwrap();
    let (a, _) = output.enqueue("🦀".into()).unwrap();
    let (b, _) = output.enqueue("é".into()).unwrap();
    assert_eq!(output.pending_bytes(), 6);
    assert_eq!(output.enqueue("x".into()), Err(OutputError::ByteLimit));
    assert_eq!(output.abort(), [a, b]);
    assert!(output.completed(a).is_empty());
    assert!(output.drain().is_empty());
    assert!(output.abort().is_empty());
    assert_eq!(output.pending_bytes(), 0);
    assert!(matches!(
        output.enqueue("x".into()),
        Err(OutputError::Closed)
    ));
}

#[test]
fn stale_callbacks_cannot_complete_another_active_frame() {
    let mut output = LineOutput::new(64).unwrap();
    let (a, _) = output.enqueue("one".into()).unwrap();
    output.returned(a, true);
    output.completed(a);
    let (b, _) = output.enqueue("two".into()).unwrap();
    output.returned(b, false);
    assert!(output.completed(a).is_empty());
    assert!(output.returned(a, true).is_empty());
    assert!(output.drain().is_empty());
    assert_eq!(output.completed(b), [OutputAction::Complete { token: b }]);
}
