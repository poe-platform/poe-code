use git_rust::{MemoryFs, execute_git_cli};

#[test]
fn paths_are_relative_to_invocation_directory() {
    let fs = MemoryFs::new();
    assert_eq!(execute_git_cli(&fs, "/repo", &["init"]).exit_code, 0);
    fs.write_str("/repo/root.txt", "root");
    fs.write_str("/repo/sub/file.txt", "sub");
    assert_eq!(
        execute_git_cli(&fs, "/repo/sub", &["add", "."]).exit_code,
        0
    );
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["ls-files"]).stdout,
        "sub/file.txt\n"
    );
    assert_eq!(
        execute_git_cli(&fs, "/repo/sub", &["hash-object", "file.txt"]).stdout,
        execute_git_cli(&fs, "/repo", &["hash-object", "/repo/sub/file.txt"]).stdout
    );
    assert_eq!(
        execute_git_cli(&fs, "/repo/sub", &["rm", "file.txt"]).exit_code,
        0
    );
    assert!(!fs.exists("/repo/sub/file.txt"));
}

fn committed_repo() -> MemoryFs {
    let fs = MemoryFs::new();
    execute_git_cli(&fs, "/repo", &["init", "-b", "main"]);
    fs.write_str("/repo/a", "one\n");
    execute_git_cli(&fs, "/repo", &["add", "."]);
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["commit", "-m", "first"]).exit_code,
        0
    );
    fs
}

#[test]
fn revision_and_object_flags() {
    let fs = committed_repo();
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["rev-parse", "--abbrev-ref", "HEAD"]).stdout,
        "main\n"
    );
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["rev-parse", "--show-toplevel"]).stdout,
        "/repo\n"
    );
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["rev-parse", "--git-dir"]).stdout,
        ".git\n"
    );
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["rev-parse", "--is-inside-work-tree"]).stdout,
        "true\n"
    );
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["rev-parse", "--short", "HEAD"])
            .stdout
            .len(),
        8
    );
    assert_ne!(
        execute_git_cli(&fs, "/repo", &["rev-parse", "--verify", "missing"]).exit_code,
        0
    );
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["cat-file", "-t", "HEAD"]).stdout,
        "commit\n"
    );
    let content = execute_git_cli(&fs, "/repo", &["cat-file", "-p", "HEAD"]).stdout;
    assert!(content.contains("author Git User"));
    assert!(content.contains("committer Git User"));
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["cat-file", "-s", "HEAD"]).stdout,
        format!("{}\n", content.len())
    );
}

#[test]
fn reset_modes_and_commit_target() {
    for mode in ["--hard", "--mixed", "--soft"] {
        let fs = committed_repo();
        let first = execute_git_cli(&fs, "/repo", &["rev-parse", "HEAD"]).stdout;
        fs.write_str("/repo/a", "two\n");
        execute_git_cli(&fs, "/repo", &["add", "."]);
        execute_git_cli(&fs, "/repo", &["commit", "-m", "second"]);
        fs.write_str("/repo/a", "dirty\n");
        assert_eq!(
            execute_git_cli(&fs, "/repo", &["reset", mode, first.trim()]).exit_code,
            0
        );
        assert_eq!(
            execute_git_cli(&fs, "/repo", &["rev-parse", "HEAD"]).stdout,
            first
        );
        assert_eq!(
            execute_git_cli(&fs, "/repo", &["rev-parse", "--abbrev-ref", "HEAD"]).stdout,
            "main\n"
        );
        assert_eq!(
            fs.read_str("/repo/a").unwrap(),
            if mode == "--hard" { "one\n" } else { "dirty\n" }
        );
        let index = execute_git_cli(&fs, "/repo", &["status", "--short"]).stdout;
        if mode == "--hard" {
            assert!(index.is_empty());
        } else if mode == "--mixed" {
            assert!(index.starts_with(" M"));
        } else {
            assert!(index.starts_with("MM"));
        }
    }
}

