use git_rust::{MemoryFs, execute_git_cli, mkdirp};

fn git(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}

fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    mkdirp(|p| fs.mkdir(p), "/repo", 10).unwrap();
    git(&fs, &["init", "-b", "main"]);
    fs.write_str("/repo/a", "base\n");
    fs.write_str("/repo/b", "second\n");
    git(&fs, &["add", "."]);
    git(&fs, &["commit", "-m", "base"]);
    fs
}

#[test]
fn staged_stash_preserves_unstaged_work_and_saves_only_index() {
    for flag in ["--staged", "-S"] {
        let fs = repo();
        let head = git(&fs, &["rev-parse", "HEAD"]);
        fs.write_str("/repo/a", "staged");
        git(&fs, &["add", "a"]);
        fs.write_str("/repo/b", "work");
        fs.write_str("/repo/untracked", "keep");
        git(&fs, &["stash", "push", flag]);
        assert_eq!(fs.read_str("/repo/a").unwrap(), "base\n");
        assert_eq!(fs.read_str("/repo/b").unwrap(), "work");
        assert_eq!(fs.read_str("/repo/untracked").unwrap(), "keep");
        assert_eq!(git(&fs, &["rev-parse", "HEAD"]), head);
        assert_eq!(git(&fs, &["diff", "--cached"]), "");
        assert_eq!(git(&fs, &["show", "refs/stash:a"]), "staged");
        assert_eq!(git(&fs, &["show", "refs/stash:b"]), "second\n");
        assert_eq!(execute_git_cli(&fs, "/repo", &["show", "refs/stash:untracked"]).exit_code, 128);
    }
}

#[test]
fn staged_stash_without_index_changes_leaves_worktree_untouched() {
    let fs = repo();
    fs.write_str("/repo/b", "work");
    execute_git_cli(&fs, "/repo", &["stash", "push", "--staged"]);
    assert_eq!(fs.read_str("/repo/b").unwrap(), "work");
    assert_eq!(git(&fs, &["stash", "list"]), "\n");
}

#[test]
fn staged_stash_handles_additions_and_deletions() {
    let fs = repo();
    git(&fs, &["rm", "a"]);
    fs.write_str("/repo/new", "added");
    git(&fs, &["add", "new"]);
    fs.write_str("/repo/b", "work");
    git(&fs, &["stash", "--staged"]);
    assert_eq!(fs.read_str("/repo/a").unwrap(), "base\n");
    assert!(fs.read_str("/repo/new").is_none());
    assert_eq!(fs.read_str("/repo/b").unwrap(), "work");
    assert_eq!(git(&fs, &["diff", "--cached"]), "");
    assert_eq!(git(&fs, &["show", "refs/stash:new"]), "added");
}

#[test]
fn staged_stash_does_not_overwrite_conflicting_worktree_edit() {
    let fs = repo();
    fs.write_str("/repo/a", "staged\n");
    git(&fs, &["add", "a"]);
    fs.write_str("/repo/a", "unstaged\n");
    let index_diff = git(&fs, &["diff", "--cached"]);
    let result = execute_git_cli(&fs, "/repo", &["stash", "push", "--staged"]);
    assert_ne!(result.exit_code, 0);
    assert_eq!(fs.read_str("/repo/a").unwrap(), "unstaged\n");
    assert_eq!(git(&fs, &["diff", "--cached"]), index_diff);
}

#[test]
fn staged_stash_preserves_separate_unstaged_hunk_in_same_file() {
    let fs = repo();
    fs.write_str("/repo/a", "one\ntwo\nthree\nfour\nfive\nsix\nseven\n");
    git(&fs, &["add", "a"]);
    git(&fs, &["commit", "-m", "multiline"]);
    fs.write_str("/repo/a", "staged\ntwo\nthree\nfour\nfive\nsix\nseven\n");
    git(&fs, &["add", "a"]);
    fs.write_str("/repo/a", "staged\ntwo\nthree\nfour\nfive\nsix\nunstaged\n");
    git(&fs, &["stash", "push", "--staged"]);
    assert_eq!(fs.read_str("/repo/a").unwrap(), "one\ntwo\nthree\nfour\nfive\nsix\nunstaged\n");
    assert_eq!(git(&fs, &["diff", "--cached"]), "");
}
