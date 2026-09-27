use git_rust::{CliResult, MemoryFs, execute_git_cli};

fn run(fs: &MemoryFs, args: &[&str]) -> CliResult {
    execute_git_cli(fs, "/repo", args)
}
fn ok(fs: &MemoryFs, args: &[&str]) -> String {
    let result = run(fs, args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}
fn commit(fs: &MemoryFs, content: &str, message: &str) -> String {
    fs.write_str("/repo/a.txt", content);
    ok(fs, &["add", "."]);
    ok(fs, &["commit", "-m", message]);
    ok(fs, &["rev-parse", "HEAD"]).trim().to_string()
}
fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    ok(&fs, &["init", "-b", "main"]);
    commit(&fs, "base\n", "base");
    fs
}

#[test]
fn porcelain_matches_short_status() {
    let fs = repo();
    fs.write_str("/repo/a.txt", "changed\n");
    for flag in ["--porcelain", "--porcelain=v1"] {
        assert_eq!(ok(&fs, &["status", flag]), " M a.txt\n");
    }
    ok(&fs, &["add", "a.txt"]);
    fs.write_str("/repo/a.txt", "changed again\n");
    fs.write_str("/repo/new.txt", "new\n");
    assert_eq!(
        ok(&fs, &["status", "--porcelain"]),
        "MM a.txt\n?? new.txt\n"
    );
}

#[test]
fn diff_disambiguates_paths_and_compares_two_revisions() {
    let fs = repo();
    ok(&fs, &["branch", "feature"]);
    commit(&fs, "main\n", "main");
    fs.write_str("/repo/a.txt", "working\n");
    assert_eq!(
        ok(&fs, &["diff", "a.txt"]),
        ok(&fs, &["diff", "--", "a.txt"])
    );
    let between = ok(&fs, &["diff", "feature", "main"]);
    assert!(between.contains("-base\n+main\n"), "{between}");
    assert!(!between.contains("working"));
    assert_eq!(
        between,
        ok(&fs, &["diff", "feature", "main", "--", "a.txt"])
    );
    let from_revision = ok(&fs, &["diff", "feature", "a.txt"]);
    assert!(from_revision.contains("-base\n+working\n"));
    fs.write_str("/repo/sub/file", "sub\n");
    ok(&fs, &["add", "."]);
    fs.write_str("/repo/sub/file", "modified\n");
    let sub = execute_git_cli(&fs, "/repo/sub", &["diff", "file"]);
    assert_eq!(sub.exit_code, 0, "{}", sub.stderr);
    assert!(sub.stdout.contains("a/sub/file"));
    assert_ne!(run(&fs, &["diff", "unknown-revision"]).exit_code, 0);
}

#[test]
fn branch_flags_list_and_rename_without_creating_option_names() {
    let fs = repo();
    assert_eq!(ok(&fs, &["branch", "--show-current"]), "main\n");
    let oid = ok(&fs, &["rev-parse", "HEAD"]);
    fs.write_str("/repo/.git/refs/remotes/origin/main", &oid);
    assert_eq!(ok(&fs, &["branch", "-r"]), "  origin/main\n");
    assert_eq!(
        ok(&fs, &["branch", "-a"]),
        "* main\n  remotes/origin/main\n"
    );
    ok(&fs, &["branch", "-m", "renamed"]);
    assert_eq!(ok(&fs, &["branch", "--show-current"]), "renamed\n");
    ok(&fs, &["branch", "target"]);
    assert_ne!(
        run(&fs, &["branch", "-m", "renamed", "target"]).exit_code,
        0
    );
    ok(&fs, &["branch", "-M", "renamed", "target"]);
    assert_eq!(ok(&fs, &["branch"]), "* target\n");
    assert_ne!(run(&fs, &["branch", "--unknown"]).exit_code, 0);
    assert_eq!(ok(&fs, &["branch"]), "* target\n");
    ok(&fs, &["checkout", "--detach", "HEAD"]);
    assert_eq!(ok(&fs, &["branch", "--show-current"]), "");
}

