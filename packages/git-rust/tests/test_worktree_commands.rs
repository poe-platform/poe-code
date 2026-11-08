use git_rust::errors::ErrorCode;
use git_rust::fixtures::{make_fixture, make_fixture_as_submodule, FixtureEnv};
use git_rust::utils::{join, Author};
use git_rust::*;

fn load_fixture(name: &str, is_sub: bool) -> FixtureEnv {
    if is_sub {
        let sub = make_fixture_as_submodule(name);
        FixtureEnv {
            fs: sub.fs,
            dir: sub.dir,
            gitdir: sub.gitdir,
        }
    } else {
        make_fixture(name)
    }
}

#[test]
fn test_list_files_status_status_matrix_add_remove_reset_update_index() {
    for is_sub in [false, true] {
        let flf = load_fixture("test-listFiles", is_sub);
        let index_files = list_files(&flf.fs, &flf.gitdir, None).unwrap();
        assert!(!index_files.is_empty());
        let fco_lf = load_fixture("test-checkout", is_sub);
        let head_files = list_files(&fco_lf.fs, &fco_lf.gitdir, Some("test-branch")).unwrap();
        assert!(!head_files.is_empty());

        // status & statusMatrix
        let fst = load_fixture("test-status", is_sub);
        fst.fs.write_str(&join(&[&fst.dir, ".gitignore"]), "i.txt\n");
        fst.fs.write_str(&join(&[&fst.dir, "i.txt"]), "ignored");
        assert_eq!(
            status(&fst.fs, &fst.dir, Some(&fst.gitdir), "i.txt").unwrap(),
            "ignored"
        );
        assert_eq!(
            status(&fst.fs, &fst.dir, Some(&fst.gitdir), "nonexistent.txt").unwrap(),
            "absent"
        );

        let fsm = load_fixture("test-statusMatrix", is_sub);
        let mat = status_matrix(&fsm.fs, &fsm.dir, Some(&fsm.gitdir), None, None).unwrap();
        assert!(!mat.is_empty());

        // add, remove, resetIndex, updateIndex
        let fa = load_fixture("test-add", is_sub);
        fa.fs.write_str(&join(&[&fa.dir, "new-added.txt"]), "hello add\n");
        add(&fa.fs, &fa.dir, Some(&fa.gitdir), &["new-added.txt".to_string()], false).unwrap();
        assert!(list_files(&fa.fs, &fa.gitdir, None)
            .unwrap()
            .contains(&"new-added.txt".to_string()));
        remove(&fa.fs, &fa.gitdir, "new-added.txt").unwrap();
        assert!(!list_files(&fa.fs, &fa.gitdir, None)
            .unwrap()
            .contains(&"new-added.txt".to_string()));

        // updateIndex
        let added_oid = update_index(
            &fa.fs,
            &fa.dir,
            &fa.gitdir,
            "new-added.txt",
            None,
            None,
            true,
            false,
            false,
        )
        .unwrap();
        assert!(added_oid.is_some());

        // resetIndex
        reset_index(&fa.fs, Some(&fa.dir), &fa.gitdir, "new-added.txt", None).unwrap();
        assert!(!list_files(&fa.fs, &fa.gitdir, None)
            .unwrap()
            .contains(&"new-added.txt".to_string()));
    }
}

