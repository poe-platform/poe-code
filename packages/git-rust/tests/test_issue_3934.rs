use git_rust::{MemoryFs, execute_git_cli};
fn ok(fs: &MemoryFs, args: &[&str]) -> String {
    let r = execute_git_cli(fs, "/repo", args);
    assert_eq!(r.exit_code, 0, "{args:?}: {}", r.stderr);
    r.stdout
}
fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    ok(&fs, &["init", "-b", "main"]);
    ok(&fs, &["config", "user.name", "Alice"]);
    ok(&fs, &["config", "user.email", "a@b"]);
    commit(&fs, "base", "base");
    fs
}
fn commit(fs: &MemoryFs, text: &str, message: &str) -> String {
    fs.write_str("/repo/file", text);
    ok(fs, &["add", "."]);
    ok(fs, &["commit", "-m", message]);
    ok(fs, &["rev-parse", "HEAD"]).trim().into()
}
#[test]
fn read_tree_preserves_all_modes() {
    let fs = repo();
    let blob = git_rust::write_blob(&fs, "/repo/.git", b"data").unwrap();
    let tree = git_rust::commands::plumbing::write_tree(
        &fs,
        "/repo/.git",
        &[
            git_rust::models::TreeEntry {
                mode: "100755".into(),
                path: "exec".into(),
                oid: blob.clone(),
                entry_type: "blob".into(),
            },
            git_rust::models::TreeEntry {
                mode: "120000".into(),
                path: "link".into(),
                oid: blob,
                entry_type: "blob".into(),
            },
            git_rust::models::TreeEntry {
                mode: "160000".into(),
                path: "sub".into(),
                oid: ok(&fs, &["rev-parse", "HEAD"]).trim().into(),
                entry_type: "commit".into(),
            },
        ],
    )
    .unwrap();
    ok(&fs, &["read-tree", &tree]);
    assert_eq!(ok(&fs, &["write-tree"]).trim(), tree);
}
#[test]
fn replacement_is_shared_by_readers_and_can_be_disabled() {
    let fs = repo();
    let old = ok(&fs, &["rev-parse", "HEAD"]).trim().to_string();
    let new = commit(&fs, "new", "replacement");
    ok(&fs, &["replace", &old, &new]);
    assert_eq!(
        ok(&fs, &["show", "-s", "--format=%s", &old]),
        "replacement\n"
    );
    assert!(ok(&fs, &["cat-file", "-p", &old]).contains("replacement"));
    assert_eq!(
        ok(
            &fs,
            &["--no-replace-objects", "show", "-s", "--format=%s", &old]
        ),
        "base\n"
    );
    assert_eq!(
        ok(&fs, &["show", "-s", "--format=%s", &old]),
        "replacement\n"
    );
}
#[test]
fn sparse_updates_files_and_restores_modes_without_losing_untracked_files() {
    let fs = repo();
    fs.write_with_mode("/repo/a/run", b"exec", 0o100755);
    fs.write_str("/repo/b/data", "data");
    fs.writelink("/repo/b/link", b"data").unwrap();
    ok(&fs, &["add", "."]);
    ok(&fs, &["commit", "-m", "directories"]);
    fs.write_str("/repo/b/untracked", "keep");
    ok(&fs, &["sparse-checkout", "set", "a"]);
    assert!(!fs.exists("/repo/b/data"));
    assert!(fs.exists("/repo/file"));
    assert!(fs.exists("/repo/b/untracked"));
    assert_eq!(ok(&fs, &["status", "--porcelain"]), "?? b/untracked\n");
    ok(&fs, &["sparse-checkout", "add", "b"]);
    assert_eq!(fs.read_str("/repo/b/data").unwrap(), "data");
    assert!(fs.lstat("/repo/b/link").unwrap().is_symbolic_link());
    ok(&fs, &["sparse-checkout", "set", "b"]);
    assert!(!fs.exists("/repo/a/run"));
    ok(&fs, &["sparse-checkout", "disable"]);
    assert_eq!(fs.lstat("/repo/a/run").unwrap().mode, 0o100755);
}
#[test]
fn refs_match_globs_sort_versions_and_report_real_types() {
    let fs = repo();
    for name in ["v1.10", "v1.2"] {
        ok(&fs, &["tag", name]);
    }
    assert_eq!(
        ok(
            &fs,
            &[
                "for-each-ref",
                "--format=%(refname:short)",
                "--sort=version:refname",
                "refs/tags/v1.*"
            ]
        ),
        "v1.2\nv1.10\n"
    );
    assert_eq!(
        ok(
            &fs,
            &["for-each-ref", "--format=%(refname:short)", "refs/heads/*"]
        ),
        "main\n"
    );
    let blob = git_rust::write_blob(&fs, "/repo/.git", b"blob").unwrap();
    ok(&fs, &["update-ref", "refs/tags/blob", &blob]);
    assert_eq!(
        ok(
            &fs,
            &["for-each-ref", "--format=%(objecttype)", "refs/tags/blob"]
        ),
        "blob\n"
    );
}
#[test]
fn patch_comparisons_ignore_subjects_and_accept_all_range_forms() {
    let fs = repo();
    ok(&fs, &["branch", "base"]);
    let left = commit(&fs, "patch", "same subject");
    ok(&fs, &["branch", "left"]);
    ok(&fs, &["checkout", "-b", "right", "base"]);
    let right = commit(&fs, "patch", "reworded");
    assert!(ok(&fs, &["cherry", "left", "right"]).starts_with("- "));
    for args in [
        vec!["range-diff", "base", "left", "right"],
        vec!["range-diff", "left...right"],
        vec!["range-diff", "base..left", "base..right"],
    ] {
        let out = ok(&fs, &args);
        assert!(
            out.contains(&left[..7]) && out.contains(&right[..7]) && out.contains(" = "),
            "{out}"
        );
    }
    ok(&fs, &["checkout", "-b", "different", "base"]);
    commit(&fs, "different patch", "same subject");
    assert!(ok(&fs, &["cherry", "left", "different"]).starts_with("+ "));
    assert!(!ok(&fs, &["range-diff", "base..left", "base..different"]).contains(" = "));
}
#[test]
fn history_combines_first_parent_with_ranges_and_all_and_regex_filters() {
    let fs = repo();
    ok(&fs, &["branch", "base"]);
    commit(&fs, "main", "feat main");
    ok(&fs, &["checkout", "-b", "side", "base"]);
    fs.write_str("/repo/side", "side");
    ok(&fs, &["add", "."]);
    ok(&fs, &["commit", "-m", "side"]);
    ok(&fs, &["checkout", "main"]);
    ok(&fs, &["merge", "side"]);
    assert!(
        !ok(&fs, &["log", "--first-parent", "--format=%s", "base..main"])
            .lines()
            .any(|s| s == "side")
    );
    let filtered = ok(
        &fs,
        &[
            "log",
            "--format=%s",
            "--grep=^feat",
            "--grep=^base",
            "--author=Alice|Bob",
        ],
    );
    assert_eq!(
        filtered.lines().collect::<std::collections::BTreeSet<_>>(),
        ["base", "feat main"].into_iter().collect()
    );
    ok(&fs, &["branch", "-D", "side"]);
    assert!(
        !ok(&fs, &["log", "--all", "--first-parent", "--format=%s"])
            .lines()
            .any(|s| s == "side")
    );
}

