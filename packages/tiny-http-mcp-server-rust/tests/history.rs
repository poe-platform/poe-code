use std::sync::Arc;
use tiny_http_mcp_server_rust::history::History;
#[test]
fn bounded_replay_evicts_old_payloads_and_releases_snapshots_after_drop() {
    let mut history = History::new(2);
    let data = Arc::new(vec![12; 4096]);
    let weak = Arc::downgrade(&data);
    history.record(vec![1], 1, data.clone());
    drop(data);
    let snapshot = history.replay(&[1], 0);
    assert_eq!(snapshot.len(), 1);
    for i in 2..4096 {
        history.record(vec![1], i, Arc::new(vec![i as u16]));
    }
    assert_eq!(history.len(&[1]), 2);
    assert!(weak.upgrade().is_some());
    drop(snapshot);
    assert!(weak.upgrade().is_none());
    assert_eq!(history.replay(&[1], 4094).len(), 1);
    history.remove(&[1]);
    assert_eq!(history.len(&[1]), 0);
}