#[test]
fn missing_worktree_commands() {
    let fs = committed_repo();
    fs.write_str("/repo/a", "two\n");
    let diff = execute_git_cli(&fs, "/repo", &["diff"]);
    assert_eq!(diff.exit_code, 0);
    assert!(diff.stdout.contains("-one\n+two\n"));
    execute_git_cli(&fs, "/repo", &["add", "a"]);
    assert!(
        execute_git_cli(&fs, "/repo", &["diff", "--cached"])
            .stdout
            .contains("+two")
    );
    assert!(
        execute_git_cli(&fs, "/repo", &["show", "HEAD"])
            .stdout
            .contains("+one")
    );
    fs.write_str("/repo/a", "dirty\n");
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["checkout", "--", "a"]).exit_code,
        0
    );
    assert_eq!(fs.read_str("/repo/a").unwrap(), "two\n");
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["restore", "a"]).exit_code,
        0
    );
    assert_eq!(fs.read_str("/repo/a").unwrap(), "two\n");
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["restore", "--staged", "a"]).exit_code,
        0
    );
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["restore", "a"]).exit_code,
        0
    );
    assert_eq!(fs.read_str("/repo/a").unwrap(), "one\n");
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["mv", "a", "b"]).exit_code,
        0
    );
    assert!(!fs.exists("/repo/a"));
    assert_eq!(execute_git_cli(&fs, "/repo", &["ls-files"]).stdout, "b\n");
    fs.write_str("/repo/untracked", "keep?");
    assert_eq!(execute_git_cli(&fs, "/repo", &["clean", "-n"]).exit_code, 0);
    assert!(fs.exists("/repo/untracked"));
    assert_eq!(execute_git_cli(&fs, "/repo", &["clean", "-f"]).exit_code, 0);
    assert!(!fs.exists("/repo/untracked"));
}

#[test]
fn add_update_force_and_reset_from_subdirectory() {
    let fs = committed_repo();
    fs.write_str("/repo/sub/tracked", "old");
    execute_git_cli(&fs, "/repo", &["add", "sub"]);
    execute_git_cli(&fs, "/repo", &["commit", "-m", "sub"]);
    fs.write_str("/repo/sub/tracked", "new");
    fs.write_str("/repo/sub/untracked", "untracked");
    fs.write_str("/repo/.gitignore", "ignored\n");
    fs.write_str("/repo/ignored", "ignored");
    assert_eq!(
        execute_git_cli(&fs, "/repo/sub", &["add", "-u"]).exit_code,
        0
    );
    assert!(
        !execute_git_cli(&fs, "/repo", &["ls-files"])
            .stdout
            .contains("untracked")
    );
    assert_eq!(
        execute_git_cli(&fs, "/repo/sub", &["reset", "tracked"]).exit_code,
        0
    );
    assert!(
        execute_git_cli(&fs, "/repo", &["status", "-s"])
            .stdout
            .contains(" M sub/tracked")
    );
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["add", "-f", "ignored"]).exit_code,
        0
    );
    assert!(
        execute_git_cli(&fs, "/repo", &["ls-files"])
            .stdout
            .contains("ignored")
    );
    fs.unlink("/repo/sub/tracked").unwrap();
    assert_eq!(
        execute_git_cli(&fs, "/repo/sub", &["add", "-u"]).exit_code,
        0
    );
    assert!(
        !execute_git_cli(&fs, "/repo", &["ls-files"])
            .stdout
            .contains("sub/tracked")
    );
}

#[test]
fn network_flags_are_not_remote_names() {
    use git_rust::commands::plumbing::set_config;
    use git_rust::{MockHttpServer, execute_git_cli_with_http};
    for args in [
        vec!["fetch", "--prune", "origin", "main"],
        vec!["pull", "--ff-only", "origin", "main"],
        vec!["push", "--force", "origin", "main"],
        vec!["push", "-u", "origin", "main"],
    ] {
        let fs = committed_repo();
        let server = MockHttpServer::new();
        server.register_repo("cli-remote", committed_repo(), "/repo/.git");
        set_config(
            &fs,
            "/repo/.git",
            "remote.origin.url",
            Some("http://localhost:8888/cli-remote.git"),
            false,
        )
        .unwrap();
        let result = execute_git_cli_with_http(&fs, "/repo", &args, &server);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        if args.contains(&"-u") {
            assert_eq!(
                execute_git_cli(&fs, "/repo", &["config", "branch.main.remote"]).stdout,
                "origin\n"
            );
            assert_eq!(
                execute_git_cli(&fs, "/repo", &["config", "branch.main.merge"]).stdout,
                "refs/heads/main\n"
            );
        }
    }
}

#[test]
fn reset_invalid_revision_and_unknown_add_fail() {
    let fs = committed_repo();
    assert_ne!(
        execute_git_cli(&fs, "/repo", &["reset", "--hard", "missing"]).exit_code,
        0
    );
    assert_ne!(
        execute_git_cli(&fs, "/repo", &["add", "missing"]).exit_code,
        0
    );
}

