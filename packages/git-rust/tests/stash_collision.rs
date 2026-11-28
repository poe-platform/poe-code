use git_rust::{GitIndexManager, MemoryFs, execute_git_cli};

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
    git(&fs, &["add", "."]);
    git(&fs, &["commit", "-m", "base"]);
    fs
}

#[test]
fn stash_collision_preserves_worktree_index_and_stash() {
    for op in ["apply", "pop"] {
        for contents in ["independent\n", "saved\n"] {
            let fs = repo();
            fs.write_str("/repo/scratch.txt", "saved\n");
            git(&fs, &["stash", "push", "-u"]);
            fs.write_str("/repo/scratch.txt", contents);
            let index = fs.read("/repo/.git/index");
            let stash = git(&fs, &["stash", "list"]);
            let head = git(&fs, &["rev-parse", "HEAD"]);

            let result = execute_git_cli(&fs, "/repo", &["stash", op]);

            assert_eq!(fs.read_str("/repo/scratch.txt").as_deref(), Some(contents));
            assert_ne!(
                result.exit_code, 0,
                "{op} must refuse an existing untracked file"
            );
            assert!(result.stderr.contains("scratch.txt"), "{}", result.stderr);
            assert_eq!(fs.read("/repo/.git/index"), index);
            assert!(
                GitIndexManager::acquire(&fs, "/repo/.git", |index| Ok(index.unmerged_paths()))
                    .unwrap()
                    .is_empty()
            );
            assert_eq!(git(&fs, &["stash", "list"]), stash);
            assert_eq!(git(&fs, &["rev-parse", "HEAD"]), head);
        }
    }
}

#[test]
fn stash_pop_restores_missing_file_and_drops_stash() {
    let fs = repo();
    fs.write_str("/repo/scratch.txt", "saved\n");
    git(&fs, &["stash", "push", "-u"]);
    assert!(!fs.exists("/repo/scratch.txt"));
    fs.write_str("/repo/unrelated", "keep\n");
    git(&fs, &["stash", "pop"]);
    assert_eq!(fs.read_str("/repo/scratch.txt").as_deref(), Some("saved\n"));
    assert_eq!(fs.read_str("/repo/unrelated").as_deref(), Some("keep\n"));
    assert_eq!(git(&fs, &["stash", "list"]), "\n");
}

#[test]
fn stash_pop_keeps_tracked_conflict_stages_and_stash() {
    let fs = repo();
    let base = git(&fs, &["rev-parse", "HEAD:a"]);
    fs.write_str("/repo/a", "stashed\n");
    git(&fs, &["stash", "push"]);
    let theirs = git(&fs, &["rev-parse", "refs/stash:a"]);
    fs.write_str("/repo/a", "committed\n");
    git(&fs, &["commit", "-am", "independent"]);
    let ours = git(&fs, &["rev-parse", "HEAD:a"]);
    let stash = git(&fs, &["stash", "list"]);
    let head = git(&fs, &["rev-parse", "HEAD"]);

    let result = execute_git_cli(&fs, "/repo", &["stash", "pop"]);

    assert_ne!(result.exit_code, 0);
    let contents = fs.read_str("/repo/a").unwrap();
    assert!(contents.contains("<<<<<<<"), "{contents}");
    assert!(contents.contains("committed\n"), "{contents}");
    assert!(contents.contains("stashed\n"), "{contents}");
    assert_eq!(
        git(&fs, &["ls-files", "--stage", "a"]),
        format!(
            "100644 {} 1\ta\n100644 {} 2\ta\n100644 {} 3\ta\n",
            base.trim(),
            ours.trim(),
            theirs.trim(),
        )
    );
    assert_eq!(git(&fs, &["stash", "list"]), stash);
    assert_eq!(git(&fs, &["rev-parse", "HEAD"]), head);
}

#[test]
fn stash_collision_checks_all_paths_before_restoring_tracked_changes() {
    let fs = repo();
    fs.write_str("/repo/a", "stashed\n");
    fs.write_str("/repo/scratch.txt", "saved\n");
    git(&fs, &["stash", "push", "-u"]);
    fs.write_str("/repo/scratch.txt", "independent\n");
    let index = fs.read("/repo/.git/index");
    assert_ne!(
        execute_git_cli(&fs, "/repo", &["stash", "pop"]).exit_code,
        0
    );
    assert_eq!(fs.read_str("/repo/a").as_deref(), Some("base\n"));
    assert_eq!(
        fs.read_str("/repo/scratch.txt").as_deref(),
        Some("independent\n")
    );
    assert_eq!(fs.read("/repo/.git/index"), index);
}

#[test]
fn ordinary_stash_preserves_untracked_files_without_saving_them() {
    let fs = repo();
    fs.write_str("/repo/a", "stashed\n");
    fs.write_str("/repo/scratch.txt", "independent\n");
    git(&fs, &["stash", "push"]);
    assert_eq!(
        fs.read_str("/repo/scratch.txt").as_deref(),
        Some("independent\n")
    );
    assert_ne!(
        execute_git_cli(&fs, "/repo", &["show", "refs/stash:scratch.txt"]).exit_code,
        0
    );
    git(&fs, &["stash", "pop"]);
    assert_eq!(fs.read_str("/repo/a").as_deref(), Some("stashed\n"));
    assert_eq!(
        fs.read_str("/repo/scratch.txt").as_deref(),
        Some("independent\n")
    );
}

#[test]
fn stash_pop_preserves_directory_and_symlink_collisions() {
    for kind in ["directory", "symlink", "parent-file"] {
        let fs = repo();
        let path = if kind == "parent-file" {
            "scratch/file"
        } else {
            "scratch"
        };
        fs.write_str(&format!("/repo/{path}"), "saved\n");
        git(&fs, &["stash", "push", "--include-untracked"]);
        if kind == "directory" {
            fs.write_str("/repo/scratch/local", "independent\n");
        } else if kind == "symlink" {
            fs.write_str("/repo/local", "independent\n");
            fs.writelink("/repo/scratch", b"local").unwrap();
        } else {
            fs.rm("/repo/scratch").unwrap();
            fs.write_str("/repo/scratch", "independent\n");
        }
        let index = fs.read("/repo/.git/index");
        let stash = git(&fs, &["stash", "list"]);

        assert_ne!(
            execute_git_cli(&fs, "/repo", &["stash", "pop"]).exit_code,
            0
        );

        if kind == "directory" {
            assert_eq!(
                fs.read_str("/repo/scratch/local").as_deref(),
                Some("independent\n")
            );
        } else if kind == "symlink" {
            assert_eq!(fs.readlink("/repo/scratch").unwrap(), b"local");
            assert_eq!(fs.read_str("/repo/local").as_deref(), Some("independent\n"));
        } else {
            assert_eq!(
                fs.read_str("/repo/scratch").as_deref(),
                Some("independent\n")
            );
        }
        assert_eq!(fs.read("/repo/.git/index"), index);
        assert_eq!(git(&fs, &["stash", "list"]), stash);
    }
}
