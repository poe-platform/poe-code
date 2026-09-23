use agent_spawn_rust::autonomous::Autonomous;

#[test]
fn timeout_budget_counts_total_attempts_and_stops_on_success() {
    let mut run = Autonomous::new(Some(3.0)).unwrap();
    assert_eq!(run.begin().unwrap(), 1.0);
    assert!(run.fail(true).unwrap());
    assert_eq!(run.begin().unwrap(), 2.0);
    run.succeed().unwrap();
    assert!(run.begin().is_err());
    assert!(run.fail(true).is_err());
}

#[test]
fn exhausted_timeouts_and_other_errors_are_terminal() {
    for timeout in [false, true] {
        let mut run = Autonomous::new(Some(1.0)).unwrap();
        run.begin().unwrap();
        assert!(!run.fail(timeout).unwrap());
        assert!(run.begin().is_err());
    }
    let mut run = Autonomous::new(Some(3.0)).unwrap();
    run.begin().unwrap();
    assert!(!run.fail(false).unwrap());
    assert!(run.begin().is_err());
}

#[test]
fn admission_and_settlement_are_once_per_attempt() {
    let mut run = Autonomous::new(Some(2.0)).unwrap();
    assert!(run.succeed().is_err());
    assert!(run.fail(true).is_err());
    run.begin().unwrap();
    assert!(run.begin().is_err());
    assert!(run.fail(true).unwrap());
    assert!(run.fail(true).is_err());
    assert_eq!(run.begin().unwrap(), 2.0);
    assert!(!run.fail(true).unwrap());
}

#[test]
fn invalid_budgets_are_rejected_before_admission() {
    for max in [-1.0, 0.0, 1.5, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(
            Autonomous::new(Some(max)).err().unwrap(),
            "spawnAutonomous maxTimeoutRetries must be an integer greater than or equal to 1."
        );
    }
}
