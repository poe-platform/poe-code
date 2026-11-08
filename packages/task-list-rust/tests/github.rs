use task_list_rust::github::{issue_number, parse_repo, resolve_state};
fn text(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn canonical_decimal_issue_identity() {
    for (id, number) in [
        ("1", 1),
        ("123", 123),
        ("9007199254740991", 9007199254740991),
    ] {
        assert_eq!(issue_number(&text(id)), Some(number));
    }
    for id in [
        "",
        "0",
        "01",
        "+1",
        "1.0",
        "1e2",
        " 1",
        "１",
        "9007199254740992",
        "99999999999999999999999999",
    ] {
        assert_eq!(issue_number(&text(id)), None, "{id}");
    }
}
#[test]
fn repository_identity_is_exact_not_trimmed() {
    assert_eq!(
        parse_repo(&text("owner/name")),
        Some((text("owner"), text("name")))
    );
    assert_eq!(
        parse_repo(&text(" owner/ name")),
        Some((text(" owner"), text(" name")))
    );
    for repo in ["", "owner", "owner/", "/name", "a/b/c"] {
        assert_eq!(parse_repo(&text(repo)), None);
    }
    assert_eq!(
        parse_repo(&[0xd800, 47, 0xdfff]),
        Some((vec![0xd800], vec![0xdfff]))
    );
}
#[test]
fn label_state_prefers_machine_order_and_preserves_fallback() {
    let states = ["draft", "planned", "done"].map(text).to_vec();
    let labels = ["state:done", "state:planned"].map(text).to_vec();
    assert_eq!(
        resolve_state(
            &labels,
            Some(&text("Status")),
            &states,
            &text("draft"),
            Some(&text("state:"))
        ),
        text("planned")
    );
    assert_eq!(
        resolve_state(
            &labels,
            Some(&text("Status")),
            &states,
            &text("draft"),
            None
        ),
        text("Status")
    );
    assert_eq!(
        resolve_state(&[], None, &states, &text("draft"), Some(&text("state:"))),
        text("draft")
    );
}
