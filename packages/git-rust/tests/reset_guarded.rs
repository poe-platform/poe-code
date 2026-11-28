use git_rust::{MemoryFs, execute_git_cli};

fn git(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}

fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    git(&fs, &["init", "-b", "main"]);
    fs.write_str("/repo/a", "base\n");
    fs.write_str("/repo/b", "second\n");
    git(&fs, &["add", "."]);
    git(&fs, &["commit", "-m", "base"]);
    git(&fs, &["checkout", "-b", "topic"]);
    fs.write_str("/repo/a", "topic\n");
    git(&fs, &["commit", "-am", "topic"]);
    git(&fs, &["checkout", "main"]);
    fs
}

#[test]
fn guarded_reset_rejects_conflicting_work_without_mutation() {
    for mode in ["--keep", "--merge"] {
        let fs = repo();
        fs.write_str("/repo/a", "local");
        let head = git(&fs, &["rev-parse", "HEAD"]);
        let index = fs.read("/repo/.git/index").unwrap();
        let log = fs.read("/repo/.git/logs/HEAD").unwrap();
        let result = execute_git_cli(&fs, "/repo", &["reset", mode, "topic"]);
        assert_eq!(result.exit_code, 128, "{mode}: {}", result.stderr);
        assert_eq!(git(&fs, &["rev-parse", "HEAD"]), head);
        assert_eq!(fs.read("/repo/.git/index").unwrap(), index);
        assert_eq!(fs.read("/repo/.git/logs/HEAD").unwrap(), log);
        assert_eq!(git(&fs, &["show", "HEAD:a"]), "base\n");
        assert_eq!(git(&fs, &["show", ":a"]), "base\n");
        assert_eq!(fs.read_str("/repo/a").unwrap(), "local");
    }
}

#[test]
fn guarded_reset_updates_clean_paths_and_preserves_unrelated_edits() {
    for mode in ["--keep", "--merge"] {
        let fs = repo();
        fs.write_str("/repo/b", "local");
        git(&fs, &["reset", mode, "topic"]);
        assert_eq!(
            git(&fs, &["rev-parse", "HEAD"]),
            git(&fs, &["rev-parse", "topic"])
        );
        assert_eq!(git(&fs, &["show", ":a"]), "topic\n");
        assert_eq!(fs.read_str("/repo/a").unwrap(), "topic\n");
        assert_eq!(fs.read_str("/repo/b").unwrap(), "local");
    }
}

#[test]
fn keep_rejects_staged_changes_but_merge_discards_them() {
    for mode in ["--keep", "--merge"] {
        let fs = repo();
        fs.write_str("/repo/a", "staged");
        git(&fs, &["add", "a"]);
        let result = execute_git_cli(&fs, "/repo", &["reset", mode, "topic"]);
        assert_eq!(result.exit_code, if mode == "--keep" { 128 } else { 0 });
        assert_eq!(
            fs.read_str("/repo/a").unwrap(),
            if mode == "--keep" {
                "staged"
            } else {
                "topic\n"
            }
        );
    }
}

#[test]
fn guarded_reset_checks_deletions_before_updating_other_paths() {
    for mode in ["--keep", "--merge"] {
        let fs = repo();
        git(&fs, &["checkout", "topic"]);
        git(&fs, &["rm", "b"]);
        git(&fs, &["commit", "-m", "delete b"]);
        git(&fs, &["checkout", "main"]);
        fs.write_str("/repo/b", "local");
        let head = git(&fs, &["rev-parse", "HEAD"]);
        let index = fs.read("/repo/.git/index").unwrap();
        assert_eq!(
            execute_git_cli(&fs, "/repo", &["reset", mode, "topic"]).exit_code,
            128
        );
        assert_eq!(git(&fs, &["rev-parse", "HEAD"]), head);
        assert_eq!(fs.read("/repo/.git/index").unwrap(), index);
        assert_eq!(fs.read_str("/repo/a").unwrap(), "base\n");
        assert_eq!(fs.read_str("/repo/b").unwrap(), "local");
        fs.write_str("/repo/b", "second\n");
        git(&fs, &["reset", mode, "topic"]);
        assert!(fs.read("/repo/b").is_none());
        assert_eq!(fs.read_str("/repo/a").unwrap(), "topic\n");
    }
}

#[test]
fn merge_preserves_unstaged_work_when_index_matches_target() {
    let fs = repo();
    fs.write_str("/repo/a", "topic\n");
    git(&fs, &["add", "a"]);
    fs.write_str("/repo/a", "local");
    git(&fs, &["reset", "--merge", "topic"]);
    assert_eq!(git(&fs, &["show", ":a"]), "topic\n");
    assert_eq!(fs.read_str("/repo/a").unwrap(), "local");
}

#[test]
fn guarded_reset_rejects_unknown_revisions_and_paths() {
    for mode in ["--keep", "--merge"] {
        let fs = repo();
        let head = git(&fs, &["rev-parse", "HEAD"]);
        for args in [
            vec!["reset", mode, "missing"],
            vec!["reset", mode, "topic", "--", "a"],
        ] {
            assert_eq!(execute_git_cli(&fs, "/repo", &args).exit_code, 128);
            assert_eq!(git(&fs, &["rev-parse", "HEAD"]), head);
            assert_eq!(fs.read_str("/repo/a").unwrap(), "base\n");
        }
    }
}

#[test]
fn guarded_reset_preserves_untracked_files_in_the_target() {
    for mode in ["--keep", "--merge"] {
        let fs = repo();
        git(&fs, &["checkout", "topic"]);
        fs.write_str("/repo/new", "committed");
        git(&fs, &["add", "new"]);
        git(&fs, &["commit", "-m", "add new"]);
        git(&fs, &["checkout", "main"]);
        fs.write_str("/repo/new", "untracked");
        let head = git(&fs, &["rev-parse", "HEAD"]);
        let index = fs.read("/repo/.git/index").unwrap();
        assert_eq!(
            execute_git_cli(&fs, "/repo", &["reset", mode, "topic"]).exit_code,
            128
        );
        assert_eq!(git(&fs, &["rev-parse", "HEAD"]), head);
        assert_eq!(fs.read("/repo/.git/index").unwrap(), index);
        assert_eq!(fs.read_str("/repo/new").unwrap(), "untracked");
        assert_eq!(fs.read_str("/repo/a").unwrap(), "base\n");
    }
}
