use poe_agent_rust::builtin_plugins::{
    ArgumentKind, Scratchpad, SkillCatalog, StringSet, argument_failure, iteration_exceeded,
    policy_failure,
};
fn utf(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn scratchpad_preserves_utf16_and_replaces_notes_without_retaining_prior_values() {
    let mut notes = Scratchpad::default();
    let key = vec![0xD800];
    assert_eq!(notes.read(&key), None);
    notes.write(key.clone(), utf("first"));
    notes.write(key.clone(), vec![0xDFFF]);
    assert_eq!(notes.read(&key), Some(&[0xDFFF][..]));
}
#[test]
fn skill_catalog_formats_only_active_definitions_in_caller_order() {
    let mut skills = SkillCatalog::default();
    skills.insert(
        utf("repo"),
        vec![utf("read"), utf("git")],
        vec![utf("code")],
    );
    skills.insert(utf("empty"), vec![], vec![]);
    assert_eq!(skills.guidance_lines(&[utf("missing")]), None);
    assert_eq!(
        skills.guidance_lines(&[utf("empty"), utf("repo")]),
        Some(vec![
            utf("Active skills: empty, repo"),
            utf("- repo: tools: read, git | tags: code")
        ])
    );
    let mut set = StringSet::default();
    assert!(!set.admit(vec![]));
    assert!(set.admit(utf("repo")));
    assert!(!set.admit(utf("repo")));
}
#[test]
fn scalar_validation_and_policy_diagnostics_preserve_number_boundaries() {
    assert_eq!(
        argument_failure(ArgumentKind::Number, false, None, false),
        Some("must be a finite number")
    );
    assert_eq!(
        argument_failure(ArgumentKind::Number, true, Some(f64::INFINITY), false),
        Some("must be a finite number")
    );
    assert_eq!(
        argument_failure(ArgumentKind::NonNegativeInteger, true, Some(-0.0), false),
        None
    );
    assert_eq!(
        argument_failure(ArgumentKind::NonNegativeInteger, true, Some(0.5), false),
        Some("must be a non-negative integer")
    );
    assert_eq!(
        argument_failure(ArgumentKind::RequiredString, true, None, true),
        Some("must not be empty")
    );
    assert!(!iteration_exceeded(1.0, f64::NAN));
    assert!(iteration_exceeded(2.0, 1.0));
    assert_eq!(
        policy_failure(&utf("echo"), &utf("read"), true),
        utf("Tool \"echo\" does not declare policy metadata and is blocked in read mode.")
    );
}
