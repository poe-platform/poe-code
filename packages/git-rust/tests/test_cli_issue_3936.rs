use git_rust::{MemoryFs, execute_git_cli, mkdirp};

fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    mkdirp(|p| fs.mkdir(p), "/repo/sub", 10).unwrap();
    assert_eq!(execute_git_cli(&fs, "/repo", &["init"]).exit_code, 0);
    fs.write_str("/repo/a", "old a");
    fs.write_str("/repo/sub/b", "old b");
    run(&fs, &["add", "."]);
    run(&fs, &["commit", "-m", "initial"]);
    fs
}
fn run(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}
#[test]
fn add_all_respects_directory() {
    let fs = repo();
    fs.write_str("/repo/a", "new a");
    fs.write_str("/repo/sub/b", "new b");
    fs.write_str("/repo/outside", "untracked");
    run(&fs, &["add", "-A", "sub"]);
    assert_eq!(run(&fs, &["diff", "--cached", "--name-only"]), "sub/b\n");
}
#[test]
fn commit_paths_preserve_unrelated_index() {
    let fs = repo();
    fs.write_str("/repo/a", "staged a");
    run(&fs, &["add", "a"]);
    fs.write_str("/repo/sub/b", "new b");
    run(&fs, &["commit", "-m", "only b", "sub"]);
    assert_eq!(run(&fs, &["show", "HEAD:a"]), "old a");
    assert_eq!(run(&fs, &["show", "HEAD:sub/b"]), "new b");
    assert_eq!(run(&fs, &["diff", "--cached", "--name-only"]), "a\n");
}
#[test]
fn commit_rejects_untracked_path_without_mutating_index() {
    let fs = repo();
    fs.write_str("/repo/new", "untracked");
    let before = fs.read("/repo/.git/index");
    assert_ne!(execute_git_cli(&fs, "/repo", &["commit", "-m", "bad", "new"]).exit_code, 0);
    assert_eq!(fs.read("/repo/.git/index"), before);
}
#[test]
fn ref_filters_consume_revisions_and_default_to_head() {
    let fs = repo();
    run(&fs, &["tag", "v1-rc"]);
    run(&fs, &["branch", "feature"]);
    for args in [vec!["tag", "-l", "--contains", "HEAD"], vec!["tag", "-l", "--points-at", "HEAD"], vec!["tag", "--contains", "-l"], vec!["tag", "--points-at"], vec!["tag", "-l", "*rc*"]] {
        assert_eq!(run(&fs, &args), "v1-rc\n", "{args:?}");
    }
    for args in [vec!["branch", "--contains"], vec!["branch", "--contains", "-a"], vec!["branch", "-l", "*feat*"]] {
        assert!(run(&fs, &args).contains("feature"));
    }
}
#[test]
fn config_preserves_dash_values_and_missing_unset_status() {
    let fs = repo();
    for (key, value) in [("core.compression", "-1"), ("alias.st", "-s -b"), ("alias.list", "--list"), ("alias.unset", "--unset")] {
        run(&fs, &["config", key, value]);
        assert_eq!(run(&fs, &["config", key]), format!("{value}\n"));
    }
    assert_eq!(execute_git_cli(&fs, "/repo", &["config", "--unset", "missing.key"]).exit_code, 5);
}
#[test]
fn discovers_repository_from_subdirectory() {
    let fs = repo();
    let result = execute_git_cli(&fs, "/repo/sub", &["rev-parse", "--show-toplevel"]);
    assert_eq!(result.exit_code, 0);
    assert_eq!(result.stdout, "/repo\n");
}
#[test]
fn scoped_add_includes_deletions_but_excludes_outside_changes() {
    let fs = repo();
    fs.rm("/repo/sub/b").unwrap();
    fs.rm("/repo/a").unwrap();
    fs.write_str("/repo/sub/new", "new");
    run(&fs, &["add", "--all", "sub"]);
    assert_eq!(run(&fs, &["diff", "--cached", "--name-only"]), "sub/b\nsub/new\n");
}
#[test]
fn path_commit_excludes_untracked_directory_children_and_preserves_staged_new_files() {
    let fs = repo();
    fs.write_str("/repo/new", "staged new");
    run(&fs, &["add", "new"]);
    fs.write_str("/repo/sub/untracked", "ignore me");
    fs.rm("/repo/sub/b").unwrap();
    run(&fs, &["commit", "-m", "delete b", "sub"]);
    assert_ne!(execute_git_cli(&fs, "/repo", &["show", "HEAD:new"]).exit_code, 0);
    assert_eq!(run(&fs, &["diff", "--cached", "--name-only"]), "new\n");
    assert!(!run(&fs, &["ls-files"]).contains("sub/untracked"));
    assert_eq!(fs.read_str("/repo/sub/untracked").as_deref(), Some("ignore me"));
}
#[test]
fn failed_path_commit_restores_index() {
    let fs = repo();
    fs.write_str("/repo/a", "staged");
    run(&fs, &["add", "a"]);
    let before = fs.read("/repo/.git/index");
    let head = run(&fs, &["rev-parse", "HEAD"]);
    assert_ne!(execute_git_cli(&fs, "/repo", &["commit", "sub/b"]).exit_code, 0);
    assert_eq!(fs.read("/repo/.git/index"), before);
    assert_eq!(run(&fs, &["rev-parse", "HEAD"]), head);
}
