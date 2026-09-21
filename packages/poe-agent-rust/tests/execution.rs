use poe_agent_rust::execution::{EventQueue, IterationLimit, Next, Push, RunState, StopFailure};

#[test]
fn queue_delivers_fifo_to_waiters_then_drains_buffer_after_close() {
    let mut queue = EventQueue::<u32, u32>::default();
    assert_eq!(queue.take(), Next::Wait);
    queue.wait(10);
    queue.wait(11);
    assert_eq!(
        queue.push(1),
        Push::Deliver {
            waiter: 10,
            item: 1
        }
    );
    assert_eq!(
        queue.push(2),
        Push::Deliver {
            waiter: 11,
            item: 2
        }
    );
    assert_eq!(queue.push(3), Push::Buffered);
    assert_eq!(queue.push(4), Push::Buffered);
    queue.wait(12);
    assert_eq!(queue.close(), vec![12]);
    assert!(queue.close().is_empty());
    assert_eq!(queue.push(5), Push::Discard(5));
    assert_eq!(queue.take(), Next::Item(3));
    assert_eq!(queue.take(), Next::Item(4));
    assert_eq!(queue.take(), Next::Closed);
}

#[test]
fn terminal_stop_and_successful_disposal_are_once_only_but_failed_disposal_retries() {
    let mut run = RunState::default();
    assert!(run.accept_event());
    assert!(!run.stop_started());
    run.start_stop();
    assert!(run.stop_started());
    assert!(!run.disposed());
    assert!(!run.disposed()); // A rejected disposal does not settle the state.
    run.finish_disposal();
    assert!(run.disposed());
    assert!(run.accept_terminal());
    assert!(!run.accept_event());
    assert!(!run.accept_terminal());
}

#[test]
fn iteration_limits_and_model_stop_classification_match_number_semantics() {
    let mut run = RunState::default();
    assert_eq!(run.next_iteration(Some(1.0)), Ok(1.0));
    assert_eq!(run.next_iteration(Some(1.0)), Err(IterationLimit));
    for maximum in [None, Some(f64::NAN), Some(f64::INFINITY)] {
        assert_eq!(RunState::default().next_iteration(maximum), Ok(1.0));
    }
    assert_eq!(
        RunState::default().next_iteration(Some(-1.0)),
        Err(IterationLimit)
    );
    assert_eq!(
        RunState::default().next_iteration(Some(0.5)),
        Err(IterationLimit)
    );
    assert_eq!(StopFailure::classify("error"), Some(StopFailure::Model));
    assert_eq!(
        StopFailure::classify("max_tokens"),
        Some(StopFailure::TokenLimit)
    );
    assert_eq!(StopFailure::classify("end_turn"), None);
}
