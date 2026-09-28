use git_rust::{CliResult, MemoryFs, execute_git_cli};

fn run(fs: &MemoryFs, args: &[&str]) -> CliResult {
    execute_git_cli(fs, "/repo", args)
}
fn ok(fs: &MemoryFs, args: &[&str]) -> String {
    let r = run(fs, args);
    assert_eq!(r.exit_code, 0, "{args:?}: {}", r.stderr);
    r.stdout
}
fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    ok(&fs, &["init", "-b", "main"]);
    for n in 1..=2 {
        fs.write_str("/repo/a.txt", &format!("a{n}\n"));
        fs.write_str("/repo/b.txt", &format!("b{n}\n"));
        ok(&fs, &["add", "."]);
        ok(&fs, &["commit", "-m", &format!("commit {n}")]);
    }
    fs
}

#[test]
fn checkout_revision_paths_preserves_head_and_unselected_files() {
    for revision in ["HEAD~1", "old"] {
        let fs = repo();
        ok(&fs, &["branch", "old", "HEAD~1"]);
        let head = ok(&fs, &["rev-parse", "HEAD"]);
        fs.write_str("/repo/b.txt", "local b\n");
        ok(&fs, &["checkout", revision, "a.txt"]);
        assert_eq!(ok(&fs, &["branch", "--show-current"]), "main\n");
        assert_eq!(ok(&fs, &["rev-parse", "HEAD"]), head);
        assert_eq!(ok(&fs, &["show", ":a.txt"]), "a1\n");
        assert_eq!(fs.read_str("/repo/a.txt").unwrap(), "a1\n");
        assert_eq!(fs.read_str("/repo/b.txt").unwrap(), "local b\n");
        assert_eq!(ok(&fs, &["show", ":b.txt"]), "b2\n");
        assert_ne!(run(&fs, &["checkout", revision, "missing"]).exit_code, 0);
        assert_eq!(ok(&fs, &["rev-parse", "HEAD"]), head);
    }
}

#[test]
fn checkout_and_switch_reset_branches_at_start_point() {
    for (command, flag) in [("checkout", "-B"), ("switch", "-C")] {
        for name in ["main", "new"] {
            let fs = repo();
            let old = ok(&fs, &["rev-parse", "HEAD~1"]);
            ok(&fs, &[command, flag, name, "HEAD~1"]);
            assert_eq!(ok(&fs, &["rev-parse", name]), old);
            assert_eq!(ok(&fs, &["branch", "--show-current"]), format!("{name}\n"));
            assert_eq!(fs.read_str("/repo/a.txt").unwrap(), "a1\n");
        }
    }
    let fs = repo();
    let head = ok(&fs, &["rev-parse", "HEAD"]);
    assert_ne!(
        run(&fs, &["checkout", "-f", "-b", "main", "HEAD~1"]).exit_code,
        0
    );
    assert_eq!(ok(&fs, &["rev-parse", "main"]), head);
}
