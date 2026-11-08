use agent_harness_tools_rust::logs::{file_name, slug_label};
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn ascii_slugs_preserve_underscores_and_collapse_unicode_and_surrogates() {
    for (input, expected) in [
        ("My Feature", "my-feature"),
        ("_Fix--Bug_", "_fix-bug_"),
        ("--é😀--", ""),
        ("v2.0__ok", "v2-0__ok"),
    ] {
        assert_eq!(slug_label(&u(input)), u(expected));
    }
    assert_eq!(slug_label(&[65, 0xd800, 0xdfff, 66]), u("a-b"));
}
#[test]
fn filenames_pad_utc_components_preserve_year_and_use_role_fallback() {
    let date = ["2026", "4", "18", "19", "50", "7", "123"].map(u);
    assert_eq!(
        file_name(&u("Inspector: Code Quality"), &date),
        u("20260418-195007-123-inspector-code-quality.jsonl")
    );
    let date = ["-1", "1", "1", "0", "0", "0", "0"].map(u);
    assert_eq!(file_name(&u("?"), &date), u("-10101-000000-000-role.jsonl"));
}
