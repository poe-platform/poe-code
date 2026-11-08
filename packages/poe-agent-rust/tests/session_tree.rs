use poe_agent_rust::session_tree::Branch;
fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn branch_lookup_retains_latest_duplicate_and_detects_parent_cycles() {
    let mut branch = Branch::new(vec![text("a"), text("b"), text("a")]);
    assert_eq!(branch.find(&text("a")), Ok(Some(2)));
    assert_eq!(branch.find(&text("b")), Ok(Some(1)));
    assert_eq!(branch.find(&text("missing")), Ok(None));
    assert!(branch.find(&text("a")).is_err());
}
#[test]
fn borrowed_branch_names_keep_the_same_lookup_and_cycle_policy() {
    let names = [text("a"), text("b"), text("a")];
    let mut branch = Branch::borrowed(names.iter().map(Vec::as_slice));
    assert_eq!(branch.find(&text("a")), Ok(Some(2)));
    assert_eq!(branch.find(&text("b")), Ok(Some(1)));
    assert!(branch.find(&text("a")).is_err());
}
