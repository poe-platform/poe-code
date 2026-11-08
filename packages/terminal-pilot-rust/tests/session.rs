use terminal_pilot_rust::session::{CloseAction, Pilot, Session};
fn units(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn session_retains_rewrites_chunked_controls_and_screen_independently() {
    let mut s = Session::new(units("test"), 12.0, 3.0, 0.0).unwrap();
    s.data(&units("loading 0%\rloading 100%\r\n\x1b[3"), 2.0)
        .unwrap();
    s.data(&units("2mready\x1b[0m"), 3.0).unwrap();
    assert_eq!(
        s.history(None).unwrap(),
        vec![units("loading 100%"), units("ready")]
    );
    assert_eq!(s.history(Some(0.0)).unwrap(), Vec::<Vec<u16>>::new());
    assert_eq!(s.history(Some(1.0)).unwrap(), vec![units("ready")]);
    s.data(&units("\x1b[2J\x1b[Hfresh"), 4.0).unwrap();
    assert!(s.match_string(&units("ready"), false).is_some());
    assert!(s.match_string(&units("ready"), true).is_none());
    assert_eq!(s.match_string(&units("fresh"), true), Some(units("fresh")));
}
#[test]
fn lifecycle_validation_precedes_effects_and_exit_is_once() {
    for n in [f64::NAN, f64::INFINITY, 0.0, -1.0, 1.5] {
        assert!(Session::new(units("s"), n, 3.0, 0.0).is_err());
    }
    let mut s = Session::new(units("s"), 12.0, 3.0, 0.0).unwrap();
    for n in [f64::NAN, f64::INFINITY, -1.0] {
        assert!(s.validate_wait(n, "history").is_err());
        assert!(s.quiet_remaining(n, 0.0).is_err());
    }
    assert!(s.validate_wait(1.0, "wrong").is_err());
    assert!(s.history(Some(1.5)).is_err());
    assert!(s.mark_exit(7));
    assert!(!s.mark_exit(9));
    assert_eq!(s.exit_code(), Some(7));
    assert!(s.input(&units("late")).is_err());
    s.resize(8.0, 2.0).unwrap();
    assert_eq!(s.size(), (8, 2));
}
#[test]
fn fill_quiet_and_wait_boundaries_are_owned_policies() {
    let mut s = Session::new(units("s"), 12.0, 3.0, 0.0).unwrap();
    assert_eq!(s.fill(&units("a\r\nb\nc\r")), Ok(units("a\rb\rc\r")));
    s.data(&units("abc\x08!\rxy\n"), 5.0).unwrap();
    assert_eq!(s.history(None).unwrap(), vec![units("xy!")]);
    assert_eq!(s.quiet_remaining(20.0, 10.0), Ok(15.0));
    assert_eq!(s.quiet_remaining(20.0, 25.0), Ok(0.0));
    assert!(s.wait_error(10.0, 10.0, &units("absent")).is_none());
    assert!(s.wait_error(10.1, 10.0, &units("absent")).is_some());
    s.mark_exit(0);
    assert!(
        String::from_utf16_lossy(&s.wait_error(1.0, 10.0, &units("absent")).unwrap())
            .contains("exited")
    );
}
#[test]
fn close_escalates_and_can_restart_after_failed_effect() {
    let mut s = Session::new(units("s"), 12.0, 3.0, 0.0).unwrap();
    s.begin_close(0.0);
    assert_eq!(s.close_step(0.0), Ok(CloseAction::Wait(250.0)));
    assert_eq!(s.close_step(250.0), Ok(CloseAction::Signal(15)));
    s.abort_close();
    s.begin_close(250.0);
    assert_eq!(s.close_step(500.0), Ok(CloseAction::Signal(15)));
    s.signal_sent(500.0);
    assert_eq!(s.close_step(1500.0), Ok(CloseAction::Signal(9)));
    s.signal_sent(1500.0);
    assert!(s.close_step(2500.0).unwrap_err().contains("SIGKILL"));
    s.mark_exit(137);
    assert_eq!(s.close_step(2500.0), Ok(CloseAction::Done(137)));
}
#[test]
fn registry_preserves_order_and_failed_shutdown_retention() {
    let mut p = Pilot::default();
    p.register(units("a")).unwrap();
    p.register(units("b")).unwrap();
    assert!(p.register(units("a")).is_err());
    p.exited(&units("a"));
    assert_eq!(p.ids(true), vec![units("b")]);
    assert_eq!(p.ids(false), vec![units("a"), units("b")]);
    p.remove(&units("a"));
    assert!(!p.contains(&units("a")));
    assert!(p.contains(&units("b")));
}
