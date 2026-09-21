use poe_agent_rust::file_awareness::{Effect, Tracker, path_allowed, tool_effect};
fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn awareness_owns_ordered_deduplicated_read_and_write_paths() {
    let mut tracker = Tracker::default();
    tracker.read(&text("a"));
    tracker.read(&text("a"));
    tracker.write(&text("b"));
    tracker.write(&text("a"));
    let mut snapshot = tracker.snapshot();
    assert_eq!(snapshot.read, vec![text("a")]);
    assert_eq!(snapshot.modified, vec![text("b"), text("a")]);
    snapshot.read[0].push(1);
    assert_eq!(tracker.snapshot().read, vec![text("a")]);
    assert!(!path_allowed(&text(" \u{feff} ")));
    assert!(path_allowed(&text(" x ")));
    assert_eq!(tool_effect(&text("read_file")), Effect::Read);
    assert_eq!(tool_effect(&text("write_file")), Effect::Write);
    assert_eq!(tool_effect(&text("edit")), Effect::Edit);
    assert_eq!(tool_effect(&text(" read_file ")), Effect::Ignore);
}
