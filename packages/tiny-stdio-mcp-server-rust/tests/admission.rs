use tiny_stdio_mcp_server_rust::admission::{Admission, ToolAdmission};

#[test]
fn bounded_fifo_capacity_retains_running_work_until_release() {
    let mut admission = ToolAdmission::new(2, 2).unwrap();
    assert_eq!(admission.acquire(1).unwrap(), Admission::Running);
    assert_eq!(admission.acquire(2).unwrap(), Admission::Running);
    assert_eq!(admission.acquire(3).unwrap(), Admission::Queued);
    assert_eq!(admission.acquire(4).unwrap(), Admission::Queued);
    assert_eq!(
        admission.acquire(5).unwrap_err(),
        "Too many queued tool calls"
    );
    assert!(!admission.cancel_queued(1));
    assert_eq!(admission.release(1), Some(3));
    assert_eq!(admission.release(1), None);
    assert_eq!(admission.acquire(5).unwrap(), Admission::Queued);
    assert_eq!(admission.release(2), Some(4));
    assert_eq!(admission.release(3), Some(5));
    assert_eq!(admission.release(4), None);
    assert_eq!(admission.release(5), None);
    assert_eq!(admission.acquire(6).unwrap(), Admission::Running);
}

#[test]
fn canceled_waiters_are_removed_without_releasing_active_capacity() {
    let mut admission = ToolAdmission::new(1, 1).unwrap();
    admission.acquire(1).unwrap();
    admission.acquire(2).unwrap();
    assert!(admission.cancel_queued(2));
    assert!(!admission.cancel_queued(2));
    assert_eq!(admission.acquire(3).unwrap(), Admission::Queued);
    assert!(admission.acquire(1).is_err());
    assert!(admission.acquire(3).is_err());
    assert_eq!(admission.release(1), Some(3));
    assert_eq!(admission.release(999), None);
    assert!(ToolAdmission::new(0, 1).is_err());
    let mut no_queue = ToolAdmission::new(1, 0).unwrap();
    no_queue.acquire(1).unwrap();
    assert!(no_queue.acquire(2).is_err());
}
