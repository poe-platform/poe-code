use poe_code_config_rust::state;
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn job_ids_exclude_path_escape_components_without_rejecting_utf16() {
    for s in ["", ".", "..", "one/two", "one\\two", "one\0two"] {
        assert!(!state::safe_job_id(&u(s), false));
    }
    for s in ["job-1", " a ", "...", "__proto__", "constructor"] {
        assert!(state::safe_job_id(&u(s), false));
    }
    assert!(!state::safe_job_id(&u("absolute"), true));
    assert!(state::safe_job_id(&[0xd800], false));
}
#[test]
fn statuses_and_integer_exit_codes() {
    for s in ["pending", "running", "exited", "killed", "lost"] {
        assert!(state::job_status(&u(s)));
    }
    for s in ["completed", "RUNNING", ""] {
        assert!(!state::job_status(&u(s)));
    }
    for n in [-1.0, 0.0, 2.0, 9007199254740992.0] {
        assert!(state::integer_exit_code(n));
    }
    for n in [1.5, f64::NAN, f64::INFINITY] {
        assert!(!state::integer_exit_code(n));
    }
}
