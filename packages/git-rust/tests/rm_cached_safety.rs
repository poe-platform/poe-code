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
    git(&fs, &["add", "."]);
    git(&fs, &["commit", "-m", "base"]);
    fs
}

#[test]
fn cached_removal_refuses_unique_staged_content_before_removing_any_path() {
    for paths in [vec!["a"], vec!["b", "a"]] {
        let fs = repo();
        fs.write_str("/repo/a", "staged");
        git(&fs, &["add", "a"]);
        fs.write_str("/repo/a", "newer");
        let index = fs.read("/repo/.git/index");
        let head = git(&fs, &["rev-parse", "HEAD"]);
        let mut args = vec!["rm", "--cached"];
        args.extend(paths);

        let result = execute_git_cli(&fs, "/repo", &args);

        assert_eq!(result.exit_code, 1, "{}", result.stderr);
        assert!(result.stderr.contains("a"));
        assert_eq!(fs.read("/repo/.git/index"), index);
        assert_eq!(git(&fs, &["show", ":a"]), "staged");
        assert_eq!(git(&fs, &["rev-parse", "HEAD"]), head);
        assert_eq!(fs.read_str("/repo/a").as_deref(), Some("newer"));
        assert_eq!(fs.read_str("/repo/b").as_deref(), Some("second\n"));
    }
}

#[test]
fn cached_removal_accepts_a_staged_copy_in_head_or_worktree_or_force() {
    for (staged, working, force) in [
        ("base\n", "newer", None),
        ("staged", "staged", None),
        ("staged", "newer", Some("-f")),
        ("staged", "newer", Some("--force")),
    ] {
        let fs = repo();
        fs.write_str("/repo/a", staged);
        git(&fs, &["add", "a"]);
        fs.write_str("/repo/a", working);
        let head = git(&fs, &["rev-parse", "HEAD"]);
        let mut args = vec!["rm", "--cached", "a"];
        args.extend(force);
        git(&fs, &args);
        assert_eq!(git(&fs, &["ls-files"]), "b\n");
        assert_eq!(fs.read_str("/repo/a").as_deref(), Some(working));
        assert_eq!(git(&fs, &["rev-parse", "HEAD"]), head);
    }
}

#[test]
fn cached_removal_checks_new_files_without_head() {
    for working in ["staged", "newer"] {
        let fs = MemoryFs::new();
        git(&fs, &["init"]);
        fs.write_str("/repo/a", "staged");
        git(&fs, &["add", "a"]);
        fs.write_str("/repo/a", working);
        let index = fs.read("/repo/.git/index");
        let result = execute_git_cli(&fs, "/repo", &["rm", "--cached", "a"]);
        if working == "staged" {
            assert_eq!(result.exit_code, 0);
            assert_eq!(git(&fs, &["ls-files"]), "");
        } else {
            assert_eq!(result.exit_code, 1);
            assert_eq!(fs.read("/repo/.git/index"), index);
        }
        assert_eq!(fs.read_str("/repo/a").as_deref(), Some(working));
    }
}
