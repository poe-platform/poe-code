use git_rust::{CliResult, MemoryFs, execute_git_cli};

fn run(fs: &MemoryFs, args: &[&str]) -> CliResult {
    execute_git_cli(fs, "/repo", args)
}
fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    assert_eq!(run(&fs, &["init", "-b", "main"]).exit_code, 0);
    run(&fs, &["config", "user.name", "Test User"]);
    run(&fs, &["config", "user.email", "test@example.com"]);
    fs.write_str("/repo/a.txt", "one\n");
    fs.write_str("/repo/dir/b.txt", "two\n");
    run(&fs, &["add", "."]);
    assert_eq!(run(&fs, &["commit", "-m", "first commit"]).exit_code, 0);
    run(&fs, &["branch", "first"]);
    fs.write_str("/repo/a.txt", "one-mod\n");
    run(&fs, &["add", "."]);
    assert_eq!(run(&fs, &["commit", "-m", "second commit"]).exit_code, 0);
    fs
}

#[test]
fn status_branch_and_untracked_options() {
    let fs = repo();
    fs.write_str("/repo/a.txt", "dirty\n");
    fs.write_str("/repo/u.txt", "untracked\n");
    for flags in [
        vec!["-sb"],
        vec!["-bs"],
        vec!["-s", "-b"],
        vec!["--short", "--branch"],
        vec!["--porcelain", "-b"],
    ] {
        let mut args = vec!["status"];
        args.extend(flags);
        let result = run(&fs, &args);
        assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
        assert_eq!(result.stdout, "## main\n M a.txt\n?? u.txt\n", "{args:?}");
    }
    for flag in ["-uno", "--untracked-files=no"] {
        assert_eq!(run(&fs, &["status", "-s", flag]).stdout, " M a.txt\n");
        assert!(!run(&fs, &["status", flag]).stdout.contains("u.txt"));
    }
    assert!(
        run(&fs, &["status", "-b"])
            .stdout
            .starts_with("On branch main\n")
    );
}

#[test]
fn status_pathspecs_and_separator() {
    let fs = repo();
    fs.write_str("/repo/a.txt", "dirty\n");
    fs.write_str("/repo/dir/b.txt", "dirty\n");
    fs.write_str("/repo/-s", "untracked\n");
    for args in [
        vec!["status", "-s", "a.txt"],
        vec!["status", "-s", "--", "a.txt"],
    ] {
        assert_eq!(run(&fs, &args).stdout, " M a.txt\n");
    }
    assert_eq!(run(&fs, &["status", "-s", "dir"]).stdout, " M dir/b.txt\n");
    assert_eq!(
        run(&fs, &["status", "--porcelain", "--", "-s"]).stdout,
        "?? -s\n"
    );
    assert_eq!(
        execute_git_cli(&fs, "/repo/dir", &["status", "--porcelain", "b.txt"]).stdout,
        " M dir/b.txt\n"
    );
}

#[test]
fn log_formats_and_presets() {
    let fs = repo();
    let oid = run(&fs, &["rev-parse", "HEAD"]).stdout.trim().to_string();
    for option in ["--pretty=oneline", "--format=oneline"] {
        let result = run(&fs, &["log", "-1", option]);
        assert_eq!(result.exit_code, 0);
        assert_eq!(result.stdout, format!("{oid} second commit\n"));
    }
    for flag in ["--format", "--pretty"] {
        assert_eq!(
            run(&fs, &["log", "-1", flag, "%H"]).stdout,
            format!("{oid}\n")
        );
        assert_eq!(run(&fs, &["log", "-1", flag, "format:%H"]).stdout, oid);
    }
    for preset in ["short", "medium", "full"] {
        let result = run(&fs, &["log", "-1", &format!("--pretty={preset}")]);
        assert_eq!(result.exit_code, 0);
        assert!(
            result.stdout.starts_with(&format!("commit {oid}\nAuthor:")),
            "{}",
            result.stdout
        );
        assert!(result.stdout.contains("    second commit\n"));
        assert_eq!(result.stdout.contains("Date:"), preset == "medium");
        assert_eq!(result.stdout.contains("Commit:"), preset == "full");
    }
}