#[test]
fn moving_a_dirty_file_preserves_the_staged_blob() {
    let fs = committed_repo();
    fs.write_str("/repo/a", "dirty\n");
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["mv", "a", "b"]).exit_code,
        0
    );
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["restore", "b"]).exit_code,
        0
    );
    assert_eq!(fs.read_str("/repo/b").unwrap(), "one\n");
}

#[test]
fn unicode_object_name_returns_an_error() {
    let fs = committed_repo();
    assert_ne!(
        execute_git_cli(&fs, "/repo", &["cat-file", "-p", "💥"]).exit_code,
        0
    );
}

#[test]
fn rm_rejects_untracked_and_outside_paths() {
    let fs = committed_repo();
    fs.write_str("/outside", "outside");
    fs.write_str("/repo/untracked", "untracked");
    assert_ne!(
        execute_git_cli(&fs, "/repo", &["rm", "/outside"]).exit_code,
        0
    );
    assert!(fs.exists("/outside"));
    assert_ne!(
        execute_git_cli(&fs, "/repo", &["rm", "untracked"]).exit_code,
        0
    );
    assert!(fs.exists("/repo/untracked"));
}

#[test]
fn mixed_reset_preserves_executable_and_symlink_modes() {
    let fs = committed_repo();
    fs.write_with_mode("/repo/executable", b"run\n", 0o100755);
    fs.symlink("a", "/repo/link").unwrap();
    execute_git_cli(&fs, "/repo", &["add", "."]);
    execute_git_cli(&fs, "/repo", &["commit", "-m", "modes"]);
    let head = execute_git_cli(&fs, "/repo", &["rev-parse", "HEAD"]).stdout;
    let tree = git_rust::read_commit(&fs, "/repo/.git", head.trim())
        .unwrap()
        .commit
        .tree;
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["reset", "--mixed", "HEAD"]).exit_code,
        0
    );
    execute_git_cli(&fs, "/repo", &["commit", "-m", "preserve modes"]);
    let next = execute_git_cli(&fs, "/repo", &["rev-parse", "HEAD"]).stdout;
    assert_eq!(
        git_rust::read_commit(&fs, "/repo/.git", next.trim())
            .unwrap()
            .commit
            .tree,
        tree
    );
}

#[test]
fn reset_path_restores_a_staged_deletion_and_link_mode() {
    let fs = committed_repo();
    fs.symlink("a", "/repo/link").unwrap();
    execute_git_cli(&fs, "/repo", &["add", "link"]);
    execute_git_cli(&fs, "/repo", &["commit", "-m", "link"]);
    let head = execute_git_cli(&fs, "/repo", &["rev-parse", "HEAD"]).stdout;
    let tree = git_rust::read_commit(&fs, "/repo/.git", head.trim())
        .unwrap()
        .commit
        .tree;
    execute_git_cli(&fs, "/repo", &["rm", "--cached", "link"]);
    fs.unlink("/repo/link").unwrap();
    fs.symlink("different", "/repo/link").unwrap();
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["reset", "--", "/repo/link"]).exit_code,
        0
    );
    assert!(
        execute_git_cli(&fs, "/repo", &["ls-files"])
            .stdout
            .contains("link")
    );
    execute_git_cli(&fs, "/repo", &["commit", "-m", "reset path"]);
    let next = execute_git_cli(&fs, "/repo", &["rev-parse", "HEAD"]).stdout;
    assert_eq!(
        git_rust::read_commit(&fs, "/repo/.git", next.trim())
            .unwrap()
            .commit
            .tree,
        tree
    );
}

#[test]
fn clean_combined_flags_remove_untracked_directories_only() {
    let fs = committed_repo();
    fs.write_str("/repo/trash/nested/file", "trash");
    fs.write_str("/repo/ignored/file", "ignore");
    fs.write_str("/repo/.gitignore", "ignored/\n");
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["clean", "-nd"]).exit_code,
        0
    );
    assert!(fs.exists("/repo/trash"));
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["clean", "-fd"]).exit_code,
        0
    );
    assert!(!fs.exists("/repo/trash"));
    assert!(fs.exists("/repo/ignored/file"));
    assert!(fs.exists("/repo/a"));
}

