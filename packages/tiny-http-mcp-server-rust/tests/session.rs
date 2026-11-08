use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tiny_http_mcp_server_rust::session::SessionTable;
#[test]
fn replacement_preserves_iteration_order_and_reinsert_moves_to_end() {
    let mut table = SessionTable::default();
    table.insert(vec![1], "first").unwrap();
    table.insert(vec![2], "second").unwrap();
    assert_eq!(table.insert(vec![1], "replacement").unwrap(), Some("first"));
    let (sequence, first) = table.next_after(None).unwrap();
    assert_eq!(*first, "replacement");
    table.remove(&[2]);
    table.insert(vec![2], "reinserted").unwrap();
    assert_eq!(*table.next_after(Some(sequence)).unwrap().1, "reinserted");
}
struct Payload(Arc<AtomicUsize>);
impl Drop for Payload {
    fn drop(&mut self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}
#[test]
fn thousands_of_session_replacements_and_deletions_release_payloads_and_indexes() {
    let dropped = Arc::new(AtomicUsize::new(0));
    let mut table = SessionTable::default();
    for i in 0..4096 {
        table
            .insert(vec![(i % 8) as u16], Payload(dropped.clone()))
            .unwrap();
    }
    assert_eq!(table.len(), 8);
    assert_eq!(table.index_len(), 8);
    assert_eq!(dropped.load(Ordering::SeqCst), 4088);
    for i in 0..8 {
        assert!(table.remove(&[i]).is_some())
    }
    assert_eq!(table.len(), 0);
    assert_eq!(table.index_len(), 0);
    assert_eq!(dropped.load(Ordering::SeqCst), 4096);
    table.insert(vec![12], Payload(dropped.clone())).unwrap();
    drop(table);
    assert_eq!(dropped.load(Ordering::SeqCst), 4097);
}