#[test]
fn log_count_format_and_revision_are_respected() {
    let fs = repo();
    let base = ok(&fs, &["rev-parse", "HEAD"]).trim().to_string();
    ok(&fs, &["branch", "feature"]);
    let head = commit(&fs, "second\n", "second\n\nbody");
    for flags in [vec!["-n", "1"], vec!["-1"], vec!["--max-count=1"]] {
        let mut args = vec!["log"];
        args.extend(flags);
        args.push("--format=%H");
        assert_eq!(ok(&fs, &args), format!("{head}\n"));
    }
    assert_eq!(ok(&fs, &["log", "--max-count=0", "--format=%H"]), "");
    assert_eq!(
        ok(&fs, &["log", "--pretty=format:%h %s", "feature"]),
        format!("{} base", &base[..7])
    );
    assert_eq!(
        ok(&fs, &["log", "--format=%H", "feature"]),
        format!("{base}\n")
    );
    assert_eq!(
        ok(&fs, &["log", "--format=%H"]),
        format!("{head}\n{base}\n")
    );
    assert_eq!(
        ok(&fs, &["log", "-1", "--format=%an <%ae>|%cn <%ce>|%%|%b"]),
        "Git User <user@example.com>|Git User <user@example.com>|%|body\n\n"
    );
    assert_ne!(run(&fs, &["log", "-n"]).exit_code, 0);
    assert_ne!(run(&fs, &["log", "--max-count=oops"]).exit_code, 0);
}

#[test]
fn branch_rename_works_before_the_first_commit() {
    let fs = MemoryFs::new();
    ok(&fs, &["init"]);
    ok(&fs, &["branch", "-m", "main"]);
    assert_eq!(ok(&fs, &["branch", "--show-current"]), "main\n");
    ok(&fs, &["branch", "-M", "new-main"]);
    assert_eq!(ok(&fs, &["branch", "--show-current"]), "new-main\n");
    assert_ne!(run(&fs, &["branch", "-m", "missing", "other"]).exit_code, 0);
    assert_eq!(ok(&fs, &["branch", "--show-current"]), "new-main\n");
}

#[test]
fn named_oneline_and_message_formats() {
    let fs = repo();
    let head = commit(&fs, "second\n", "second\n\nbody");
    for flag in ["--pretty=oneline", "--format=oneline"] {
        assert_eq!(ok(&fs, &["log", "-1", flag]), format!("{head} second\n"));
    }
    assert_eq!(ok(&fs, &["log", "-1", "--format=%B"]), "second\n\nbody\n\n");
    assert_eq!(ok(&fs, &["log", "-1", "--format=%b"]), "body\n\n");
}

#[test]
fn short_status_includes_requested_branch() {
    let fs = repo();
    fs.write_str("/repo/a.txt", "changed\n");
    for flags in [
        vec!["-sb"],
        vec!["-bs"],
        vec!["-s", "-b"],
        vec!["--short", "--branch"],
        vec!["--porcelain", "-b"],
    ] {
        let mut args = vec!["status"];
        args.extend(flags);
        assert_eq!(ok(&fs, &args), "## main\n M a.txt\n");
    }
}

#[test]
fn revision_ranges_use_reachable_commit_sets_and_merge_base() {
    let fs = repo();
    ok(&fs, &["branch", "feature"]);
    let main = commit(&fs, "main\n", "main");
    ok(&fs, &["checkout", "feature"]);
    let feature = commit(&fs, "feature\n", "feature");
    assert_eq!(
        ok(&fs, &["diff", "main..feature"]),
        ok(&fs, &["diff", "main", "feature"])
    );
    assert_eq!(
        ok(&fs, &["diff", "main...feature"]),
        ok(&fs, &["diff", "HEAD~1", "feature"])
    );
    assert_eq!(
        ok(&fs, &["log", "main..feature", "--format=%H"]),
        format!("{feature}\n")
    );
    let abbreviated = format!("{}..{}", &main[..7], &feature[..7]);
    assert_eq!(
        ok(&fs, &["diff", &abbreviated]),
        ok(&fs, &["diff", "main", "feature"])
    );
    assert_eq!(
        ok(&fs, &["log", &abbreviated, "--format=%H"]),
        format!("{feature}\n")
    );
    let symmetric = ok(&fs, &["log", "main...feature", "--format=%H"]);
    assert_eq!(symmetric, format!("{main}\n{feature}\n"));
    assert_eq!(
        symmetric.lines().collect::<std::collections::BTreeSet<_>>(),
        [main.as_str(), feature.as_str()].into_iter().collect()
    );
    assert_eq!(
        ok(&fs, &["log", "HEAD~1..HEAD", "--oneline"]),
        format!("{} feature\n", &feature[..7])
    );
    assert_eq!(ok(&fs, &["log", "HEAD..HEAD", "--oneline"]), "");
    assert_eq!(
        ok(&fs, &["diff", "..HEAD"]),
        ok(&fs, &["diff", "HEAD", "HEAD"])
    );
}

