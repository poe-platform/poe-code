use process_runner_rust::ignore::DockerIgnore;
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn ignore_rules_preserve_parent_exclusion_and_allow_explicit_parent_reopening() {
    let matcher = DockerIgnore::new(&u("foo/\n!foo/keep.txt"));
    assert!(matcher.ignores(&u("foo/keep.txt"), false));
    assert!(!matcher.ignores(&u("foo"), false));
    assert!(matcher.ignores(&u("foo"), true));
    let matcher = DockerIgnore::new(&u("foo/*\n!foo/keep.txt"));
    assert!(!matcher.ignores(&u("foo/keep.txt"), false));
    assert!(matcher.ignores(&u("foo/other"), false));
    let matcher = DockerIgnore::new(&u("*\n!foo/\n!foo/keep.txt"));
    assert!(!matcher.ignores(&u("foo/keep.txt"), false));
    assert!(matcher.ignores(&u("foo/other"), false));
}
#[test]
fn matchers_cover_anchoring_globstars_classes_casefold_and_escaped_markers() {
    let matcher = DockerIgnore::new(&u(
        "/root\na/**/z\n**/deep\n*.JS\nfile?.[ch]\n\\#literal\n\\!literal\nspace\\ \nabc\\",
    ));
    for path in [
        "root",
        "root/x",
        "a/z",
        "a/x/y/z",
        "deep",
        "x/deep",
        "a.JS",
        "nested/a.js",
        "file1.c",
        "#literal",
        "!literal",
        "space ",
    ] {
        assert!(matcher.ignores(&u(path), false), "{path}");
    }
    for path in ["nested/root", "a/x/y", "file12.c", "space", "abc", "abc\\"] {
        assert!(!matcher.ignores(&u(path), false), "{path}");
    }
    let matcher = DockerIgnore::new(&u("a/**"));
    assert!(!matcher.ignores(&u("a"), true));
    assert!(matcher.ignores(&u("a/x"), false));
}
#[test]
fn wildcard_matching_uses_utf16_units_and_bounded_dynamic_work() {
    let matcher = DockerIgnore::new(&u("?"));
    assert!(!matcher.ignores(&u("😀"), false));
    assert!(matcher.ignores(&u("é"), false));
    assert!(matcher.ignores(&[0xd800], false));
    let pattern = format!("{}z", "*a".repeat(96));
    let matcher = DockerIgnore::new(&u(&pattern));
    assert!(!matcher.ignores(&u(&"a".repeat(192)), false));
}
