use git_rust::{CliResult, MemoryFs, execute_git_cli};

fn run(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}

fn history() -> (MemoryFs, String, String) {
    let fs = MemoryFs::new();
    run(&fs, &["init"]);
    run(&fs, &["config", "user.name", "Tester"]);
    run(&fs, &["config", "user.email", "t@e.st"]);
    fs.write("/repo/a.txt", b"one\n");
    fs.write("/repo/sub/b.txt", b"two\n");
    run(&fs, &["add", "."]);
    run(&fs, &["commit", "-m", "first"]);
    let first = run(&fs, &["rev-parse", "HEAD"]).trim().to_string();
    fs.write("/repo/a.txt", b"changed\n");
    run(&fs, &["rm", "sub/b.txt"]);
    run(&fs, &["add", "."]);
    run(&fs, &["commit", "-m", "second"]);
    let second = run(&fs, &["rev-parse", "HEAD"]).trim().to_string();
    (fs, first, second)
}

#[test]
fn staged_deletion_status() {
    let (fs, first, _) = history();
    run(&fs, &["reset", "--hard", &first]);
    run(&fs, &["rm", "sub/b.txt"]);
    for flag in ["-s", "--porcelain"] {
        assert_eq!(run(&fs, &["status", flag]), "D  sub/b.txt\n");
    }
}

#[test]
fn ancestry_across_commands() {
    let (fs, first, second) = history();
    for rev in ["HEAD~", "HEAD~1", "HEAD^", "HEAD^1", "HEAD~0^1", "HEAD^1~0"] {
        assert_eq!(run(&fs, &["rev-parse", rev]).trim(), first);
        assert_eq!(run(&fs, &["show", &format!("{rev}:a.txt")]), "one\n");
        assert!(run(&fs, &["show", rev]).contains("first"));
        assert!(run(&fs, &["diff", rev]).contains("-one"));
    }
    assert_eq!(
        run(&fs, &["log", "--format=%s", "HEAD~1..HEAD"]),
        "second\n"
    );
    for rev in [
        "HEAD~2",
        "HEAD^2",
        "HEAD~-1",
        "HEAD^x",
        "HEAD~99999999999999999999999",
    ] {
        let CliResult { exit_code, .. } = execute_git_cli(&fs, "/repo", &["rev-parse", rev]);
        assert_ne!(exit_code, 0, "{rev}");
    }
    run(&fs, &["checkout", "HEAD~1"]);
    assert_eq!(run(&fs, &["rev-parse", "HEAD"]).trim(), first);
    run(&fs, &["checkout", &second]);
    run(&fs, &["reset", "--hard", "HEAD^"]);
    assert_eq!(run(&fs, &["rev-parse", "HEAD"]).trim(), first);
    assert_eq!(fs.read("/repo/a.txt").unwrap(), b"one\n");
}

#[test]
fn abbreviated_show_and_restore_sources() {
    let (fs, first, _) = history();
    assert_eq!(
        run(&fs, &["show", &format!("{}:a.txt", &first[..7])]),
        "one\n"
    );
    for args in [
        vec!["restore", "--source=HEAD~1", "a.txt"],
        vec!["restore", "-sHEAD^", "a.txt"],
        vec!["restore", "--source", "HEAD^", "a.txt"],
    ] {
        fs.write("/repo/a.txt", b"dirty\n");
        run(&fs, &args);
        assert_eq!(fs.read("/repo/a.txt").unwrap(), b"one\n");
    }
    run(
        &fs,
        &[
            "restore",
            "--staged",
            "--worktree",
            "--source=HEAD^",
            "a.txt",
        ],
    );
    assert_eq!(run(&fs, &["diff", "--cached", "--name-only"]), "a.txt\n");
    assert_ne!(
        execute_git_cli(&fs, "/repo", &["restore", "--source"]).exit_code,
        0
    );
}

#[test]
fn symmetric_ranges_and_deleted_paths() {
    let (fs, first, second) = history();
    assert_eq!(
        run(&fs, &["log", "--format=%s", "HEAD~1...HEAD"]),
        "second\n"
    );
    assert_eq!(
        run(&fs, &["log", "--format=%s", "sub/b.txt"]),
        "second\nfirst\n"
    );
    assert_eq!(run(&fs, &["log", "--format=%s", "sub"]), "second\nfirst\n");
    assert_eq!(
        run(&fs, &["diff", "--name-only", &first, "sub"]),
        "sub/b.txt\n"
    );
    run(&fs, &["checkout", "-b", "side"]);
    run(&fs, &["reset", "--hard", &first]);
    fs.write("/repo/side.txt", b"side\n");
    run(&fs, &["add", "."]);
    run(&fs, &["commit", "-m", "side"]);
    let symmetric = run(&fs, &["log", "--format=%s", &format!("{second}...HEAD")]);
    let mut messages: Vec<_> = symmetric.lines().collect();
    messages.sort();
    assert_eq!(messages, ["second", "side"]);
    run(&fs, &["merge", &second]);
    assert_eq!(run(&fs, &["rev-parse", "HEAD^2"]).trim(), second);
    assert_eq!(run(&fs, &["rev-parse", "HEAD~2"]).trim(), first);
}

