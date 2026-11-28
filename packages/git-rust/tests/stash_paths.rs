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
fn stash_path_preserves_other_worktree_and_index_changes() {
    for staged in [false, true] {
        for args in [vec!["stash", "push", "--", "a"], vec!["stash", "push", "a"]] {
            let fs = repo();
            let head = git(&fs, &["rev-parse", "HEAD"]);
            fs.write_str("/repo/a", "one");
            fs.write_str("/repo/b", "two");
            if staged {
                git(&fs, &["add", "a", "b"]);
                fs.write_str("/repo/b", "three");
            }
            git(&fs, &args);
            assert_eq!(fs.read_str("/repo/a").unwrap(), "base\n");
            assert_eq!(fs.read_str("/repo/b").unwrap(), if staged { "three" } else { "two" });
            assert_eq!(git(&fs, &["show", "refs/stash:a"]), "one");
            assert_eq!(git(&fs, &["show", "refs/stash:b"]), "second\n");
            assert_eq!(git(&fs, &["show", ":a"]), "base\n");
            assert_eq!(git(&fs, &["show", ":b"]), if staged { "two" } else { "second\n" });
            assert_eq!(git(&fs, &["rev-parse", "HEAD"]), head);
        }
    }
}

#[test]
fn stash_unchanged_path_does_not_stash_other_changes() {
    let fs = repo();
    fs.write_str("/repo/b", "two");
    execute_git_cli(&fs, "/repo", &["stash", "push", "--", "a"]);
    assert_eq!(fs.read_str("/repo/b").unwrap(), "two");
    assert_eq!(git(&fs, &["stash", "list"]), "\n");
}

#[test]
fn stash_directory_from_subdirectory_handles_added_and_deleted_paths() {
    let fs = repo();
    mkdirp(|p| fs.mkdir(p), "/repo/sub", 10).unwrap();
    fs.write_str("/repo/sub/deleted", "old");
    git(&fs, &["add", "."]);
    git(&fs, &["commit", "-m", "directory"]);
    fs.unlink("/repo/sub/deleted").unwrap();
    fs.write_str("/repo/sub/added", "new");
    git(&fs, &["add", "sub/added"]);
    fs.write_str("/repo/b", "outside");
    fs.write_str("/repo/untracked", "keep");
    let result = execute_git_cli(&fs, "/repo/sub", &["stash", "push", "-m", "selected", "--", "."]);
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(fs.read_str("/repo/sub/deleted").unwrap(), "old");
    assert!(!fs.exists("/repo/sub/added"));
    assert_eq!(fs.read_str("/repo/b").unwrap(), "outside");
    assert_eq!(fs.read_str("/repo/untracked").unwrap(), "keep");
    assert_eq!(git(&fs, &["diff", "--cached"]), "");
    assert_eq!(git(&fs, &["show", "refs/stash:sub/added"]), "new");
    assert_ne!(execute_git_cli(&fs, "/repo", &["show", "refs/stash:sub/deleted"]).exit_code, 0);
    assert_ne!(execute_git_cli(&fs, "/repo", &["show", "refs/stash:untracked"]).exit_code, 0);
    assert_eq!(git(&fs, &["show", "refs/stash:b"]), "second\n");
}
