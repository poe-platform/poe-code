use git_rust::{MemoryFs, execute_git_cli};

fn ok(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}

fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    ok(&fs, &["init", "-b", "main"]);
    ok(&fs, &["config", "user.name", "Tester"]);
    ok(&fs, &["config", "user.email", "t@example.com"]);
    for n in 1..=2 {
        fs.write_str("/repo/f.txt", &format!("v{n}\n"));
        ok(&fs, &["add", "f.txt"]);
        ok(&fs, &["commit", "-m", &format!("c{n}")]);
        ok(
            &fs,
            &["tag", "-a", &format!("v{n}"), "-m", &format!("tag v{n}")],
        );
    }
    fs
}

#[test]
fn symmetric_diff_peels_annotated_tags_on_either_side() {
    let fs = repo();
    ok(&fs, &["tag", "-a", "nested", "-m", "outer", "v1"]);
    let expected = ok(&fs, &["diff", "HEAD~1...HEAD"]);
    assert!(expected.contains("-v1\n+v2\n"));
    for range in ["v1...v2", "nested...v2", "v1...HEAD", "HEAD~1...v2"] {
        assert_eq!(ok(&fs, &["diff", range]), expected);
    }
}

#[test]
fn show_annotated_tags_displays_metadata_and_peeled_commit_oid() {
    let fs = repo();
    let commit = ok(&fs, &["rev-parse", "v1^{}"]);
    let tag = ok(&fs, &["rev-parse", "v1"]);
    let shown = ok(&fs, &["show", "v1"]);
    assert!(
        shown.starts_with("tag v1\nTagger: Tester <t@example.com>\nDate:   "),
        "{shown}"
    );
    assert!(
        shown.contains(&format!("\n\ntag v1\n\ncommit {}\n", commit.trim())),
        "{shown}"
    );
    assert!(!shown.contains(&format!("commit {}", tag.trim())));
    assert!(shown.contains("+v1\n"));
    ok(&fs, &["tag", "-a", "nested", "-m", "outer", "v1"]);
    let nested = ok(&fs, &["show", "nested"]);
    assert!(nested.starts_with("tag nested\nTagger:"));
    assert!(nested.contains("\n\nouter\n\ntag v1\n"));
    assert!(nested.ends_with(&ok(&fs, &["show", "v1^{}"])));
    ok(&fs, &["tag", "light", "v1^{}"]);
    assert_eq!(ok(&fs, &["show", "light"]), ok(&fs, &["show", "v1^{}"]));
}

