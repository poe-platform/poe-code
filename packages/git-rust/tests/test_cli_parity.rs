use git_rust::{CliResult, MemoryFs, execute_git_cli};

fn run(fs: &MemoryFs, args: &[&str]) -> CliResult {
    execute_git_cli(fs, "/repo", args)
}
fn ok(fs: &MemoryFs, args: &[&str]) -> String {
    let result = run(fs, args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}
fn commit(fs: &MemoryFs, content: &str, message: &str) -> String {
    fs.write_str("/repo/a.txt", content);
    ok(fs, &["add", "."]);
    ok(fs, &["commit", "-m", message]);
    ok(fs, &["rev-parse", "HEAD"]).trim().to_string()
}
fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    ok(&fs, &["init", "-b", "main"]);
    commit(&fs, "base\n", "base");
    fs
}

#[test]
fn porcelain_matches_short_status() {
    let fs = repo();
    fs.write_str("/repo/a.txt", "changed\n");
    for flag in ["--porcelain", "--porcelain=v1"] {
        assert_eq!(ok(&fs, &["status", flag]), " M a.txt\n");
    }
    ok(&fs, &["add", "a.txt"]);
    fs.write_str("/repo/a.txt", "changed again\n");
    fs.write_str("/repo/new.txt", "new\n");
    assert_eq!(
        ok(&fs, &["status", "--porcelain"]),
        "MM a.txt\n?? new.txt\n"
    );
}

#[test]
fn diff_disambiguates_paths_and_compares_two_revisions() {
    let fs = repo();
    ok(&fs, &["branch", "feature"]);
    commit(&fs, "main\n", "main");
    fs.write_str("/repo/a.txt", "working\n");
    assert_eq!(
        ok(&fs, &["diff", "a.txt"]),
        ok(&fs, &["diff", "--", "a.txt"])
    );
    let between = ok(&fs, &["diff", "feature", "main"]);
    assert!(between.contains("-base\n+main\n"), "{between}");
    assert!(!between.contains("working"));
    assert_eq!(
        between,
        ok(&fs, &["diff", "feature", "main", "--", "a.txt"])
    );
    let from_revision = ok(&fs, &["diff", "feature", "a.txt"]);
    assert!(from_revision.contains("-base\n+working\n"));
    fs.write_str("/repo/sub/file", "sub\n");
    ok(&fs, &["add", "."]);
    fs.write_str("/repo/sub/file", "modified\n");
    let sub = execute_git_cli(&fs, "/repo/sub", &["diff", "file"]);
    assert_eq!(sub.exit_code, 0, "{}", sub.stderr);
    assert!(sub.stdout.contains("a/sub/file"));
    assert_ne!(run(&fs, &["diff", "unknown-revision"]).exit_code, 0);
}

#[test]
fn branch_flags_list_and_rename_without_creating_option_names() {
    let fs = repo();
    assert_eq!(ok(&fs, &["branch", "--show-current"]), "main\n");
    let oid = ok(&fs, &["rev-parse", "HEAD"]);
    fs.write_str("/repo/.git/refs/remotes/origin/main", &oid);
    assert_eq!(ok(&fs, &["branch", "-r"]), "  origin/main\n");
    assert_eq!(
        ok(&fs, &["branch", "-a"]),
        "* main\n  remotes/origin/main\n"
    );
    ok(&fs, &["branch", "-m", "renamed"]);
    assert_eq!(ok(&fs, &["branch", "--show-current"]), "renamed\n");
    ok(&fs, &["branch", "target"]);
    assert_ne!(
        run(&fs, &["branch", "-m", "renamed", "target"]).exit_code,
        0
    );
    ok(&fs, &["branch", "-M", "renamed", "target"]);
    assert_eq!(ok(&fs, &["branch"]), "* target\n");
    assert_ne!(run(&fs, &["branch", "--unknown"]).exit_code, 0);
    assert_eq!(ok(&fs, &["branch"]), "* target\n");
    ok(&fs, &["checkout", "--detach", "HEAD"]);
    assert_eq!(ok(&fs, &["branch", "--show-current"]), "");
}

#[test]
fn log_count_format_and_revision_are_respected() {
    let fs = repo();
    let base = ok(&fs, &["rev-parse", "HEAD"]).trim().to_string();
    ok(&fs, &["branch", "feature"]);
    let head = commit(&fs, "second\n", "second\n\nbody");
    for flags in [vec!["-n", "1"], vec!["-1"], vec!["--max-count=1"]] {
        let mut args = vec!["log"];
        args.extend(flags);
        args.push("--format=%H");
        assert_eq!(ok(&fs, &args), format!("{head}\n"));
    }
    assert_eq!(ok(&fs, &["log", "--max-count=0", "--format=%H"]), "");
    assert_eq!(
        ok(&fs, &["log", "--pretty=format:%h %s", "feature"]),
        format!("{} base", &base[..7])
    );
    assert_eq!(
        ok(&fs, &["log", "--format=%H", "feature"]),
        format!("{base}\n")
    );
    assert_eq!(
        ok(&fs, &["log", "--format=%H"]),
        format!("{head}\n{base}\n")
    );
    assert_eq!(
        ok(&fs, &["log", "-1", "--format=%an <%ae>|%cn <%ce>|%%|%b"]),
        "Git User <user@example.com>|Git User <user@example.com>|%|body\n\n"
    );
    assert_ne!(run(&fs, &["log", "-n"]).exit_code, 0);
    assert_ne!(run(&fs, &["log", "--max-count=oops"]).exit_code, 0);
}

#[test]
fn branch_rename_works_before_the_first_commit() {
    let fs = MemoryFs::new();
    ok(&fs, &["init"]);
    ok(&fs, &["branch", "-m", "main"]);
    assert_eq!(ok(&fs, &["branch", "--show-current"]), "main\n");
    ok(&fs, &["branch", "-M", "new-main"]);
    assert_eq!(ok(&fs, &["branch", "--show-current"]), "new-main\n");
    assert_ne!(run(&fs, &["branch", "-m", "missing", "other"]).exit_code, 0);
    assert_eq!(ok(&fs, &["branch", "--show-current"]), "new-main\n");
}
