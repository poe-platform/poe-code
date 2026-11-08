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
#[test]
fn tag_message_options_do_not_become_tag_names() {
    for args in [
        vec!["tag", "-a", "-m", "message", "v1", "HEAD~1"],
        vec!["tag", "-m", "message", "v1", "HEAD~1"],
        vec!["tag", "v1", "HEAD~1", "-m", "message", "-a"],
    ] {
        let fs = repo();
        let old = ok(&fs, &["rev-parse", "HEAD~1"]);
        ok(&fs, &args);
        assert_eq!(ok(&fs, &["tag"]), "v1\n");
        assert_eq!(ok(&fs, &["cat-file", "-t", "v1"]), "tag\n");
        assert_eq!(ok(&fs, &["rev-parse", "v1^{}"]), old);
        assert!(ok(&fs, &["cat-file", "-p", "v1"]).contains("message"));
    }
    let fs = repo();
    assert_ne!(run(&fs, &["tag", "-m"]).exit_code, 0);
    assert_eq!(ok(&fs, &["tag"]), "");
}
#[test]
fn annotated_tags_are_peeled_only_for_commit_consumers() {
    for command in [
        "branch",
        "checkout-new",
        "checkout",
        "reset",
        "merge",
        "cherry-pick",
    ] {
        let fs = repo();
        let head = ok(&fs, &["rev-parse", "HEAD"]);
        ok(&fs, &["tag", "-a", "v2", "-m", "v2 message"]);
        let tag = ok(&fs, &["rev-parse", "v2"]);
        assert_ne!(tag, head);
        ok(&fs, &["tag", "-a", "nested", "-m", "nested", "v2"]);
        match command {
            "branch" => {
                ok(&fs, &["branch", "from-tag", "nested"]);
            }
            "checkout-new" => {
                ok(&fs, &["checkout", "-b", "from-tag", "nested"]);
            }
            "checkout" => {
                ok(&fs, &["checkout", "nested"]);
            }
            "reset" => {
                ok(&fs, &["reset", "--hard", "HEAD~1"]);
                ok(&fs, &["reset", "--hard", "nested"]);
            }
            "merge" => {
                ok(&fs, &["reset", "--hard", "HEAD~1"]);
                ok(&fs, &["merge", "nested"]);
            }
            _ => {
                ok(&fs, &["reset", "--hard", "HEAD~1"]);
                ok(&fs, &["cherry-pick", "nested"]);
            }
        }
        if matches!(command, "branch" | "checkout-new") {
            assert_eq!(ok(&fs, &["rev-parse", "from-tag"]), head);
        } else if command != "cherry-pick" {
            assert_eq!(ok(&fs, &["rev-parse", "HEAD"]), head);
        }
        if command != "branch" {
            assert_eq!(fs.read_str("/repo/a.txt").unwrap(), "a2\n");
            assert_eq!(ok(&fs, &["cat-file", "-t", "HEAD"]), "commit\n");
        }
        assert_eq!(ok(&fs, &["rev-parse", "v2"]), tag);
    }
}
#[test]
fn at_sign_is_head_with_ancestry_and_path_operators() {
    let fs = repo();
    for (alias, revision) in [
        ("@", "HEAD"),
        ("@~1", "HEAD~1"),
        ("@^", "HEAD^"),
        ("@:a.txt", "HEAD:a.txt"),
    ] {
        assert_eq!(
            ok(&fs, &["rev-parse", alias]),
            ok(&fs, &["rev-parse", revision])
        );
    }
    assert_eq!(ok(&fs, &["show", "@:a.txt"]), "a2\n");
    let head = ok(&fs, &["rev-parse", "HEAD"]);
    ok(&fs, &["checkout", "@~1", "--", "a.txt"]);
    assert_eq!(fs.read_str("/repo/a.txt").unwrap(), "a1\n");
    assert_eq!(ok(&fs, &["rev-parse", "HEAD"]), head);
    ok(&fs, &["checkout", "-f", "@"]);
    assert_eq!(ok(&fs, &["rev-parse", "HEAD"]), head);
}

#[test]
fn branch_creation_preserves_unborn_head_and_failed_resets() {
    for (command, create, reset) in [("checkout", "-b", "-B"), ("switch", "-c", "-C")] {
        let fs = MemoryFs::new();
        ok(&fs, &["init", "-b", "main"]);
        ok(&fs, &[command, create, "initial"]);
        assert_eq!(ok(&fs, &["branch", "--show-current"]), "initial\n");
        let fs = repo();
        let head = ok(&fs, &["rev-parse", "HEAD"]);
        ok(&fs, &["branch", "existing", "HEAD~1"]);
        ok(&fs, &[command, reset, "existing"]);
        assert_eq!(ok(&fs, &["rev-parse", "existing"]), head);
        fs.write_str("/repo/a.txt", "local\n");
        assert_ne!(
            run(&fs, &[command, reset, "existing", "HEAD~1"]).exit_code,
            0
        );
        assert_eq!(ok(&fs, &["rev-parse", "existing"]), head);
        assert_eq!(fs.read_str("/repo/a.txt").unwrap(), "local\n");
        assert_ne!(run(&fs, &[command, reset, "new", "HEAD~1"]).exit_code, 0);
        assert_ne!(run(&fs, &["rev-parse", "new"]).exit_code, 0);
        assert_eq!(ok(&fs, &["branch", "--show-current"]), "existing\n");
    }
}

#[test]
fn annotated_tag_ancestry_and_non_commit_targets() {
    let fs = repo();
    let old = ok(&fs, &["rev-parse", "HEAD~1"]);
    let head = ok(&fs, &["rev-parse", "HEAD"]);
    ok(&fs, &["tag", "-a", "v2", "-m", "message"]);
    for revision in ["v2~1", "v2^", "v2^1"] {
        assert_eq!(ok(&fs, &["rev-parse", revision]), old);
    }
    for revision in ["v2~0", "v2^0"] {
        assert_eq!(ok(&fs, &["rev-parse", revision]), head);
    }
    let blob = ok(&fs, &["rev-parse", "HEAD:a.txt"]);
    ok(&fs, &["tag", "-a", "blob-tag", "-m", "blob", blob.trim()]);
    for args in [
        vec!["branch", "bad", "blob-tag"],
        vec!["checkout", "blob-tag"],
        vec!["reset", "--soft", "blob-tag"],
    ] {
        assert_ne!(run(&fs, &args).exit_code, 0);
        assert_eq!(ok(&fs, &["rev-parse", "HEAD"]), head);
        assert_eq!(ok(&fs, &["branch", "--show-current"]), "main\n");
    }
}