#[test]
fn test_commit_checkout_and_symlink_protection() {
    for is_sub in [false, true] {
        let fc = load_fixture("test-commit", is_sub);
        fc.fs.write_str(&join(&[&fc.dir, "hello.txt"]), "world\n");
        add(&fc.fs, &fc.dir, Some(&fc.gitdir), &["hello.txt".to_string()], false).unwrap();
        let sha = commit(
            &fc.fs,
            &fc.gitdir,
            Some("Initial test commit\n"),
            Some(Author {
                name: "Mr. Test".to_string(),
                email: "mrtest@example.com".to_string(),
                timestamp: 1262356920,
                timezone_offset: 0.0,
            }),
            None,
            false,
            false,
            false,
            false,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(sha.len(), 40);

        // checkout (+ submodule)
        let fco = load_fixture("test-checkout", is_sub);
        checkout(
            &fco.fs,
            &fco.dir,
            Some(&fco.gitdir),
            Some("test-branch"),
            None,
            None,
            false,
            false,
            false,
            true,
            true,
        )
        .unwrap();
        assert_eq!(
            current_branch(&fco.fs, &fco.gitdir, false, false).unwrap().as_deref(),
            Some("test-branch")
        );
    }

    // server-only.test-checkout-FollowSymlink.js: checkout refuses to write through a leading symlink
    let f_sym = make_fixture("test-checkout");
    let _ = f_sym.fs.symlink("/tmp/outside-target", &join(&[&f_sym.dir, "sub"]));
    let err = assert_no_symlink_in_leading_path(&f_sym.fs, &f_sym.dir, "sub/evil.txt").unwrap_err();
    assert_eq!(err.code, ErrorCode::UnsafeFilepathError);
}

#[test]
fn test_merge_fast_forward_abort_merge_cherry_pick_and_stash() {
    for is_sub in [false, true] {
        let fm = load_fixture("test-merge", is_sub);
        // Fast-forward merge
        let report_ff = merge(
            &fm.fs,
            Some(&fm.dir),
            &fm.gitdir,
            Some("a"),
            "b",
            true,
            false,
            false,
            false,
            true,
            None,
            Some(Author {
                name: "Mr. Test".to_string(),
                email: "mrtest@example.com".to_string(),
                timestamp: 1262356920,
                timezone_offset: 0.0,
            }),
            None,
        )
        .unwrap();
        assert!(report_ff.fast_forward || report_ff.merge_commit);

        // 3-way clean merge (a-o-b vs a-o-c)
        let fm2 = load_fixture("test-merge", is_sub);
        let report_3way = merge(
            &fm2.fs,
            Some(&fm2.dir),
            &fm2.gitdir,
            Some("b"),
            "c",
            true,
            false,
            false,
            false,
            true,
            None,
            Some(Author {
                name: "Mr. Test".to_string(),
                email: "mrtest@example.com".to_string(),
                timestamp: 1262356920,
                timezone_offset: 0.0,
            }),
            None,
        )
        .unwrap();
        assert!(report_3way.merge_commit);

        // Unmerged paths error check
        let f_unmerged = load_fixture("test-GitIndex-unmerged", is_sub);
        let unmerged_err = merge(
            &f_unmerged.fs,
            Some(&f_unmerged.dir),
            &f_unmerged.gitdir,
            Some("a"),
            "b",
            true,
            false,
            false,
            false,
            false,
            None,
            Some(Author {
                name: "Mr. Test".to_string(),
                email: "mrtest@example.com".to_string(),
                timestamp: 1262356920,
                timezone_offset: 0.0,
            }),
            None,
        )
        .unwrap_err();
        assert_eq!(unmerged_err.code, ErrorCode::UnmergedPathsError);

        // Merge conflict + abortMerge
        let fm_conflict = load_fixture("test-abortMerge", is_sub);
        let conflict_res = merge(
            &fm_conflict.fs,
            Some(&fm_conflict.dir),
            &fm_conflict.gitdir,
            Some("a"),
            "b",
            false,
            false,
            false,
            false,
            false,
            None,
            Some(Author {
                name: "Mr. Test".to_string(),
                email: "mrtest@example.com".to_string(),
                timestamp: 1262356920,
                timezone_offset: 0.0,
            }),
            None,
        );
        let conflict_err = conflict_res.unwrap_err();
        assert_eq!(conflict_err.code, ErrorCode::MergeConflictError);
        fm_conflict
            .fs
            .write_str(&join(&[&fm_conflict.dir, "c"]), "new text for file c");
        abort_merge(
            &fm_conflict.fs,
            &fm_conflict.dir,
            Some(&fm_conflict.gitdir),
            None,
        )
        .unwrap();
        assert_eq!(
            fm_conflict
                .fs
                .read_str(&join(&[&fm_conflict.dir, "c"]))
                .unwrap(),
            "new text for file c"
        );

        // cherryPick
        let fcp = load_fixture("test-cherryPick", is_sub);
        let cp_branches = list_branches(&fcp.fs, &fcp.gitdir, None);
        if cp_branches.len() >= 2 {
            let their_oid = resolve_ref(&fcp.fs, &fcp.gitdir, &cp_branches[0], None).unwrap();
            let _ = cherry_pick(
                &fcp.fs,
                Some(&fcp.dir),
                &fcp.gitdir,
                &their_oid,
                false,
                false,
                true,
                None,
                Some(Author {
                    name: "Mr. Test".to_string(),
                    email: "mrtest@example.com".to_string(),
                    timestamp: 1262356920,
                    timezone_offset: 0.0,
                }),
                None,
            );
        }

        // stash push, list, pop, clear
        let fst = load_fixture("test-stash", is_sub);
        set_config(&fst.fs, &fst.gitdir, "user.name", Some("Stash Tester"), false).unwrap();
        set_config(&fst.fs, &fst.gitdir, "user.email", Some("stash@example.com"), false).unwrap();
        fst.fs.write_str(&join(&[&fst.dir, "a.txt"]), "modified for stash\n");
        add(&fst.fs, &fst.dir, Some(&fst.gitdir), &["a.txt".to_string()], false).unwrap();
        let stash_sha = stash(
            &fst.fs,
            &fst.dir,
            Some(&fst.gitdir),
            Some("push"),
            Some("custom stash msg"),
            0,
        )
        .unwrap();
        assert!(stash_sha.is_some());
        let list_out = stash(&fst.fs, &fst.dir, Some(&fst.gitdir), Some("list"), None, 0)
            .unwrap()
            .unwrap_or_default();
        assert!(list_out.contains("custom stash msg"));
        stash(&fst.fs, &fst.dir, Some(&fst.gitdir), Some("pop"), None, 0).unwrap();
        stash(&fst.fs, &fst.dir, Some(&fst.gitdir), Some("clear"), None, 0).unwrap();
    }
}
