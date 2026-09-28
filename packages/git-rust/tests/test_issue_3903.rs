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
    ok(&fs, &["config", "user.name", "Tester"]);
    ok(&fs, &["config", "user.email", "t@example.com"]);
    for message in ["first", "second"] {
        fs.write_str("/repo/a.txt", &format!("{message}\n"));
        ok(&fs, &["add", "."]);
        ok(&fs, &["commit", "-m", message]);
    }
    fs
}

#[test]
fn rev_parse_requires_repository() {
    let fs = MemoryFs::new();
    for flag in ["--show-toplevel", "--git-dir", "--is-inside-work-tree"] {
        let r = run(&fs, &["rev-parse", flag]);
        assert_eq!(r.exit_code, 128, "{flag}");
        assert_eq!(r.stdout, "");
        assert_eq!(
            r.stderr,
            "fatal: not a git repository (or any of the parent directories): .git\n"
        );
    }
    let fs = repo();
    assert_eq!(
        execute_git_cli(&fs, "/repo/sub", &["rev-parse", "--show-toplevel"]).stdout,
        "/repo\n"
    );
}

#[test]
fn no_patch_order_controls_diff_modes() {
    let fs = repo();
    for command in ["show", "log"] {
        for suppress in ["-s", "--no-patch"] {
            let before = ok(&fs, &[command, "-1", "--format=%s", suppress, "--stat"]);
            assert!(before.contains("a.txt |"), "{before}");
            for mode in ["--stat", "--name-only", "--name-status", "-p"] {
                assert_eq!(
                    ok(&fs, &[command, "-1", "--format=%s", mode, suppress]),
                    "second\n"
                );
            }
            for mode in ["--name-only", "--name-status"] {
                let r = run(&fs, &[command, suppress, mode]);
                assert_eq!(r.exit_code, 128);
                assert_eq!(
                    r.stderr,
                    "fatal: options '--name-only', '--name-status', '--check', and '-s' cannot be used together\n"
                );
            }
            assert!(ok(&fs, &[command, "-1", suppress, "-p"]).contains("diff --git"));
        }
    }
}

#[test]
fn format_diff_separator_is_one_newline() {
    let fs = repo();
    assert_eq!(
        ok(&fs, &["log", "-2", "--format=format:%s", "--name-only"]),
        "second\na.txt\n\nfirst\na.txt\n"
    );
    for mode in ["--stat", "-p", "--name-status"] {
        let text = ok(&fs, &["log", "-1", "--format=format:%s", mode]);
        assert!(text.starts_with("second\n"));
        assert!(!text.starts_with("second\n\n"), "{text}");
    }
}

#[test]
fn subjects_parents_trees_and_dates_expand() {
    let fs = repo();
    let parent = ok(&fs, &["rev-parse", "HEAD"]).trim().to_string();
    let tree = ok(&fs, &["rev-parse", "HEAD^{tree}"]).trim().to_string();
    // Construct an object directly so author and committer dates differ deterministically.
    let oid = git_rust::write_object(&fs, "/repo/.git", "commit", Some("commit"), Some(format!("tree {tree}\nparent {parent}\nauthor A <a@b> 0 +0530\ncommitter C <c@d> 86400 -0700\n\nsub1\nsub2\n\nbody\n").as_bytes()), None, None, None, false).unwrap();
    let template = "--format=%s|%P|%p|%T|%t|%at|%ct|%ai|%ci|%ad|%cd";
    assert_eq!(
        ok(&fs, &["log", "-1", template, &oid]),
        format!(
            "sub1 sub2|{parent}|{}|{tree}|{}|0|86400|1970-01-01 05:30:00 +0530|1970-01-01 17:00:00 -0700|Thu Jan 1 05:30:00 1970 +0530|Thu Jan 1 17:00:00 1970 -0700\n",
            &parent[..7],
            &tree[..7]
        )
    );
}

#[test]
fn merge_headers_and_default_log_diff() {
    let fs = repo();
    let main = ok(&fs, &["rev-parse", "HEAD"]).trim().to_string();
    ok(&fs, &["checkout", "-b", "side", "HEAD^"]);
    fs.write_str("/repo/side.txt", "side\n");
    ok(&fs, &["add", "."]);
    ok(&fs, &["commit", "-m", "side"]);
    let side = ok(&fs, &["rev-parse", "HEAD"]).trim().to_string();
    ok(&fs, &["checkout", "main"]);
    ok(&fs, &["merge", "side"]);
    for preset in ["medium", "short", "full"] {
        let text = ok(&fs, &["log", "-1", &format!("--format={preset}")]);
        assert!(
            text.contains(&format!("\nMerge: {} {}\nAuthor:", &main[..7], &side[..7])),
            "{text}"
        );
    }
    assert_eq!(
        ok(&fs, &["log", "-1", "--format=%P"]),
        format!("{main} {side}\n")
    );
    for mode in ["-p", "--stat", "--name-only"] {
        assert_eq!(ok(&fs, &["log", "-1", "--format=merged", mode]), "merged\n");
    }
}
