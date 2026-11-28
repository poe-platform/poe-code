use git_rust::{MemoryFs, cli::execute_git_cli, read_commit, resolve_ref};

#[test]
fn amend_only_preserves_tree_index_and_worktree() {
    for flag in ["--only", "-o"] {
        let fs = MemoryFs::new();
        for args in [
            vec!["init", "-b", "main"],
            vec!["config", "user.name", "Audit"],
            vec!["config", "user.email", "audit@example.invalid"],
        ] {
            assert_eq!(execute_git_cli(&fs, "/repo", &args).exit_code, 0);
        }
        fs.write_str("/repo/a", "base\n");
        fs.write_str("/repo/b", "second\n");
        assert_eq!(
            execute_git_cli(&fs, "/repo", &["add", "a", "b"]).exit_code,
            0
        );
        assert_eq!(
            execute_git_cli(&fs, "/repo", &["commit", "-m", "base"]).exit_code,
            0
        );
        let old_oid = resolve_ref(&fs, "/repo/.git", "HEAD", None).unwrap();
        let old = read_commit(&fs, "/repo/.git", &old_oid).unwrap();
        fs.write_str("/repo/a", "changed");
        fs.write_str("/repo/b", "other");
        assert_eq!(
            execute_git_cli(&fs, "/repo", &["add", "a", "b"]).exit_code,
            0
        );
        fs.write_str("/repo/a", "unstaged");
        let index = fs.read("/repo/.git/index").unwrap();

        let result = execute_git_cli(&fs, "/repo", &["commit", "--amend", flag, "-m", "renamed"]);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let new_oid = resolve_ref(&fs, "/repo/.git", "HEAD", None).unwrap();
        let new = read_commit(&fs, "/repo/.git", &new_oid).unwrap();
        assert_ne!(old_oid, new_oid);
        assert_eq!(new.commit.tree, old.commit.tree, "{flag}");
        assert_eq!(new.commit.parent, old.commit.parent);
        assert_eq!(new.commit.message.trim(), "renamed");
        assert_eq!(fs.read("/repo/.git/index").unwrap(), index);
        assert_eq!(fs.read_str("/repo/a").unwrap(), "unstaged");
        assert_eq!(fs.read_str("/repo/b").unwrap(), "other");
        for args in [
            vec!["commit", flag, "-m", "invalid"],
            vec!["commit", "--amend", flag, "--all", "-m", "invalid"],
        ] {
            assert_ne!(execute_git_cli(&fs, "/repo", &args).exit_code, 0);
            assert_eq!(
                resolve_ref(&fs, "/repo/.git", "HEAD", None).unwrap(),
                new_oid
            );
            assert_eq!(fs.read("/repo/.git/index").unwrap(), index);
        }

        let staged = execute_git_cli(&fs, "/repo", &["diff", "--cached", "--name-only"]);
        assert_eq!(staged.exit_code, 0);
        assert_eq!(staged.stdout, "a\nb\n");

        let selected = execute_git_cli(
            &fs,
            "/repo",
            &["commit", "--amend", flag, "-m", "selected", "a"],
        );
        assert_eq!(selected.exit_code, 0, "{}", selected.stderr);
        assert_eq!(
            execute_git_cli(&fs, "/repo", &["show", "HEAD:a"]).stdout,
            "unstaged"
        );
        assert_eq!(
            execute_git_cli(&fs, "/repo", &["show", "HEAD:b"]).stdout,
            "second\n"
        );
        assert_eq!(
            execute_git_cli(&fs, "/repo", &["diff", "--cached", "--name-only"]).stdout,
            "b\n"
        );

        let ordinary = execute_git_cli(&fs, "/repo", &["commit", "--amend", "-m", "ordinary"]);
        assert_eq!(ordinary.exit_code, 0, "{}", ordinary.stderr);
        assert_eq!(
            execute_git_cli(&fs, "/repo", &["show", "HEAD:b"]).stdout,
            "other"
        );
    }
}
