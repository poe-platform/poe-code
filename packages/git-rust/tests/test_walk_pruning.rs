use git_rust::models::TreeEntry;
use git_rust::{
    MemoryFs, STAGE, TREE, WORKDIR, execute_git_cli, init, walk, write_blob, write_tree,
};

fn repository() -> MemoryFs {
    let fs = MemoryFs::new();
    init(&fs, Some("/repo"), None, false, Some("main")).unwrap();
    for path in [
        "tracked.txt",
        "subdir/a.txt",
        "subdir/deep/b.txt",
        "subdir.txt",
    ] {
        fs.write_str(&format!("/repo/{path}"), path);
    }
    for args in [
        vec!["config", "user.name", "Test"],
        vec!["config", "user.email", "test@example.com"],
        vec!["add", "."],
        vec!["commit", "-m", "initial"],
    ] {
        let result = execute_git_cli(&fs, "/repo", &args);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
    }
    fs
}

#[test]
fn none_prunes_directories_and_root_in_all_walkers() {
    let fs = repository();
    for walkers in [
        vec![WORKDIR()],
        vec![TREE(None)],
        vec![STAGE()],
        vec![WORKDIR(), TREE(None), STAGE()],
    ] {
        for prune in ["subdir", "."] {
            let mut visited = Vec::new();
            let result = walk(&fs, Some("/repo"), "/repo/.git", &walkers, |path, _| {
                visited.push(path.to_string());
                Ok((path != prune).then(|| path.to_string()))
            })
            .unwrap();
            if prune == "." {
                assert_eq!(visited, ["."]);
                assert!(result.is_empty());
            } else {
                assert!(
                    visited.iter().all(|path| !path.starts_with("subdir/")),
                    "{visited:?}"
                );
                assert!(result.contains(&"subdir.txt".to_string()));
            }
        }
    }
}

#[test]
fn ignored_tracked_files_and_ancestors_remain_in_workdir() {
    let fs = repository();
    fs.write_str("/repo/.gitignore", "tracked.txt\nsubdir/\nignored.txt\n");
    fs.write_str("/repo/ignored.txt", "ignored");
    fs.write_str("/repo/subdir/untracked.txt", "ignored");
    for walkers in [
        vec![WORKDIR(), STAGE()],
        vec![WORKDIR(), TREE(None)],
        vec![STAGE(), TREE(None), WORKDIR()],
    ] {
        let workdir = walkers
            .iter()
            .position(|w| matches!(w, git_rust::Walker::Workdir))
            .unwrap();
        let paths = walk(
            &fs,
            Some("/repo"),
            "/repo/.git",
            &walkers,
            |path, entries| {
                assert!(entries[workdir].is_some(), "missing working entry: {path}");
                Ok(Some(path.to_string()))
            },
        )
        .unwrap();
        assert!(paths.contains(&"tracked.txt".to_string()));
        assert!(paths.contains(&"subdir/deep/b.txt".to_string()));
        assert!(!paths.contains(&"ignored.txt".to_string()));
        assert!(!paths.contains(&"subdir/untracked.txt".to_string()));
    }
}

#[test]
fn pruned_tree_does_not_read_missing_subtree() {
    let fs = MemoryFs::new();
    let root = write_tree(
        &fs,
        "/repo/.git",
        &[TreeEntry {
            mode: "040000".into(),
            path: "skip".into(),
            oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
            entry_type: "tree".into(),
        }],
    )
    .unwrap();
    let paths = walk(&fs, None, "/repo/.git", &[TREE(Some(&root))], |path, _| {
        Ok((path != "skip").then(|| path.to_string()))
    })
    .unwrap();
    assert_eq!(paths, ["."]);
    assert!(
        walk(&fs, None, "/repo/.git", &[TREE(Some(&root))], |_, _| Ok(
            Some(())
        ))
        .is_err()
    );
}

#[test]
fn workdir_reads_children_and_blob_bytes_only_when_requested() {
    let fs = repository();
    walk(
        &fs,
        Some("/repo"),
        "/repo/.git",
        &[WORKDIR()],
        |path, entries| {
            let entry = entries[0].as_ref().unwrap();
            if path == "subdir" {
                fs.write_str("/repo/subdir/new.txt", "new");
            }
            if path == "tracked.txt" {
                fs.write_str("/repo/tracked.txt", "changed before first read");
                assert_eq!(entry.content(), Some(&b"changed before first read"[..]));
                let oid = write_blob(&fs, "/repo/.git", b"changed before first read").unwrap();
                assert_eq!(entry.oid(), Some(oid.as_str()));
                fs.write_str("/repo/tracked.txt", "later mutation");
                assert_eq!(entry.content(), Some(&b"changed before first read"[..]));
            }
            Ok(Some(path.to_string()))
        },
    )
    .map(|paths| assert!(paths.contains(&"subdir/new.txt".to_string())))
    .unwrap();
}

#[test]
fn tree_blob_is_loaded_only_on_content_access() {
    let fs = MemoryFs::new();
    let oid = write_blob(&fs, "/repo/.git", b"deferred").unwrap();
    let root = write_tree(
        &fs,
        "/repo/.git",
        &[TreeEntry {
            mode: "100644".into(),
            path: "file".into(),
            oid: oid.clone(),
            entry_type: "blob".into(),
        }],
    )
    .unwrap();
    fs.unlink(&format!("/repo/.git/objects/{}/{}", &oid[..2], &oid[2..]))
        .unwrap();
    walk(
        &fs,
        None,
        "/repo/.git",
        &[TREE(Some(&root))],
        |path, entries| {
            if path == "file" {
                let entry = entries[0].as_ref().unwrap();
                assert_eq!(entry.oid(), Some(oid.as_str()));
                write_blob(&fs, "/repo/.git", b"deferred").unwrap();
                assert_eq!(entry.content(), Some(&b"deferred"[..]));
            }
            Ok(Some(()))
        },
    )
    .unwrap();
}
