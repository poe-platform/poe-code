use git_rust::{MemoryFs, execute_git_cli, read_commit};

fn run(fs: &MemoryFs, args: &[&str]) -> String {
    let r = execute_git_cli(fs, "/repo", args);
    assert_eq!(r.exit_code, 0, "{args:?}: {}", r.stderr);
    r.stdout
}
fn save(fs: &MemoryFs, path: &str, text: &str) -> String {
    fs.write_str(&format!("/repo/{path}"), text);
    run(fs, &["add", "."]);
    run(fs, &["commit", "-m", text]);
    run(fs, &["rev-parse", "HEAD"]).trim().into()
}
fn repo() -> (MemoryFs, String) {
    let fs = MemoryFs::new();
    run(&fs, &["init", "-b", "main"]);
    run(&fs, &["config", "user.name", "Configured User"]);
    run(&fs, &["config", "user.email", "configured@example.test"]);
    let base = save(&fs, "base", "base\n");
    (fs, base)
}
#[test]
fn revision_names_validation_and_multiple_revisions() {
    let (fs, oid) = repo();
    run(&fs, &["tag", "v1"]);
    fs.write_str("/repo/.git/refs/remotes/origin/main", &oid);
    for (rev, short, full) in [
        ("HEAD", "main", "refs/heads/main"),
        ("@", "main", "refs/heads/main"),
        ("main", "main", "refs/heads/main"),
        ("refs/tags/v1", "v1", "refs/tags/v1"),
        (
            "refs/remotes/origin/main",
            "origin/main",
            "refs/remotes/origin/main",
        ),
    ] {
        assert_eq!(
            run(&fs, &["rev-parse", "--abbrev-ref", rev]),
            format!("{short}\n")
        );
        assert_eq!(
            run(&fs, &["rev-parse", "--symbolic-full-name", rev]),
            format!("{full}\n")
        );
    }
    assert_eq!(
        execute_git_cli(&fs, "/repo", &["rev-parse", "--abbrev-ref", "missing"]).exit_code,
        128
    );
    assert_eq!(
        run(&fs, &["rev-parse", "--short=10", "HEAD"]),
        format!("{}\n", &oid[..10])
    );
    let next = save(&fs, "next", "next\n");
    assert_eq!(
        run(&fs, &["rev-parse", "HEAD^", "HEAD"]),
        format!("{oid}\n{next}\n")
    );
    run(&fs, &["checkout", "--detach", "HEAD"]);
    assert_eq!(run(&fs, &["rev-parse", "--abbrev-ref", "HEAD"]), "HEAD\n");
    assert_eq!(run(&fs, &["rev-parse", "--symbolic-full-name", &next]), "");
}
#[test]
fn show_blob_and_tree_objects_and_tagged_blob() {
    let (fs, _) = repo();
    save(&fs, "sub/file", "content\n");
    let blob = run(&fs, &["rev-parse", "HEAD:sub/file"]);
    assert_eq!(run(&fs, &["show", blob.trim()]), "content\n");
    run(
        &fs,
        &["tag", "-a", "blob-tag", blob.trim(), "-m", "blob tag"],
    );
    let tagged = run(&fs, &["show", "blob-tag"]);
    assert!(tagged.starts_with("tag blob-tag\n"));
    assert!(tagged.ends_with("content\n"));
    for rev in ["HEAD:sub", "HEAD^{tree}"] {
        let oid = run(&fs, &["rev-parse", rev]);
        let shown = run(&fs, &["show", rev]);
        assert!(shown.starts_with(&format!("tree {rev}\n\n")), "{shown}");
        assert_eq!(
            run(&fs, &["show", oid.trim()]),
            shown.replacen(rev, oid.trim(), 1)
        );
    }
    assert_eq!(run(&fs, &["show", "HEAD:sub"]), "tree HEAD:sub\n\nfile\n");
    assert_eq!(
        run(&fs, &["show", "HEAD^{tree}"]),
        "tree HEAD^{tree}\n\nbase\nsub/\n"
    );
}
#[test]
fn merge_message_and_configured_identity() {
    let (fs, _) = repo();
    run(&fs, &["checkout", "-b", "side"]);
    save(&fs, "side", "side\n");
    run(&fs, &["checkout", "main"]);
    save(&fs, "main", "main\n");
    run(&fs, &["merge", "-m", "custom merge", "side"]);
    let oid = run(&fs, &["rev-parse", "HEAD"]);
    let c = read_commit(&fs, "/repo/.git", oid.trim()).unwrap().commit;
    assert_eq!(c.message.trim(), "custom merge");
    assert_eq!(c.author.name, "Configured User");
    assert_eq!(c.committer.email, "configured@example.test");
}
#[test]
fn cherry_pick_multiple_commits_with_and_without_commit() {
    for flags in [vec![], vec!["-n"], vec!["--no-commit"]] {
        let (fs, base) = repo();
        run(&fs, &["checkout", "-b", "side"]);
        let first = save(&fs, "first", "first\n");
        let second = save(&fs, "second", "second\n");
        run(&fs, &["checkout", "main"]);
        run(&fs, &["config", "user.name", "Picker"]);
        run(&fs, &["config", "user.email", "picker@example.test"]);
        if !flags.is_empty() {
            fs.write_str("/repo/staged", "already staged\n");
            run(&fs, &["add", "."]);
        }
        let mut args = vec!["cherry-pick"];
        args.extend(flags.iter().copied());
        args.extend([first.as_str(), second.as_str()]);
        run(&fs, &args);
        assert_eq!(fs.read_str("/repo/first").unwrap(), "first\n");
        assert_eq!(fs.read_str("/repo/second").unwrap(), "second\n");
        let head = run(&fs, &["rev-parse", "HEAD"]);
        if flags.is_empty() {
            let c = read_commit(&fs, "/repo/.git", head.trim()).unwrap().commit;
            assert_eq!(c.author.name, "Configured User");
            assert_eq!(c.committer.name, "Picker");
            assert_eq!(c.committer.email, "picker@example.test");
            assert_eq!(run(&fs, &["rev-parse", "HEAD~2"]).trim(), base);
        } else {
            assert_eq!(head.trim(), base);
            assert_eq!(
                run(&fs, &["diff", "--cached", "--name-only"]),
                "first\nsecond\nstaged\n"
            );
        }
    }
}
