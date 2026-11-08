use agent_harness_tools_rust::plans::{
    compare_readiness, file_id, queue_summary, readiness, readiness_label,
};
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn filenames_strip_only_valid_digit_prefix_and_exact_markdown_suffix() {
    for (name, id) in [
        ("01-feature.md", Some("feature")),
        ("01-.md", Some("01-")),
        (".md", Some("")),
        ("😀.md", Some("😀")),
        ("name.MD", None),
        ("notes", None),
    ] {
        assert_eq!(file_id(&u(name)), id.map(u));
    }
}
#[test]
fn readiness_validation_and_presentation_are_exact() {
    assert_eq!(readiness(None), Some(u("draft")));
    assert_eq!(readiness(Some(&u("ready"))), Some(u("ready")));
    assert_eq!(readiness(Some(&u("READY"))), None);
    assert_eq!(readiness_label(&u("plan"), true), u("plan ✓"));
    assert_eq!(readiness_label(&u("plan"), false), u("plan"));
    assert_eq!(compare_readiness(true, false), -1);
    assert_eq!(compare_readiness(false, true), 1);
}
#[test]
fn queue_summary_omits_empty_messages_and_pending_counts() {
    assert_eq!(
        queue_summary(1, 2, 1, 4, 3),
        u("1/2 plans · 1/4 messages · 3 pending")
    );
    assert_eq!(queue_summary(1, 1, 0, 0, 0), u("1/1 plans"));
    assert_eq!(queue_summary(0, 0, 0, 0, 0), u("0/0 plans"));
}
