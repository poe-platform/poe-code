use agent_harness_tools_rust::paths::{contained, default_glob, matches_glob, merge_docs};
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn path_boundaries_reject_parent_and_absolute_paths() {
    for candidate in ["..", "../outside", "../../outside"] {
        assert!(!contained(&u(candidate), false, b'/' as u16));
    }
    for candidate in ["", ".", "..safe", "nested/../file"] {
        assert!(contained(&u(candidate), false, b'/' as u16));
    }
    assert!(!contained(&u("C:\\outside"), true, b'\\' as u16));
    assert!(!contained(&u("..\\outside"), false, b'\\' as u16));
    assert!(contained(&u("../outside"), false, b'\\' as u16));
}
#[test]
fn glob_policy_distinguishes_default_prefix_and_literal_case() {
    assert_eq!(default_glob(&u("pipeline/plans")), u("*.yaml"));
    assert!(!matches_glob(&u("x.md"), &u("x.md"), &u("*.md"), &[]));
    assert_eq!(default_glob(&u("pipeline")), u("*.md"));
    assert!(matches_glob(&u("A.MD"), &u("a.md"), &u("*.MD"), &u("*.md")));
    assert!(!matches_glob(
        &u("A.MD"),
        &u("a.md"),
        &u("a.md"),
        &u("a.md")
    ));
    assert!(matches_glob(&u("any"), &u("any"), &u("*"), &u("*")));
    assert!(!matches_glob(
        &u("plan.yml"),
        &u("plan.yml"),
        &u("*.yaml"),
        &u("*.yaml")
    ));
}
#[test]
fn project_overrides_global_by_exact_utf16_filename_and_preserves_map_order() {
    let global = vec![
        (u("shared.md"), u("global/shared.md")),
        (u("A.md"), u("global/A.md")),
    ];
    let project = vec![
        (u("shared.md"), u("project/shared.md")),
        (u("a.md"), u("project/a.md")),
        (u("shared.md"), u("project/last.md")),
    ];
    assert_eq!(
        merge_docs(global, project),
        vec![u("project/last.md"), u("global/A.md"), u("project/a.md")]
    );
}
