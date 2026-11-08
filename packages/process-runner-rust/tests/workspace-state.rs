use process_runner_rust::workspace_state::{self, State};
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn upload_limit_is_checked_before_inventory_and_finite_mb_can_overflow_to_unbounded_bytes() {
    for mb in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        assert_eq!(
            workspace_state::max_bytes(mb).unwrap_err(),
            workspace_state::LIMIT_ERROR
        );
    }
    assert_eq!(workspace_state::max_bytes(1.0).unwrap(), 1048576.0);
    assert!(workspace_state::max_bytes(f64::MAX).unwrap().is_infinite());
}
#[test]
fn content_states_distinguish_uploaded_skipped_modified_and_matching_remote_bytes() {
    let path = u("a");
    let mut state = State::default();
    assert!(!state.admit(&path, b"old", 2.0));
    assert!(state.conflict(&path, b"new", Some(b"local")));
    assert!(!state.conflict(&path, b"new", Some(b"old")));
    assert!(!state.conflict(&path, b"new", Some(b"new")));
    assert!(!state.conflict(&path, b"new", None));
    assert!(state.deletions(&[]).is_empty());
    assert!(state.admit(&path, b"old", 3.0));
    assert!(state.same(&path, b"old"));
    assert!(!state.same(&path, b"new"));
    assert_eq!(state.deletions(&[]), vec![path.clone()]);
    assert!(state.deletions(&[path]).is_empty());
}
#[test]
fn deletion_order_stays_stable_after_updates_and_binary_hashes_do_not_alias() {
    let mut state = State::default();
    for path in ["a", "b", "c"] {
        state.admit(&u(path), &[0, 255, 128], 100.0);
    }
    state.admit(&u("a"), b"updated", 100.0);
    assert_eq!(state.deletions(&[u("b")]), vec![u("a"), u("c")]);
    assert!(!state.same(&u("c"), &[0, 255, 129]));
    assert_eq!(workspace_state::warning(&[0xd800], 3), {
        let mut expected = u("Skipping ");
        expected.push(0xd800);
        expected.extend(u(": 3 bytes exceeds upload_max_file_mb."));
        expected
    });
}
