use git_rust::{MemoryFs, execute_git_cli};

fn ok(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout.trim().to_string()
}

fn unrelated_roots() -> MemoryFs {
    let fs = MemoryFs::new();
    ok(&fs, &["init", "-b", "main"]);
    ok(&fs, &["config", "user.name", "Tester"]);
    ok(&fs, &["config", "user.email", "tester@example.invalid"]);
    fs.write_str("/repo/x", "main\n");
    ok(&fs, &["add", "x"]);
    ok(&fs, &["commit", "-m", "main root"]);
    ok(&fs, &["rm", "x"]);
    fs.write_str("/repo/new", "topic\n");
    ok(&fs, &["add", "new"]);
    let tree = ok(&fs, &["write-tree"]);
    let topic = ok(&fs, &["commit-tree", &tree, "-m", "topic root"]);
    ok(&fs, &["update-ref", "refs/heads/topic", &topic]);
    ok(&fs, &["reset", "--hard", "HEAD"]);
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["merge-base", "main", "topic"]).exit_code,
        1
    );
    fs
}

#[test]
fn unrelated_merge_requires_opt_in_without_mutating_repository() {
    for options in [
        vec![],
        vec!["--no-ff"],
        vec!["--squash"],
        vec!["--no-commit"],
        vec![
            "--allow-unrelated-histories",
            "--no-allow-unrelated-histories",
        ],
    ] {
        let fs = unrelated_roots();
        let before: Vec<_> = fs
            .list_paths_under("/repo")
            .into_iter()
            .map(|path| (fs.read(&path), path))
            .collect();
        let mut args = vec!["merge"];
        args.extend(options);
        args.push("topic");
        let result = execute_git_cli(&fs, "/repo", &args);
        assert_eq!(result.exit_code, 128, "{args:?}: {result:?}");
        assert_eq!(
            result.stderr,
            "fatal: refusing to merge unrelated histories\n"
        );
        let after: Vec<_> = fs
            .list_paths_under("/repo")
            .into_iter()
            .map(|path| (fs.read(&path), path))
            .collect();
        assert_eq!(after, before, "{args:?} changed repository state");
    }
}

#[test]
fn explicit_opt_in_merges_both_root_trees_and_parents() {
    let fs = unrelated_roots();
    let main = ok(&fs, &["rev-parse", "main"]);
    let topic = ok(&fs, &["rev-parse", "topic"]);
    ok(
        &fs,
        &[
            "merge",
            "--no-allow-unrelated-histories",
            "--allow-unrelated-histories",
            "topic",
        ],
    );
    assert_eq!(
        ok(&fs, &["show", "-s", "--format=%P", "HEAD"]),
        format!("{main} {topic}")
    );
    assert_eq!(ok(&fs, &["ls-tree", "--name-only", "HEAD"]), "new\nx");
    assert_eq!(fs.read_str("/repo/x").unwrap(), "main\n");
    assert_eq!(fs.read_str("/repo/new").unwrap(), "topic\n");
    assert_eq!(ok(&fs, &["status", "--porcelain"]), "");
}

#[test]
fn merge_api_requires_the_same_explicit_permission() {
    let fs = unrelated_roots();
    let main = ok(&fs, &["rev-parse", "main"]);
    let topic = ok(&fs, &["rev-parse", "topic"]);
    let rejected = git_rust::merge(
        &fs,
        Some("/repo"),
        "/repo/.git",
        None,
        "topic",
        true,
        false,
        false,
        false,
        false,
        None,
        None,
        None,
        false,
    )
    .unwrap_err();
    assert_eq!(rejected.code, git_rust::ErrorCode::UnrelatedHistoriesError);
    assert_eq!(ok(&fs, &["rev-parse", "HEAD"]), main);
    let merged = git_rust::merge(
        &fs,
        Some("/repo"),
        "/repo/.git",
        None,
        "topic",
        true,
        false,
        false,
        false,
        false,
        None,
        None,
        None,
        true,
    )
    .unwrap();
    assert!(merged.merge_commit);
    assert_eq!(
        ok(&fs, &["show", "-s", "--format=%P", "HEAD"]),
        format!("{main} {topic}")
    );
}