#[test]
fn cached_diff_before_first_commit_shows_staged_addition() {
    let fs = MemoryFs::new();
    assert_eq!(execute_git_cli(&fs, "/repo", &["init"]).exit_code, 0);
    fs.write_str("/repo/a", "first\n");
    assert_eq!(execute_git_cli(&fs, "/repo", &["add", "a"]).exit_code, 0);
    for revision in ["HEAD", "missing"] {
        assert_ne!(
            execute_git_cli(&fs, "/repo", &["diff", "--cached", revision]).exit_code,
            0
        );
    }
    for flag in ["--cached", "--staged"] {
        let diff = execute_git_cli(&fs, "/repo", &["diff", flag]);
        assert_eq!(diff.exit_code, 0, "{}", diff.stderr);
        assert!(diff.stdout.contains("new file mode 100644"));
        assert!(diff.stdout.contains("+first\n"));
        assert_eq!(
            execute_git_cli(&fs, "/repo", &["diff", flag, "HEAD"]).exit_code,
            128
        );
        assert_eq!(
            execute_git_cli(&fs, "/repo", &["diff", flag, "missing"]).exit_code,
            128
        );
    }
    fs.write_str("/repo/.git/HEAD", "bad ref\n");
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["diff", "--cached"]).exit_code,
        128
    );
}

#[test]
fn clean_preserves_ignored_children_in_untracked_directories() {
    let fs = committed_repo();
    fs.write_str("/repo/.gitignore", "*.log\nempty/\n");
    execute_git_cli(&fs, "/repo", &["add", ".gitignore"]);
    fs.write_str("/repo/trash/ignored.log", "keep\n");
    fs.write_str("/repo/trash/delete.txt", "delete\n");
    fs.mkdir("/repo/trash/empty").unwrap();
    execute_git_cli(&fs, "/repo/trash/nested", &["init"]);
    fs.write_str("/repo/trash/nested/file", "nested\n");
    let dry = execute_git_cli(&fs, "/repo", &["clean", "-nd"]);
    assert_eq!(dry.exit_code, 0, "{}", dry.stderr);
    assert!(fs.exists("/repo/trash/ignored.log"));
    assert!(fs.exists("/repo/trash/delete.txt"));
    assert!(fs.exists("/repo/trash/empty"));
    assert!(fs.exists("/repo/trash/nested/.git"));
    assert!(dry.stdout.contains("delete.txt"));
    let result = execute_git_cli(&fs, "/repo", &["clean", "-fd"]);
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert!(fs.exists("/repo/trash/ignored.log"));
    assert!(fs.exists("/repo/trash/empty"));
    assert!(fs.exists("/repo/trash/nested/.git"));
    assert!(fs.exists("/repo/trash/nested/file"));
    assert!(!fs.exists("/repo/trash/delete.txt"));
    let ignored = execute_git_cli(&fs, "/repo", &["clean", "-fdx"]);
    assert_eq!(ignored.exit_code, 0, "{}", ignored.stderr);
    assert!(!fs.exists("/repo/trash/ignored.log"));
    assert!(!fs.exists("/repo/trash/empty"));
    assert!(fs.exists("/repo/trash/nested/.git"));
    assert!(fs.exists("/repo/trash/nested/file"));
    assert!(fs.exists("/repo/a"));
}

#[test]
fn diff_flags_before_path_separator_keep_paths_out_of_revisions() {
    let fs = committed_repo();
    fs.write_str("/repo/a", "staged a\n");
    fs.write_str("/repo/b", "staged b\n");
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["add", "a", "b"]).exit_code,
        0
    );
    for flag in ["--cached", "--staged"] {
        let diff = execute_git_cli(&fs, "/repo", &["diff", flag, "--", "a"]);
        assert_eq!(diff.exit_code, 0, "{}", diff.stderr);
        assert!(diff.stdout.contains("diff --git a/a b/a\n"));
        assert!(!diff.stdout.contains("diff --git a/b b/b\n"));
    }
    fs.write_str("/repo/a", "worktree a\n");
    let diff = execute_git_cli(&fs, "/repo", &["diff", "--no-color", "--", "a"]);
    assert_eq!(diff.exit_code, 0, "{}", diff.stderr);
    assert!(diff.stdout.contains("+worktree a\n"));
    let diff = execute_git_cli(&fs, "/repo", &["diff", "HEAD", "--", "a"]);
    assert_eq!(diff.exit_code, 0, "{}", diff.stderr);
    assert!(diff.stdout.contains("+worktree a\n"));
}