#[test]
fn replacement_chains_cycles_trees_and_blobs() {
    let fs = repo();
    let a = git_rust::write_blob(&fs, "/repo/.git", b"a").unwrap();
    let b = git_rust::write_blob(&fs, "/repo/.git", b"b").unwrap();
    let c = git_rust::write_blob(&fs, "/repo/.git", b"c").unwrap();
    ok(&fs, &["replace", &a, &b]);
    ok(&fs, &["replace", &b, &c]);
    assert_eq!(ok(&fs, &["cat-file", "-p", &a]), "c");
    assert_eq!(
        ok(&fs, &["--no-replace-objects", "cat-file", "-p", &a]),
        "a"
    );
    let old_tree = ok(&fs, &["rev-parse", "HEAD^{tree}"]).trim().to_string();
    commit(&fs, "changed", "changed");
    let new_tree = ok(&fs, &["rev-parse", "HEAD^{tree}"]).trim().to_string();
    ok(&fs, &["replace", &old_tree, &new_tree]);
    assert_eq!(ok(&fs, &["show", &format!("{old_tree}:file")]), "changed");
    ok(&fs, &["replace", &c, &a]);
    assert_ne!(
        execute_git_cli(&fs, "/repo", &["cat-file", "-p", &a]).exit_code,
        0
    );
}
#[test]
fn sparse_rejects_dirty_removals_and_keeps_the_index_tree() {
    let fs = repo();
    fs.write_str("/repo/a/file", "a");
    fs.write_str("/repo/b/file", "b");
    ok(&fs, &["add", "."]);
    ok(&fs, &["commit", "-m", "dirs"]);
    let tree = ok(&fs, &["write-tree"]);
    fs.write_str("/repo/b/file", "dirty");
    assert_ne!(
        execute_git_cli(&fs, "/repo", &["sparse-checkout", "set", "a"]).exit_code,
        0
    );
    assert_eq!(fs.read_str("/repo/b/file").unwrap(), "dirty");
    fs.write_str("/repo/b/file", "b");
    ok(&fs, &["sparse-checkout", "set", "a"]);
    assert_eq!(ok(&fs, &["write-tree"]), tree);
    assert_eq!(ok(&fs, &["status", "--porcelain"]), "");
}
#[test]
fn ref_dates_are_sorted_by_metadata_not_names() {
    let fs = repo();
    let tree = ok(&fs, &["rev-parse", "HEAD^{tree}"]).trim().to_string();
    for (name, time) in [("z-old", 10), ("a-new", 20)] {
        let author = git_rust::utils::Author {
            name: "Alice".into(),
            email: "a@b".into(),
            timestamp: time,
            timezone_offset: 0.0,
        };
        let oid = git_rust::commands::plumbing::write_commit(
            &fs,
            "/repo/.git",
            &git_rust::models::CommitObject {
                tree: tree.clone(),
                parent: vec![],
                message: name.into(),
                author: author.clone(),
                committer: author,
                gpgsig: None,
            },
        )
        .unwrap();
        ok(&fs, &["update-ref", &format!("refs/heads/{name}"), &oid]);
    }
    for field in ["committerdate", "creatordate"] {
        assert_eq!(
            ok(
                &fs,
                &[
                    "for-each-ref",
                    "--format=%(refname:short)",
                    &format!("--sort={field}"),
                    "refs/heads/*-*"
                ]
            ),
            "z-old\na-new\n"
        );
        assert_eq!(
            ok(
                &fs,
                &[
                    "for-each-ref",
                    "--format=%(refname:short)",
                    &format!("--sort=-{field}"),
                    "refs/heads/*-*"
                ]
            ),
            "a-new\nz-old\n"
        );
    }
}
#[test]
fn grep_all_match_case_insensitive_and_invalid_patterns() {
    let fs = repo();
    commit(&fs, "x", "feat Alpha\n\nBody beta");
    assert_eq!(
        ok(
            &fs,
            &[
                "log",
                "--format=%s",
                "--all-match",
                "--grep=^feat",
                "--grep=BETA",
                "-i"
            ]
        ),
        "feat Alpha\n"
    );
    assert_eq!(
        ok(
            &fs,
            &[
                "log",
                "--format=%s",
                "--all-match",
                "--grep=^feat",
                "--grep=^base"
            ]
        ),
        ""
    );
    assert_ne!(
        execute_git_cli(&fs, "/repo", &["log", "--grep=["]).exit_code,
        0
    );
}

#[test]
fn all_refs_add_tips_to_revision_ranges() {
    let fs = repo();
    ok(&fs, &["branch", "base"]);
    commit(&fs, "main", "main patch");
    ok(&fs, &["checkout", "-b", "side", "base"]);
    commit(&fs, "side", "side patch");
    let out = ok(
        &fs,
        &[
            "log",
            "--all",
            "--first-parent",
            "--format=%s",
            "base..main",
        ],
    );
    assert_eq!(
        out.lines().collect::<std::collections::BTreeSet<_>>(),
        ["main patch", "side patch"].into_iter().collect()
    );
}

#[test]
fn ref_globs_support_character_classes() {
    let fs = repo();
    ok(&fs, &["branch", "topic-a"]);
    ok(&fs, &["branch", "topic-b"]);
    ok(&fs, &["branch", "topic-c"]);
    assert_eq!(
        ok(
            &fs,
            &[
                "for-each-ref",
                "--format=%(refname:short)",
                "refs/heads/topic-[ab]"
            ]
        ),
        "topic-a\ntopic-b\n"
    );
}
