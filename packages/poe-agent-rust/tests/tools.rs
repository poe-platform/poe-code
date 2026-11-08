use poe_agent_rust::tools::{ToolCatalog, Visibility, active_skills, visible};
fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn catalogs_keep_registration_order_and_overwrite_without_moving_entries() {
    let mut catalog = ToolCatalog::default();
    assert_eq!(catalog.upsert(text("a")), 0);
    assert_eq!(catalog.upsert(text("b")), 1);
    assert_eq!(catalog.upsert(text("a")), 0);
    assert_eq!(catalog.get(&text(" b ")), Some(1));
    assert_eq!(catalog.get(&text("missing")), None);
    assert_eq!(catalog.len(), 2);
}
#[test]
fn active_skills_match_exact_names_and_dot_or_underscore_namespaces() {
    let skills = active_skills(&[
        text(" repo.* "),
        text("repo.*"),
        text("\u{feff}"),
        text("tool"),
    ]);
    assert_eq!(skills, vec![text("repo.*"), text("tool")]);
    assert!(visible(&text("repo_read"), Visibility::Skill, &skills));
    assert!(visible(&text("repo.read"), Visibility::Skill, &skills));
    assert!(visible(&text("tool"), Visibility::Skill, &skills));
    assert!(!visible(
        &text("repository_read"),
        Visibility::Skill,
        &skills
    ));
    assert!(!visible(&text("repo_read"), Visibility::Internal, &skills));
    assert!(visible(&text("ordinary"), Visibility::Model, &[]));
    assert!(!visible(&text("repo"), Visibility::Skill, &skills));
    assert!(!visible(
        &text("anything"),
        Visibility::Skill,
        &[text(".*")]
    ));
}
