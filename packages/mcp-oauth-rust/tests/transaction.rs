use mcp_oauth_rust::transaction::{Queue, timeout};
#[test]
fn transaction_tickets_preserve_resource_order_and_retire_owned_waits() {
    let mut queue = Queue::default();
    let resource: Vec<u16> = "resource".encode_utf16().collect();
    let other: Vec<u16> = "other".encode_utf16().collect();
    let first = queue.enqueue(&resource).unwrap();
    assert_eq!(first.previous, None);
    let waiter = queue.enqueue(&resource).unwrap();
    assert_eq!(waiter.previous, Some(first.id));
    let unrelated = queue.enqueue(&other).unwrap();
    assert_eq!(unrelated.previous, None);
    let next = queue.enqueue(&resource).unwrap();
    assert_eq!(next.previous, Some(waiter.id));
    assert_eq!(queue.resources(), 2);
    assert!(!queue.retire(&other, first.id));
    assert!(queue.retire(&resource, first.id));
    assert!(queue.retire(&resource, waiter.id));
    assert!(queue.retire(&resource, next.id));
    assert!(queue.retire(&other, unrelated.id));
    assert_eq!(queue.resources(), 0);
    assert_eq!(queue.enqueue(&resource).unwrap().previous, None);
}
#[test]
fn timeout_policy_accepts_only_schedulable_positive_integers() {
    for valid in [1.0, 30_000.0, 2_147_483_647.0] {
        assert_eq!(timeout(valid), Ok(valid as u32));
    }
    for invalid in [0.0, -1.0, 1.5, f64::INFINITY, f64::NAN, 2_147_483_648.0] {
        assert!(
            timeout(invalid)
                .unwrap_err()
                .contains("sessionLockTimeoutMs")
        );
    }
}