#[test]
fn log_ranges_paths_and_filtered_limits() {
    let fs = repo();
    fs.write_str("/repo/dir/b.txt", "changed\n");
    run(&fs, &["add", "."]);
    run(&fs, &["commit", "-m", "third commit"]);
    let result = run(&fs, &["log", "--format=%s", "first..HEAD"]);
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "third commit\nsecond commit\n");
    assert_eq!(run(&fs, &["log", "--format=%s", "HEAD..HEAD"]).stdout, "");
    for args in [
        vec!["log", "--format=%s", "--", "a.txt"],
        vec!["log", "--format=%s", "a.txt"],
    ] {
        let result = run(&fs, &args);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, "second commit\nfirst commit\n");
    }
    assert_eq!(
        run(&fs, &["log", "-1", "--format=%s", "--", "a.txt"]).stdout,
        "second commit\n"
    );
    assert_eq!(
        run(&fs, &["log", "--format=%s", "first..HEAD", "--", "dir"]).stdout,
        "third commit\n"
    );
    assert_eq!(
        run(&fs, &["log", "--format=%s", "--", "missing"]).stdout,
        ""
    );
    assert_eq!(
        run(&fs, &["log", "--format=%s", "--", "a.txt", "dir"]).stdout,
        "third commit\nsecond commit\nfirst commit\n"
    );
}

#[test]
fn diff_ranges_and_output_modes() {
    let fs = repo();
    for range in ["first..HEAD", "first...HEAD"] {
        let result = run(&fs, &["diff", range]);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert!(result.stdout.contains("-one\n+one-mod\n"));
        assert_eq!(run(&fs, &["diff", "--name-only", range]).stdout, "a.txt\n");
        assert_eq!(
            run(&fs, &["diff", "--name-status", range]).stdout,
            "M\ta.txt\n"
        );
        assert_eq!(
            run(&fs, &["diff", "--stat", range]).stdout,
            " a.txt | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)\n"
        );
    }
    for flag in ["-q", "--quiet"] {
        let result = run(&fs, &["diff", flag, "first..HEAD"]);
        assert_eq!(result.exit_code, 1);
        assert_eq!(result.stdout, "");
        assert_eq!(run(&fs, &["diff", flag]).exit_code, 0);
    }
    fs.write_str("/repo/a.txt", "dirty\n");
    assert_eq!(run(&fs, &["diff", "--name-only"]).stdout, "a.txt\n");
    assert_eq!(run(&fs, &["diff", "--name-only", "--", "dir"]).stdout, "");
}

#[test]
fn diff_three_dot_uses_merge_base_and_context_is_configurable() {
    let fs = repo();
    assert_eq!(run(&fs, &["checkout", "first"]).exit_code, 0);
    assert_eq!(run(&fs, &["checkout", "-b", "side"]).exit_code, 0);
    fs.write_str("/repo/dir/b.txt", "side\n");
    run(&fs, &["add", "."]);
    run(&fs, &["commit", "-m", "side commit"]);
    assert_eq!(
        run(&fs, &["diff", "--name-only", "main...side"]).stdout,
        "dir/b.txt\n"
    );
    assert_eq!(
        run(&fs, &["diff", "--name-only", "main..side"]).stdout,
        "a.txt\ndir/b.txt\n"
    );
    fs.write_str("/repo/a.txt", "one\ncontext\nlast\n");
    run(&fs, &["add", "."]);
    run(&fs, &["commit", "-m", "context"]);
    fs.write_str("/repo/a.txt", "changed\ncontext\nlast\n");
    for flag in ["-U0", "--unified=0"] {
        let result = run(&fs, &["diff", flag]);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert!(result.stdout.contains("@@ -1 +1 @@\n-one\n+changed\n"));
        assert!(!result.stdout.contains(" context\n"));
    }
}

#[test]
fn diff_context_splits_separated_changes_and_stat_counts_only_edits() {
    let fs = repo();
    fs.write_str("/repo/a.txt", "a\nb\nc\nd\ne\nf\ng\n");
    run(&fs, &["add", "."]);
    run(&fs, &["commit", "-m", "lines"]);
    fs.write_str("/repo/a.txt", "A\nb\nc\nd\ne\nf\nG\n");
    let result = run(&fs, &["diff", "-U0"]);
    assert_eq!(result.exit_code, 0);
    assert!(
        result
            .stdout
            .contains("@@ -1 +1 @@\n-a\n+A\n@@ -7 +7 @@\n-g\n+G\n"),
        "{}",
        result.stdout
    );
    assert_eq!(
        run(&fs, &["diff", "--stat"]).stdout,
        " a.txt | 4 ++--\n 1 file changed, 2 insertions(+), 2 deletions(-)\n"
    );
}
