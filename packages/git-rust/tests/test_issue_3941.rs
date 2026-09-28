use git_rust::{MemoryFs, execute_git_cli};
fn run(fs: &MemoryFs, args: &[&str]) -> git_rust::CliResult {
    execute_git_cli(fs, "/repo", args)
}
fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    fs.mkdir("/repo").unwrap();
    assert_eq!(run(&fs, &["init", "-b", "main"]).exit_code, 0);
    fs
}
#[test]
fn refs_require_explicit_normalization() {
    let fs = repo();
    for name in ["foo", "HEAD", "/refs/heads/main", "refs/heads/main/"] {
        assert_eq!(run(&fs, &["check-ref-format", name]).exit_code, 1, "{name}");
    }
    assert_eq!(
        run(&fs, &["check-ref-format", "--allow-onelevel", "foo"]).exit_code,
        0
    );
    assert_eq!(
        run(
            &fs,
            &["check-ref-format", "--normalize", "/refs//heads///main"]
        )
        .stdout,
        "refs/heads/main\n"
    );
    assert_ne!(
        run(&fs, &["check-ref-format", "--branch", "-"]).exit_code,
        0
    );
    assert_ne!(
        run(
            &fs,
            &["check-ref-format", "--normalize", "refs/heads/main/"]
        )
        .exit_code,
        0
    );
}
#[test]
fn packing_tags_retains_packed_branches() {
    let fs = repo();
    let oid = "1111111111111111111111111111111111111111";
    fs.write_str(
        "/repo/.git/packed-refs",
        &format!("{oid} refs/heads/main\n{oid} refs/remotes/origin/main\n"),
    );
    assert_eq!(run(&fs, &["pack-refs"]).exit_code, 0);
    assert!(
        fs.read_str("/repo/.git/packed-refs")
            .unwrap()
            .contains("refs/heads/main")
    );
    assert!(
        fs.read_str("/repo/.git/packed-refs")
            .unwrap()
            .contains("refs/remotes/origin/main")
    );
}
#[test]
fn attributes_reset_and_match_path_globs() {
    let fs = repo();
    fs.write_str(
        "/repo/.gitattributes",
        "* text\ndocs/* !text\nsrc/*.rs language=rust\n",
    );
    assert_eq!(
        run(&fs, &["check-attr", "text", "--", "docs/a"]).stdout,
        "docs/a: text: unspecified\n"
    );
    assert_eq!(
        run(&fs, &["check-attr", "language", "--", "src/lib.rs"]).stdout,
        "src/lib.rs: language: rust\n"
    );
    assert_eq!(
        run(&fs, &["check-attr", "language", "--", "src/nested/lib.rs"]).stdout,
        "src/nested/lib.rs: language: unspecified\n"
    );
}
#[test]
fn multiline_tree_and_tag_verification() {
    let fs = repo();
    fs.write_str("/repo/a", "a");
    run(&fs, &["add", "."]);
    run(&fs, &["commit", "-m", "first"]);
    let tree = run(&fs, &["ls-tree", "HEAD"]).stdout;
    let two = format!("{}{}", tree, tree.replace("\ta\n", "\tb\n"));
    let oid = run(&fs, &["mktree", &two]);
    assert_eq!(oid.exit_code, 0);
    assert_eq!(
        run(&fs, &["ls-tree", oid.stdout.trim()])
            .stdout
            .lines()
            .count(),
        2
    );
    let invalid = format!(
        "object {}\ntype commit\ntag v1\n\nmessage\n",
        run(&fs, &["rev-parse", "HEAD"]).stdout.trim()
    );
    assert_ne!(run(&fs, &["mktag", &invalid]).exit_code, 0);
}
#[test]
fn merge_deletes_files_and_names_branch() {
    let fs = repo();
    fs.write_str("/repo/deleted", "old");
    run(&fs, &["add", "."]);
    run(&fs, &["commit", "-m", "base"]);
    run(&fs, &["checkout", "-b", "feature"]);
    run(&fs, &["rm", "deleted"]);
    run(&fs, &["commit", "-m", "delete"]);
    run(&fs, &["checkout", "main"]);
    fs.write_str("/repo/ours", "ours");
    run(&fs, &["add", "."]);
    run(&fs, &["commit", "-m", "ours"]);
    let result = run(&fs, &["merge", "--no-ff", "feature"]);
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert!(!fs.exists("/repo/deleted"));
    assert!(
        run(&fs, &["log", "-1", "--format=%B"])
            .stdout
            .contains("Merge branch 'feature'")
    );
}
#[test]
fn staged_merges_do_not_create_commits_and_cherry_pick_deletes() {
    for mode in ["--squash", "--no-commit", "cherry-pick"] {
        let fs = repo();
        fs.write_str("/repo/deleted", "old");
        run(&fs, &["add", "."]);
        run(&fs, &["commit", "-m", "base"]);
        run(&fs, &["checkout", "-b", "feature"]);
        run(&fs, &["rm", "deleted"]);
        run(&fs, &["commit", "-m", "delete"]);
        run(&fs, &["checkout", "main"]);
        fs.write_str("/repo/ours", "ours");
        run(&fs, &["add", "."]);
        run(&fs, &["commit", "-m", "ours"]);
        let commits = || {
            fs.readdir_deep("/repo/.git/objects")
                .into_iter()
                .filter(|p| {
                    let parts: Vec<_> = p.rsplit('/').take(2).collect();
                    if parts.len() != 2 {
                        return false;
                    }
                    let oid = format!("{}{}", parts[1], parts[0]);
                    git_rust::_read_object(&fs, "/repo/.git", &oid, "content")
                        .is_ok_and(|o| o.obj_type == "commit")
                })
                .count()
        };
        let before = commits();
        let result = if mode == "cherry-pick" {
            run(&fs, &[mode, "feature"])
        } else {
            run(&fs, &["merge", mode, "feature"])
        };
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert!(!fs.exists("/repo/deleted"), "{mode}");
        if mode != "cherry-pick" {
            assert_eq!(commits(), before, "{mode}");
        }
    }
}
#[test]
fn mktag_rejects_missing_or_wrong_type_objects() {
    let fs = repo();
    fs.write_str("/repo/a", "a");
    let blob = run(&fs, &["hash-object", "-w", "a"]).stdout;
    for oid in [blob.trim(), "1111111111111111111111111111111111111111"] {
        let tag = format!(
            "object {oid}\ntype commit\ntag v1\ntagger A <a@example.com> 1502484200 +0000\n\nmessage\n"
        );
        assert_ne!(run(&fs, &["mktag", &tag]).exit_code, 0);
    }
}
