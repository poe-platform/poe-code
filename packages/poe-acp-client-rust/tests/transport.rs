use poe_acp_client_rust::transport::{Step, Transport};
#[test]
fn disposal_escalation_is_owned_and_close_is_once() {
    let mut t = Transport::default();
    assert!(t.begin_dispose());
    assert!(!t.begin_dispose());
    assert_eq!(t.signal_result(true, 0.0), Step::Wait(1000.0));
    assert_eq!(t.step(999.0), Step::Wait(1.0));
    assert_eq!(t.step(1000.0), Step::Kill);
    assert_eq!(t.signal_result(true, 1000.0), Step::Wait(1000.0));
    assert_eq!(t.step(2000.0), Step::ForceClose);
    assert!(t.close());
    assert!(!t.close());
    assert_eq!(t.step(3000.0), Step::None);
}
#[test]
fn stderr_budget_preserves_latest_utf16_units() {
    let mut t = Transport::default();
    let text = vec![120; 65540];
    t.stderr(&text);
    assert_eq!(t.stderr_output().len(), 65536);
    t.stderr(&[0xd83e, 0xddea]);
    let text = t.stderr_output();
    assert_eq!(text.len(), 65536);
    assert_eq!(&text[text.len() - 2..], &[0xd83e, 0xddea]);
    assert!(t.begin_dispose());
    assert_eq!(t.signal_result(false, 0.0), Step::Close);
}
