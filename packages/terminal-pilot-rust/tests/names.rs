use terminal_pilot_rust::names::Names;
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn pending_names_are_unique_and_failure_releases_reservations() {
    let mut n = Names::default();
    assert!(n.reserve(&u(" \u{feff}"), None).is_err());
    assert_eq!(n.reserve(&u("cmd"), None).unwrap(), (u("s1"), None));
    assert_eq!(n.reserve(&u("cmd"), None).unwrap(), (u("s2"), None));
    assert!(n.reserve(&u("cmd"), Some(&u("s1"))).is_err());
    n.release(&u("s1"));
    assert_eq!(n.reserve(&u("cmd"), None).unwrap(), (u("s1"), None));
    n.commit(&u("s1"), u("a"), true).unwrap();
    n.commit(&u("s2"), u("b"), true).unwrap();
    assert!(n.resolve(None).unwrap_err().contains("Multiple active"));
    n.set_active(&u("a"), false);
    assert_eq!(n.resolve(None).unwrap(), (u("s2"), u("b")));
    assert_eq!(n.resolve(Some(&u("s1"))).unwrap(), (u("s1"), u("a")));
    assert_eq!(
        n.reserve(&u("cmd"), Some(&u("s1"))).unwrap(),
        (u("s1"), Some(u("a")))
    );
    n.commit(&u("s1"), u("new-a"), true).unwrap();
    n.forget(&u("s1"), &u("a"));
    assert_eq!(n.resolve(Some(&u("s1"))).unwrap(), (u("s1"), u("new-a")));
}
#[test]
fn shutdown_admission_and_available_names_are_owned() {
    let mut n = Names::default();
    let empty_bytes = n.retained_bytes();
    assert!(n.resolve(None).unwrap_err().contains("No active"));
    n.reserve(&u("cmd"), Some(&u("alpha"))).unwrap();
    n.commit(&u("alpha"), u("a"), true).unwrap();
    assert!(
        n.resolve(Some(&u("missing")))
            .unwrap_err()
            .contains("Available sessions: alpha.")
    );
    assert!(n.retained());
    n.begin_shutdown();
    assert!(n.reserve(&u("cmd"), None).unwrap_err().contains("closing"));
    n.end_shutdown(false);
    assert!(n.retained());
    n.begin_shutdown();
    n.end_shutdown(true);
    assert!(!n.retained());
    assert_eq!(n.retained_bytes(), empty_bytes);
    assert!(n.reserve(&u("cmd"), Some(&u("\u{feff}"))).is_err());
    assert!(n.reserve(&u("cmd"), Some(&u("\u{85}"))).is_ok());
}
