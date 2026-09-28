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

