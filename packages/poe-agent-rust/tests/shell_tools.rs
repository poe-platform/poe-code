use poe_agent_rust::shell_tools::{RetainedOutput, timeout_ms, validate_policy};
fn units(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn output_keeps_exact_utf16_tail_and_omitted_count() {
    let mut out = RetainedOutput::default();
    out.append(&vec![120; 131070]);
    out.append(&[0xd83c, 0xdf0d, 0xd800]);
    let value = out.format();
    assert!(value.starts_with(&units("[output truncated: 1 characters omitted]\n")));
    assert_eq!(&value[value.len() - 3..], &[0xd83c, 0xdf0d, 0xd800]);
}
#[test]
fn policy_checks_quoted_wrappers_segments_and_write_options() {
    assert_eq!(
        validate_policy(&units("bash -lc 'git status --short'"), "read"),
        None
    );
    assert_eq!(
        validate_policy(&units("git -C . diff --output=x"), "read"),
        Some(units("Command \"git\" is not allowed in read mode."))
    );
    assert_eq!(
        validate_policy(&units("git status; mkdir tmp"), "read"),
        Some(units("Command \"mkdir\" is not allowed in read mode."))
    );
    assert_eq!(
        validate_policy(&units("rm -fr tmp"), "edit"),
        Some(units("Command \"rm -rf\" is blocked in edit mode."))
    );
    assert_eq!(
        validate_policy(&units("curl --request=POST https://example.test"), "edit"),
        Some(units(
            "Command \"curl\" is blocked in edit mode because it performs a network write."
        ))
    );
    assert_eq!(timeout_ms(None).unwrap(), 120000.0);
    assert!(timeout_ms(Some(0.0)).is_err());
    assert!(timeout_ms(Some(601.0)).is_err());
}
