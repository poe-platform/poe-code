use process_runner_rust::workspace_ignore::{Rules, Source};
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn rules(git: &str, poe: &str, exclude: &[&str]) -> Rules {
    Rules::new(
        &[Source {
            base: vec![],
            text: u(git),
        }],
        &u(poe),
        &exclude.iter().map(|text| u(text)).collect::<Vec<_>>(),
    )
}
#[test]
fn ordered_git_rules_preserve_parent_reopening_and_explicit_child_negation() {
    let ignored = rules("build/\n!build/keep.txt", "", &[]);
    assert!(ignored.ignores(&u("build/keep.txt")));
    let reopened = rules("build/\n!build/\n!build/keep.txt", "", &[]);
    assert!(!reopened.ignores(&u("build/keep.txt")));
    assert!(reopened.ignores(&u("build/drop.txt")));
    assert!(!reopened.ignores(&u("build")));
}
#[test]
fn additive_rules_never_reinclude_and_literal_question_classes_are_not_globs() {
    let ignored = rules(
        "*.tmp\n!keep.tmp",
        "!keep.tmp\n\\#private\nname?.[ch]",
        &["nested/", "!literal"],
    );
    for path in [
        "drop.tmp",
        "#private",
        "name?.[ch]",
        "nested/file",
        "!literal",
        ".git/config",
    ] {
        assert!(ignored.ignores(&u(path)), "{path}");
    }
    for path in ["keep.tmp", "name1.c", "main.ts"] {
        assert!(!ignored.ignores(&u(path)), "{path}");
    }
}
#[test]
fn nested_rules_use_scopes_case_sensitivity_and_path_globstar_segments() {
    let ignored = Rules::new(
        &[
            Source {
                base: vec![],
                text: u("root/**/secret\n/only-root"),
            },
            Source {
                base: u("nested"),
                text: u("*.tmp\n!keep.tmp"),
            },
        ],
        &[],
        &[],
    );
    for path in [
        "root/secret",
        "root/a/b/secret",
        "only-root",
        "nested/drop.tmp",
        "nested/dir/drop.tmp",
    ] {
        assert!(ignored.ignores(&u(path)), "{path}");
    }
    for path in [
        "x/root/secret",
        "nested/keep.tmp",
        "drop.tmp",
        "nested/UPPER.TMP",
        "x/only-root",
    ] {
        assert!(!ignored.ignores(&u(path)), "{path}");
    }
}
