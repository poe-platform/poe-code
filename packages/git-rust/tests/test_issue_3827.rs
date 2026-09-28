use git_rust::{CliResult, MemoryFs, execute_git_cli};
fn run(fs: &MemoryFs, args: &[&str]) -> CliResult {
    execute_git_cli(fs, "/repo", args)
}
fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    for args in [
        vec!["init", "-b", "main"],
        vec!["config", "user.name", "Tester"],
        vec!["config", "user.email", "t@e.st"],
    ] {
        assert_eq!(run(&fs, &args).exit_code, 0);
    }
    fs.write_str("/repo/a.txt", "one\n");
    run(&fs, &["add", "."]);
    run(&fs, &["commit", "-m", "first"]);
    fs.write_str("/repo/a.txt", "two\n");
    run(&fs, &["add", "."]);
    run(&fs, &["commit", "-m", "second\n\nbody\nlast"]);
    fs
}
#[test]
fn log_output_options() {
    let fs = repo();
    assert_eq!(
        run(&fs, &["log", "--reverse", "--format=%s"]).stdout,
        "first\nsecond\n"
    );
    assert_eq!(
        run(&fs, &["log", "-1", "--reverse", "--format=%s"]).stdout,
        "second\n"
    );
    for (flag, expected) in [
        ("--name-only", "a.txt\n"),
        ("--name-status", "M\ta.txt\n"),
        ("--stat", "1 file changed"),
        ("-p", "-one\n+two\n"),
        ("--patch", "-one\n+two\n"),
    ] {
        let r = run(&fs, &["log", "-1", "--format=%s", flag]);
        assert_eq!(r.exit_code, 0, "{flag}: {}", r.stderr);
        assert!(r.stdout.contains(expected), "{flag}: {}", r.stdout);
    }
    let oid = run(&fs, &["rev-parse", "HEAD"]).stdout;
    assert!(
        run(&fs, &["log", "-1", "--abbrev-commit"])
            .stdout
            .starts_with(&format!("commit {}\n", &oid[..7]))
    );
}
#[test]
fn show_output_options() {
    let fs = repo();
    for flag in ["-s", "--no-patch"] {
        assert_eq!(
            run(&fs, &["show", flag, "--format=%s", "HEAD"]).stdout,
            "second\n"
        );
    }
    let default = run(&fs, &["show", "HEAD"]);
    assert!(default.stdout.contains("Date:   "));
    assert!(
        default
            .stdout
            .contains("    second\n    \n    body\n    last\n")
    );
    for (flag, expected) in [
        ("--name-only", "a.txt\n"),
        ("--name-status", "M\ta.txt\n"),
        ("--stat", "1 file changed"),
    ] {
        let r = run(&fs, &["show", "--pretty=%s", flag, "HEAD"]);
        assert_eq!(r.exit_code, 0, "{}", r.stderr);
        assert!(r.stdout.contains(expected), "{}", r.stdout);
        assert!(!r.stdout.contains("diff --git"));
    }
    let oid = run(&fs, &["rev-parse", "HEAD"]).stdout;
    assert_eq!(
        run(&fs, &["show", "--oneline", "-s"]).stdout,
        format!("{} second\n", &oid[..7])
    );
}
#[test]
fn revision_validation_and_short_lengths() {
    let fs = repo();
    assert_eq!(
        run(&fs, &["rev-parse", "--abbrev-ref", "missing"]).exit_code,
        128
    );
    assert_eq!(
        run(&fs, &["rev-parse", "--abbrev-ref", "HEAD"]).stdout,
        "main\n"
    );
    let oid = run(&fs, &["rev-parse", "HEAD"]).stdout;
    for n in [4, 8, 12, 40, 50] {
        assert_eq!(
            run(&fs, &["rev-parse", &format!("--short={n}"), "HEAD"]).stdout,
            format!("{}\n", &oid[..n.min(40)])
        );
    }
    let unborn = MemoryFs::new();
    run(&unborn, &["init"]);
    assert_eq!(
        run(&unborn, &["rev-parse", "--abbrev-ref", "HEAD"]).exit_code,
        128
    );
}
#[test]
fn untracked_directories_and_modes() {
    let fs = repo();
    fs.write_str("/repo/new/nested/a.txt", "new");
    fs.write_str("/repo/new/b.txt", "new");
    fs.write_str("/repo/mixed/tracked.txt", "tracked");
    run(&fs, &["add", "mixed/tracked.txt"]);
    fs.write_str("/repo/mixed/loose/deep.txt", "new");
    for mode in [None, Some("-unormal"), Some("--untracked-files=normal")] {
        let mut args = vec!["status", "-s"];
        if let Some(mode) = mode {
            args.push(mode);
        }
        assert_eq!(
            run(&fs, &args).stdout,
            "A  mixed/tracked.txt\n?? mixed/loose/\n?? new/\n"
        );
    }
    for mode in ["-uall", "-u", "--untracked-files=all", "--untracked-files"] {
        assert!(
            run(&fs, &["status", "-s", mode])
                .stdout
                .contains("?? new/nested/a.txt\n")
        );
    }
    assert_eq!(
        run(&fs, &["status", "-s", "--", "new/nested/a.txt"]).stdout,
        "?? new/nested/a.txt\n"
    );
    assert!(!run(&fs, &["status", "-s", "-uno"]).stdout.contains("??"));
}

#[test]
fn show_patch_and_stat_combine_in_either_order() {
    let fs = repo();
    for args in [vec!["show", "-p", "--stat"], vec!["show", "--stat", "-p"]] {
        let r = run(&fs, &args);
        assert_eq!(r.exit_code, 0);
        assert!(r.stdout.contains("1 file changed"));
        assert!(r.stdout.contains("diff --git"), "{}", r.stdout);
        assert!(r.stdout.contains("    last\n---\n"), "{}", r.stdout);
    }
}

#[test]
fn oneline_diff_spacing_and_names_override_patch() {
    let fs = repo();
    let line = run(&fs, &["log", "-1", "--oneline"]).stdout;
    let stat = run(&fs, &["diff", "--stat", "HEAD^", "HEAD"]).stdout;
    for command in ["show", "log"] {
        assert_eq!(
            run(&fs, &[command, "-1", "--oneline", "--stat"]).stdout,
            format!("{line}{stat}")
        );
        assert_eq!(
            run(&fs, &[command, "-1", "-p", "--format=%s", "--name-only"]).stdout,
            "second\n\na.txt\n"
        );
    }
}