#[test]
fn branch_deletion_preserves_checked_out_and_unmerged_branches() {
    let fs = repo();
    for flag in ["-d", "-D"] {
        assert_eq!(run(&fs, &["branch", flag, "main"]).exit_code, 1);
        assert_eq!(ok(&fs, &["branch", "--show-current"]), "main\n");
    }
    ok(&fs, &["branch", "merged"]);
    ok(&fs, &["branch", "feature"]);
    ok(&fs, &["checkout", "feature"]);
    commit(&fs, "feature\n", "feature");
    ok(&fs, &["checkout", "main"]);
    commit(&fs, "main change\n", "main change");
    assert_eq!(run(&fs, &["branch", "-d", "feature"]).exit_code, 1);
    ok(&fs, &["rev-parse", "feature"]);
    ok(&fs, &["branch", "-D", "feature"]);
    ok(&fs, &["branch", "-d", "merged"]);
}

#[test]
fn log_ranges_preserve_merge_parent_order_without_duplicates() {
    let fs = repo();
    let base = ok(&fs, &["rev-parse", "HEAD"]).trim().to_string();
    ok(&fs, &["branch", "feature"]);
    let main = commit(&fs, "main\n", "main");
    ok(&fs, &["checkout", "feature"]);
    let feature = commit(&fs, "feature\n", "feature");
    let mut merged = git_rust::read_commit(&fs, "/repo/.git", &main)
        .unwrap()
        .commit;
    merged.parent = vec![main.clone(), feature.clone()];
    merged.message = "merge\n".to_string();
    let merge = git_rust::write_commit(&fs, "/repo/.git", &merged).unwrap();
    fs.write_str("/repo/.git/refs/heads/merged", &format!("{merge}\n"));
    assert_eq!(
        ok(&fs, &["log", &format!("{base}..merged"), "--format=%H"]),
        format!("{merge}\n{main}\n{feature}\n")
    );
    assert_eq!(
        ok(&fs, &["log", "main...merged", "--format=%H"]),
        format!("{merge}\n{feature}\n")
    );
    assert_eq!(
        ok(
            &fs,
            &["log", "main..merged", "--max-count=1", "--format=%H"]
        ),
        format!("{merge}\n")
    );
}

#[test]
fn diff_includes_native_index_headers_for_changed_and_empty_files() {
    let fs = repo();
    fs.write_str("/repo/a.txt", "main\n");
    assert_eq!(
        ok(&fs, &["diff"]),
        "diff --git a/a.txt b/a.txt\nindex df967b9..ba2906d 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-base\n+main\n"
    );
    fs.write_str("/repo/empty.txt", "");
    ok(&fs, &["add", "empty.txt"]);
    assert_eq!(
        ok(&fs, &["diff", "--cached", "--", "empty.txt"]),
        "diff --git a/empty.txt b/empty.txt\nnew file mode 100644\nindex 0000000..e69de29\n"
    );
    ok(&fs, &["commit", "-m", "empty"]);
    ok(&fs, &["rm", "empty.txt"]);
    assert_eq!(
        ok(&fs, &["diff", "--cached", "--", "empty.txt"]),
        "diff --git a/empty.txt b/empty.txt\ndeleted file mode 100644\nindex e69de29..0000000\n"
    );
}
