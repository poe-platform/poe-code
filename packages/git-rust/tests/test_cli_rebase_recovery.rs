use git_rust::{MemoryFs, execute_git_cli};
fn ok(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}
fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    ok(&fs, &["init", "-b", "main"]);
    ok(&fs, &["config", "user.name", "Configured"]);
    ok(&fs, &["config", "user.email", "configured@example.com"]);
    save(&fs, "file", "base\n", "base");
    fs
}
fn save(fs: &MemoryFs, path: &str, text: &str, message: &str) -> String {
    fs.write_str(&format!("/repo/{path}"), text);
    ok(fs, &["add", path]);
    ok(fs, &["commit", "-m", message]);
    ok(fs, &["rev-parse", "HEAD"]).trim().into()
}
#[test]
fn rebase_continue_replays_remaining_commits_and_preserves_branch() {
    let fs = repo();
    ok(&fs, &["checkout", "-b", "topic"]);
    save(&fs, "file", "topic\n", "conflicting");
    save(&fs, "later", "later\n", "remaining");
    ok(&fs, &["checkout", "main"]);
    save(&fs, "file", "main\n", "upstream");
    ok(&fs, &["checkout", "topic"]);
    assert_ne!(
        execute_git_cli(&fs, "/repo", &["rebase", "main"]).exit_code,
        0
    );
    fs.write_str("/repo/file", "resolved\n");
    ok(&fs, &["add", "file"]);
    ok(&fs, &["rebase", "--continue"]);
    assert_eq!(ok(&fs, &["rev-parse", "--abbrev-ref", "HEAD"]), "topic\n");
    assert_eq!(fs.read_str("/repo/later").as_deref(), Some("later\n"));
    assert_eq!(
        ok(&fs, &["log", "-2", "--format=%s"]),
        "remaining\nconflicting\n"
    );
    assert_eq!(fs.read_str("/repo/file").as_deref(), Some("resolved\n"));
}
#[test]
fn rebase_skip_abort_fast_forward_and_onto() {
    for operation in ["--skip", "--abort"] {
        let fs = repo();
        ok(&fs, &["checkout", "-b", "topic"]);
        save(&fs, "file", "topic\n", "conflict");
        let original = save(&fs, "later", "later\n", "later");
        ok(&fs, &["checkout", "main"]);
        save(&fs, "file", "main\n", "main");
        ok(&fs, &["checkout", "topic"]);
        assert_ne!(
            execute_git_cli(&fs, "/repo", &["rebase", "main"]).exit_code,
            0
        );
        ok(&fs, &["rebase", operation]);
        assert_eq!(ok(&fs, &["rev-parse", "--abbrev-ref", "HEAD"]), "topic\n");
        assert_eq!(fs.read_str("/repo/later").as_deref(), Some("later\n"));
        if operation == "--abort" {
            assert_eq!(ok(&fs, &["rev-parse", "HEAD"]).trim(), original);
            assert_eq!(fs.read_str("/repo/file").as_deref(), Some("topic\n"));
        } else {
            assert_eq!(fs.read_str("/repo/file").as_deref(), Some("main\n"));
            assert_eq!(ok(&fs, &["log", "-2", "--format=%s"]), "later\nmain\n");
        }
        assert!(!fs.exists("/repo/.git/rebase-merge"));
        assert_ne!(
            execute_git_cli(&fs, "/repo", &["rebase", "--continue"]).exit_code,
            0
        );
    }
    let fs = repo();
    ok(&fs, &["branch", "topic"]);
    let main = save(&fs, "new", "new\n", "new");
    ok(&fs, &["checkout", "topic"]);
    ok(&fs, &["rebase", "main"]);
    assert_eq!(ok(&fs, &["rev-parse", "HEAD"]).trim(), main);
    assert_eq!(ok(&fs, &["rev-parse", "--abbrev-ref", "HEAD"]), "topic\n");
    let old = save(&fs, "old", "old\n", "old");
    save(&fs, "last", "last\n", "last");
    ok(&fs, &["rebase", "--onto", "main", &old]);
    assert!(!fs.exists("/repo/old"));
    assert_eq!(ok(&fs, &["log", "-2", "--format=%s"]), "last\nnew\n");
}
