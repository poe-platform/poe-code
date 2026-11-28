use git_rust::{MemoryFs, execute_git_cli};

fn git(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}

fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    git(&fs, &["init", "-b", "main"]);
    git(&fs, &["config", "user.name", "Audit"]);
    git(&fs, &["config", "user.email", "audit@example.invalid"]);
    fs.write_str("/repo/a", "base\n");
    fs.write_str("/repo/b", "second\n");
    git(&fs, &["add", "a", "b"]);
    git(&fs, &["commit", "-m", "base"]);
    fs
}

#[test]
fn stash_conflict_keeps_both_edits_all_index_stages_and_stash() {
    for op in ["apply", "pop"] {
        let fs = repo();
        let base = git(&fs, &["rev-parse", "HEAD:a"]);
        fs.write_str("/repo/a", "saved\n");
        git(&fs, &["stash", "push"]);
        let saved = git(&fs, &["rev-parse", "refs/stash:a"]);
        let stash = fs.read("/repo/.git/refs/stash");
        let reflog = fs.read("/repo/.git/logs/refs/stash");
        fs.write_str("/repo/a", "other\n");
        git(&fs, &["commit", "-am", "other"]);
        let current = git(&fs, &["rev-parse", "HEAD:a"]);
        let head = git(&fs, &["rev-parse", "HEAD"]);

        let result = execute_git_cli(&fs, "/repo", &["stash", op]);

        assert_eq!(
            fs.read_str("/repo/a").unwrap(),
            "<<<<<<< Updated upstream\nother\n=======\nsaved\n>>>>>>> Stashed changes\n"
        );
        assert_eq!(result.exit_code, 1, "{op}: {}", result.stderr);
        assert_eq!(
            git(&fs, &["ls-files", "--unmerged"]),
            format!(
                "100644 {} 1\ta\n100644 {} 2\ta\n100644 {} 3\ta\n",
                base.trim(),
                current.trim(),
                saved.trim()
            )
        );
        let unmerged = git(&fs, &["ls-files", "--unmerged"]);
        assert_eq!(git(&fs, &["ls-files", "-u"]), unmerged);
        assert_eq!(
            git(&fs, &["ls-files", "-u", "-z", "--", "a"]),
            unmerged.replace('\n', "\0")
        );
        assert_eq!(git(&fs, &["ls-files", "-u", "--", "b"]), "");
        assert_eq!(fs.read("/repo/.git/refs/stash"), stash);
        assert_eq!(fs.read("/repo/.git/logs/refs/stash"), reflog);
        assert_eq!(git(&fs, &["rev-parse", "HEAD"]), head);
        assert_eq!(fs.read_str("/repo/b").unwrap(), "second\n");
    }
}

#[test]
fn stash_merges_separate_edits_and_preserves_unrelated_local_changes() {
    for op in ["apply", "pop"] {
        let fs = repo();
        fs.write_str("/repo/a", "one\ntwo\nthree\nfour\nfive\n");
        git(&fs, &["commit", "-am", "multiline"]);
        fs.write_str("/repo/a", "saved\ntwo\nthree\nfour\nfive\n");
        git(&fs, &["stash", "push"]);
        let stash = git(&fs, &["stash", "list"]);
        fs.write_str("/repo/a", "one\ntwo\nthree\nfour\nother\n");
        git(&fs, &["commit", "-am", "other"]);
        let head = git(&fs, &["rev-parse", "HEAD"]);
        fs.write_str("/repo/b", "staged\n");
        git(&fs, &["add", "b"]);
        fs.write_str("/repo/b", "unstaged\n");
        let index = git(&fs, &["ls-files", "--stage"]);

        git(&fs, &["stash", op]);

        assert_eq!(
            fs.read_str("/repo/a").unwrap(),
            "saved\ntwo\nthree\nfour\nother\n"
        );
        assert_eq!(fs.read_str("/repo/b").unwrap(), "unstaged\n");
        assert_eq!(git(&fs, &["ls-files", "--stage"]), index);
        assert_eq!(git(&fs, &["ls-files", "-u"]), "");
        assert_eq!(git(&fs, &["rev-parse", "HEAD"]), head);
        assert_eq!(
            git(&fs, &["stash", "list"]),
            if op == "pop" { "\n" } else { &stash }
        );
    }
}

#[test]
fn stash_refuses_to_overwrite_local_edits_without_mutating_state() {
    for op in ["apply", "pop"] {
        let fs = repo();
        fs.write_str("/repo/a", "saved\n");
        git(&fs, &["stash", "push"]);
        fs.write_str("/repo/a", "local\n");
        let index = fs.read("/repo/.git/index");
        let stash = git(&fs, &["stash", "list"]);

        let result = execute_git_cli(&fs, "/repo", &["stash", op]);

        assert_ne!(result.exit_code, 0);
        assert_eq!(fs.read_str("/repo/a").unwrap(), "local\n");
        assert_eq!(fs.read("/repo/.git/index"), index);
        assert_eq!(git(&fs, &["stash", "list"]), stash);
    }
}

#[test]
fn stash_modify_delete_conflict_keeps_surviving_bytes_and_available_stages() {
    for deleted_upstream in [true, false] {
        let fs = repo();
        let base = git(&fs, &["rev-parse", "HEAD:a"]);
        if deleted_upstream {
            fs.write_str("/repo/a", "saved\n");
        } else {
            git(&fs, &["rm", "a"]);
        }
        git(&fs, &["stash", "push"]);
        let stash = git(&fs, &["stash", "list"]);
        if deleted_upstream {
            git(&fs, &["rm", "a"]);
        } else {
            fs.write_str("/repo/a", "other\n");
        }
        git(&fs, &["commit", "-am", "other"]);
        let surviving = git(
            &fs,
            &[
                "rev-parse",
                if deleted_upstream {
                    "refs/stash:a"
                } else {
                    "HEAD:a"
                },
            ],
        );

        let result = execute_git_cli(&fs, "/repo", &["stash", "pop"]);

        assert_eq!(result.exit_code, 1, "{}", result.stderr);
        assert_eq!(
            fs.read_str("/repo/a").unwrap(),
            if deleted_upstream {
                "saved\n"
            } else {
                "other\n"
            }
        );
        assert_eq!(
            git(&fs, &["ls-files", "--unmerged"]),
            format!(
                "100644 {} 1\ta\n100644 {} {}\ta\n",
                base.trim(),
                surviving.trim(),
                if deleted_upstream { 3 } else { 2 }
            )
        );
        assert_eq!(git(&fs, &["stash", "list"]), stash);
    }
}
