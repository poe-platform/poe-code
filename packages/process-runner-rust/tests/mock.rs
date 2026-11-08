use process_runner_rust::mock::{self, Queue, Run, Stream};
#[test]
fn queues_consume_every_slot_and_exhaust_without_reusing_behaviors() {
    let mut queue = Queue::new(3);
    assert_eq!(queue.next_index(), Some(0));
    assert_eq!(queue.next_index(), Some(1));
    assert_eq!(queue.next_index(), Some(2));
    assert_eq!(queue.next_index(), None);
    assert_eq!(queue.next_index(), None);
    assert_eq!(Queue::new(0).next_index(), None);
}
#[test]
fn completion_is_exactly_once_and_streams_stop_idempotently() {
    let mut run = Run::default();
    assert!(run.finish());
    assert!(!run.finish());
    let mut stream = Stream::default();
    assert!(stream.emit());
    assert!(stream.stop());
    assert!(!stream.emit());
    assert!(!stream.stop());
}
#[test]
fn timing_admission_preserves_zero_output_completion_and_rejects_invalid_delays() {
    assert_eq!(mock::completion(None).unwrap(), mock::Completion::Output);
    assert_eq!(
        mock::completion(Some(0.0)).unwrap(),
        mock::Completion::Microtask
    );
    assert_eq!(
        mock::completion(Some(25.0)).unwrap(),
        mock::Completion::Timer(25.0)
    );
    for delay in [f64::NAN, f64::INFINITY, -1.0] {
        assert_eq!(
            mock::completion(Some(delay)).unwrap_err(),
            mock::DELAY_ERROR
        );
    }
    let missing = mock::missing_command(&[0xd800]);
    assert!(missing.contains(&0xd800));
}