#[test]
fn branch_creation_start_points() {
    for (command, flag) in [("checkout", "-b"), ("switch", "-c")] {
        let (fs, first, _) = history();
        run(&fs, &[command, flag, "older", "HEAD~1"]);
        assert_eq!(run(&fs, &["rev-parse", "HEAD"]).trim(), first);
        assert_eq!(fs.read("/repo/a.txt").unwrap(), b"one\n");
        assert!(run(&fs, &["branch"]).contains("* older"));
    }
}

#[test]
fn ancestry_in_remaining_commands() {
    for rev in ["HEAD~1", "HEAD^", "HEAD^{commit}~1"] {
        let (fs, first, second) = history();
        run(&fs, &["branch", "older", rev]);
        run(&fs, &["tag", "old", rev]);
        assert_eq!(run(&fs, &["rev-parse", "older"]).trim(), first);
        assert_eq!(run(&fs, &["rev-parse", "old"]).trim(), first);
        run(&fs, &["branch", "feature"]);
        run(&fs, &["checkout", "feature"]);
        fs.write("/repo/tip.txt", b"tip\n");
        run(&fs, &["add", "."]);
        run(&fs, &["commit", "-m", "tip"]);
        run(&fs, &["checkout", "master"]);
        run(&fs, &["reset", "--hard", &first]);
        run(&fs, &["merge", "feature~1"]);
        assert_eq!(run(&fs, &["rev-parse", "HEAD"]).trim(), second);
        run(&fs, &["reset", "--hard", &first]);
        run(&fs, &["cherry-pick", "feature^"]);
        assert_eq!(fs.read("/repo/a.txt").unwrap(), b"changed\n");
    }
}

#[test]
fn checkout_paths_without_separator() {
    let (fs, _, second) = history();
    fs.write("/repo/a.txt", b"staged\n");
    run(&fs, &["add", "a.txt"]);
    for path in ["a.txt", "."] {
        fs.write("/repo/a.txt", b"dirty\n");
        run(&fs, &["checkout", path]);
        assert_eq!(fs.read("/repo/a.txt").unwrap(), b"staged\n");
        assert_eq!(run(&fs, &["rev-parse", "HEAD"]).trim(), second);
    }
}

#[test]
fn index_and_tree_revision_objects() {
    let (fs, first, second) = history();
    fs.write("/repo/a.txt", b"staged\n");
    run(&fs, &["add", "a.txt"]);
    fs.write("/repo/a.txt", b"dirty\n");
    for rev in [":a.txt", ":0:a.txt"] {
        assert_eq!(run(&fs, &["show", rev]), "staged\n");
    }
    for rev in ["HEAD^{}", "HEAD^{commit}"] {
        assert_eq!(run(&fs, &["rev-parse", rev]).trim(), second);
    }
    run(&fs, &["tag", "-a", "annotated", "-m", "tag"]);
    assert_eq!(run(&fs, &["rev-parse", "annotated^{}"]).trim(), second);
    assert_eq!(
        run(&fs, &["rev-parse", "annotated^{commit}^"]).trim(),
        first
    );
    let blob = run(&fs, &["hash-object", "a.txt"]);
    assert_eq!(
        run(&fs, &["rev-parse", ":a.txt"]).trim(),
        run(&fs, &["rev-parse", ":0:a.txt"]).trim()
    );
    assert_ne!(run(&fs, &["rev-parse", "HEAD:a.txt"]), blob);
    assert_eq!(
        run(&fs, &["rev-parse", "HEAD^{tree}"]),
        run(&fs, &["rev-parse", "HEAD:"])
    );
    assert_ne!(
        execute_git_cli(&fs, "/repo", &["show", ":1:a.txt"]).exit_code,
        0
    );
    assert_ne!(
        execute_git_cli(&fs, "/repo", &["rev-parse", "HEAD^{blob}"]).exit_code,
        0
    );
}

#[test]
fn annotated_tag_start_point() {
    let (fs, first, _) = history();
    run(&fs, &["tag", "-a", "older", "HEAD^", "-m", "message"]);
    assert_eq!(run(&fs, &["rev-parse", "older^{commit}"]).trim(), first);
}
