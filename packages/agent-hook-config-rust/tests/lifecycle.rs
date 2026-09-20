use agent_hook_config_rust::lifecycle::{Owners, PriorGroups, cleanup_file};
use mcp_protocol_rust::json::{self, Limits, Value};
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn j(text: &str) -> Value {
    json::parse(text.as_bytes(), Limits::default()).unwrap()
}
#[test]
fn duplicate_caller_ids_have_independent_ownership_and_release_reuses_available_ids() {
    let mut owners = Owners::default();
    let path = u("/repo/hooks.json");
    let first = owners.acquire(&path, &u("run")).unwrap();
    assert_eq!(first.id, u("run"));
    assert!(!first.overlaps);
    let second = owners.acquire(&path, &u("run")).unwrap();
    assert_eq!(second.id, u("run:1"));
    assert!(second.overlaps);
    owners.release(&path, &first.id);
    let third = owners.acquire(&path, &u("run")).unwrap();
    assert_eq!(third.id, u("run"));
    assert!(third.overlaps);
    owners.release(&path, &second.id);
    owners.release(&path, &third.id);
    assert!(owners.is_empty());
}
#[test]
fn cleanup_preserves_user_handlers_other_owners_prior_empty_events_matchers_and_unknown_fields() {
    let prior = j(
        r#"{"preferences":{"enabled":true},"hooks":{"Stop":[{"matcher":"","hooks":[]}],"SessionStart":[]}}"#,
    );
    let groups = PriorGroups::from_file(Some(&prior)).unwrap();
    let file = j(
        r#"{"preferences":{"enabled":true},"hooks":{"Stop":[{"matcher":"","note":"retained","hooks":[{"command":"user"},{"statusMessage":"[generated:poe-code:run] gone"},{"statusMessage":"[generated:poe-code:run:1] live"}]},{"matcher":"Bash","hooks":[{"statusMessage":"[generated:poe-code:run] gone"}]}],"SessionStart":[],"PreToolUse":[{"hooks":[{"statusMessage":"[generated:poe-code:run] gone"}]}]}}"#,
    );
    let result = cleanup_file(file, &u("run"), &groups, &u("/repo/hooks.json")).unwrap();
    assert!(!result.only_empty_hooks);
    assert_eq!(
        result.file,
        j(
            r#"{"preferences":{"enabled":true},"hooks":{"Stop":[{"matcher":"","note":"retained","hooks":[{"command":"user"},{"statusMessage":"[generated:poe-code:run:1] live"}]}],"SessionStart":[]}}"#
        )
    );
}
#[test]
fn cleanup_retains_empty_preexisting_groups_and_preserves_missing_empty_matcher_distinction() {
    let prior = j(r#"{"hooks":{"Stop":[{"hooks":[]},{"matcher":"","hooks":[]}]}}"#);
    let groups = PriorGroups::from_file(Some(&prior)).unwrap();
    let file = j(
        r#"{"hooks":{"Stop":[{"hooks":[{"statusMessage":"[generated:poe-code:run] gone"}]},{"matcher":"","hooks":[{"statusMessage":"[generated:poe-code:run] gone"}]},{"matcher":"new","hooks":[{"statusMessage":"[generated:poe-code:run] gone"}]}]}}"#,
    );
    let result = cleanup_file(file, &u("run"), &groups, &u("/repo/hooks.json")).unwrap();
    assert_eq!(result.file, prior);
    assert!(!result.only_empty_hooks);
    let empty = cleanup_file(
        j(r#"{"hooks":{"Stop":[{"hooks":[{"statusMessage":"[generated:poe-code:run] gone"}]}]}}"#),
        &u("run"),
        &PriorGroups::default(),
        &u("/repo/hooks.json"),
    )
    .unwrap();
    assert_eq!(empty.file, j(r#"{"hooks":{}}"#));
    assert!(empty.only_empty_hooks);
}
