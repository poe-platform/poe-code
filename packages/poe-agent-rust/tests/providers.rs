use poe_agent_rust::{Registry, Resolution, safe_session_id, valid_tool_name};
#[test]
fn registry_preserves_unicode_identity_and_reports_both_contributors() {
    let mut registry = Registry::default();
    let name = vec![0xd800];
    assert!(registry.register(name.clone(), vec![65]).is_none());
    let collision = registry.register(name.clone(), vec![66]).unwrap();
    assert_eq!(collision.name, name);
    assert_eq!(collision.entries, vec![vec![65], vec![66]]);
}
#[test]
fn resolution_short_circuits_and_rejects_reentry() {
    let mut state = Resolution::default();
    assert_eq!(state.begin(3).unwrap(), Some(0));
    assert!(state.begin(3).is_err());
    assert_eq!(state.finish(false).unwrap(), None);
    assert_eq!(state.begin(3).unwrap(), Some(1));
    assert_eq!(state.finish(true).unwrap(), Some(1));
    assert_eq!(state.begin(3).unwrap(), None);
    assert!(state.finish(false).is_err());
}
#[test]
fn name_and_session_admission_do_not_use_regular_expressions() {
    assert!(valid_tool_name(&"a_A-9".encode_utf16().collect::<Vec<_>>()));
    assert!(!valid_tool_name(&[0xd800]));
    for id in ["", "\u{feff}", ".", "..", "a/b", "a\\b"] {
        assert!(!safe_session_id(&id.encode_utf16().collect::<Vec<_>>()));
    }
    assert!(safe_session_id(&[65, 0xd800]));
}
