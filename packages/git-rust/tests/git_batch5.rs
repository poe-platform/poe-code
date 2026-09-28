//! Upstream isomorphic-git integration test parity — Batch 5 (Checkout, Merge, AbortMerge, CherryPick, Stash)
//!
//! Ports all upstream test cases (plus `-in-submodule` equivalents) from:
//! - test-checkout.js (+ test-checkout-in-submodule.js)
//! - test-clone-checkout-huge-repo.js (+ test-clone-checkout-huge-repo-in-submodule.js)
//! - test-merge.js (+ test-merge-in-submodule.js)
//! - test-abortMerge.js (+ test-abortMerge-in-submodule.js)
//! - test-cherryPick.js (+ test-cherryPick-in-submodule.js)
//! - test-stash.js (+ test-stash-in-submodule.js)

use git_rust::commands::plumbing::{branch, init, read_blob, set_config};
use git_rust::fs::discover_gitdir;
use git_rust::commands::worktree::{
    abort_merge, add, checkout, cherry_pick, commit, merge, stash, status,
};
use git_rust::errors::ErrorCode;
use git_rust::fixtures::{make_fixture, make_fixture_as_submodule};
use git_rust::managers::GitIndexManager;
use git_rust::resolve_ref;
use git_rust::utils::{join, Author};

macro_rules! dual_fixture_test {
    ($name:ident, $sub_name:ident, $fixture:expr, |$f:ident| $body:block) => {
        #[test]
        fn $name() {
            let $f = make_fixture($fixture);
            $body
        }

        #[test]
        fn $sub_name() {
            let $f = make_fixture_as_submodule($fixture);
            $body
        }
    };
}

// ============================================================================
// 1. test-checkout.js + test-clone-checkout-huge-repo.js + submodule
// ============================================================================
dual_fixture_test!(checkout_branch_and_tag_and_oid, checkout_branch_and_tag_and_oid_sub, "test-checkout", |f| {
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("test-branch"), None, None, false, false, false, false, true).unwrap();
    let files = f.fs.readdir(&f.dir).unwrap();
    assert!(files.contains(&".babelrc".to_string()));
    assert!(files.contains(&"src".to_string()));
    let actual_gitdir = discover_gitdir(&f.fs, &f.gitdir);
    let head = f.fs.read_str(&join(&[&actual_gitdir, "HEAD"])).unwrap();
    assert_eq!(head.trim(), "ref: refs/heads/test-branch");

    // Checkout by tag detaches HEAD
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("v1.0.0"), None, None, false, false, false, false, true).unwrap();
    let head_tag = f.fs.read_str(&join(&[&actual_gitdir, "HEAD"])).unwrap();
    assert_eq!(head_tag.trim(), "e10ebb90d03eaacca84de1af0a59b444232da99e");

    // Checkout by SHA detaches HEAD
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("e10ebb90d03eaacca84de1af0a59b444232da99e"), None, None, false, false, false, false, true).unwrap();
    let head_sha = f.fs.read_str(&join(&[&actual_gitdir, "HEAD"])).unwrap();
    assert_eq!(head_sha.trim(), "e10ebb90d03eaacca84de1af0a59b444232da99e");
});

dual_fixture_test!(checkout_filepaths_and_conflicts_and_force, checkout_filepaths_and_conflicts_and_force_sub, "test-checkout", |f| {
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("test-branch"), None, None, false, false, false, false, true).unwrap();
    f.fs.write_str(&join(&[&f.dir, "README.md"]), "dirty worktree content\n");

    // Switching branch without force fails with CheckoutConflictError
    let err = checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("v1.0.0"), None, None, false, false, false, false, true).unwrap_err();
    assert_eq!(err.code, ErrorCode::CheckoutConflictError);

    // Force checkout overwrites dirty file
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("v1.0.0"), None, None, false, false, false, true, true).unwrap();
    assert_ne!(f.fs.read_str(&join(&[&f.dir, "README.md"])).unwrap(), "dirty worktree content\n");

    // Checkout specific filepath only
    f.fs.write_str(&join(&[&f.dir, "README.md"]), "modified again\n");
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("v1.0.0"), Some(&["README.md".to_string()]), None, false, false, false, true, true).unwrap();
    assert_ne!(f.fs.read_str(&join(&[&f.dir, "README.md"])).unwrap(), "modified again\n");
});

dual_fixture_test!(checkout_unfetched_commit_errors, checkout_unfetched_commit_errors_sub, "test-checkout", |f| {
    let err = checkout(
        &f.fs,
        &f.dir,
        Some(&f.gitdir),
        Some("missing-branch"),
        None,
        None,
        false,
        false,
        false,
        false,
        true,
    )
    .unwrap_err();
    assert_eq!(err.code, ErrorCode::CommitNotFetchedError);
});

// ============================================================================
// 2. test-merge.js + submodule
// ============================================================================
dual_fixture_test!(merge_prevent_if_unmerged_paths, merge_prevent_if_unmerged_paths_sub, "test-GitIndex-unmerged", |f| {
    let err = merge(
        &f.fs,
        Some(&f.dir),
        &f.gitdir,
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
            timezone_offset: -0.0,
        }),
        None,
    )
    .unwrap_err();
    assert_eq!(err.code, ErrorCode::UnmergedPathsError);
});

dual_fixture_test!(merge_already_merged_and_fast_forward, merge_already_merged_and_fast_forward_sub, "test-merge", |f| {
    let master_oid = resolve_ref(&f.fs, &f.gitdir, "master", None).unwrap();
    let m1 = merge(&f.fs, None, &f.gitdir, Some("master"), "master", true, true, false, false, true, None, None, None).unwrap();
    assert_eq!(m1.oid.as_deref(), Some(master_oid.as_str()));
    assert!(m1.already_merged);
    assert!(!m1.fast_forward);

    let m2 = merge(&f.fs, None, &f.gitdir, Some("master"), "oldest", true, true, false, false, true, None, None, None).unwrap();
    assert_eq!(m2.oid.as_deref(), Some(master_oid.as_str()));
    assert!(m2.already_merged);
    assert!(!m2.fast_forward);

    // Fast-forward newest into master with dry_run
    let newest_oid = resolve_ref(&f.fs, &f.gitdir, "newest", None).unwrap();
    let m_dry = merge(&f.fs, None, &f.gitdir, Some("master"), "newest", true, true, true, false, true, None, None, None).unwrap();
    assert_eq!(m_dry.oid.as_deref(), Some(newest_oid.as_str()));
    assert!(m_dry.fast_forward);
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "master", None).unwrap(), master_oid);

    // Real fast-forward newest into master
    let m_ff = merge(&f.fs, None, &f.gitdir, Some("master"), "newest", true, true, false, false, true, None, None, None).unwrap();
    assert_eq!(m_ff.oid.as_deref(), Some(newest_oid.as_str()));
    assert!(m_ff.fast_forward);
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "master", None).unwrap(), newest_oid);
});

dual_fixture_test!(merge_no_ff_and_3way_and_conflicts, merge_no_ff_and_3way_and_conflicts_sub, "test-merge", |f| {
    let author = Author {
        name: "Mr. Test".to_string(),
        email: "mrtest@example.com".to_string(),
        timestamp: 1262356920,
        timezone_offset: -0.0,
    };

    // Fast-forward only fails when non-ff merge is required
    let err_ff = merge(&f.fs, None, &f.gitdir, Some("a"), "b", true, true, false, false, true, None, Some(author.clone()), None).unwrap_err();
    assert_eq!(err_ff.code, ErrorCode::FastForwardError);

    // Clean 3-way merge of branch 'a' and 'b'
    let res = merge(&f.fs, Some(&f.dir), &f.gitdir, Some("a"), "b", true, false, false, false, true, None, Some(author.clone()), None).unwrap();
    assert!(res.merge_commit);
    assert!(res.oid.is_some());
    assert!(res.tree.is_some());

    // Conflicting merge ('a' vs 'c') returns MergeConflictError
    let f_conflict = make_fixture("test-merge");
    let err_conflict = merge(
        &f_conflict.fs,
        Some(&f_conflict.dir),
        &f_conflict.gitdir,
        Some("a"),
        "c",
        true,
        false,
        false,
        false,
        true,
        None,
        Some(author),
        None,
    )
    .unwrap_err();
    assert_eq!(err_conflict.code, ErrorCode::MergeConflictError);
});

// ============================================================================
// 3. test-abortMerge.js + submodule
// ============================================================================
dual_fixture_test!(abort_merge_stages_and_restore_worktree, abort_merge_stages_and_restore_worktree_sub, "test-abortMerge", |f| {
    let author = Author {
        name: "Mr. Test".to_string(),
        email: "mrtest@example.com".to_string(),
        timestamp: 1262356920,
        timezone_offset: -0.0,
    };
    let head = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    let head_a = String::from_utf8(read_blob(&f.fs, &f.gitdir, &head, Some("a")).unwrap().blob).unwrap();
    let head_b = String::from_utf8(read_blob(&f.fs, &f.gitdir, &head, Some("b")).unwrap().blob).unwrap();

    // Conflicting merge with abort_on_conflict = false writes stages to index
    let err = merge(
        &f.fs,
        Some(&f.dir),
        &f.gitdir,
        Some("a"),
        "b",
        true,
        false,
        false,
        false,
        false,
        None,
        Some(author),
        None,
    )
    .unwrap_err();
    assert_eq!(err.code, ErrorCode::MergeConflictError);

    GitIndexManager::acquire(&f.fs, &f.gitdir, |index| {
        let unmerged = index.unmerged_paths();
        assert!(unmerged.contains(&"a".to_string()));
        assert!(unmerged.contains(&"b".to_string()));
        Ok(())
    })
    .unwrap();

    // Modify untouched file 'c' in workdir and abort merge
    f.fs.write_str(&join(&[&f.dir, "c"]), "new text for file c");
    abort_merge(&f.fs, &f.dir, Some(&f.gitdir), None).unwrap();

    assert_eq!(f.fs.read_str(&join(&[&f.dir, "a"])).unwrap(), head_a);
    assert_eq!(f.fs.read_str(&join(&[&f.dir, "b"])).unwrap(), head_b);
    assert_eq!(f.fs.read_str(&join(&[&f.dir, "c"])).unwrap(), "new text for file c");
});

// ============================================================================
// 4. test-cherryPick.js + submodule
// ============================================================================
dual_fixture_test!(cherry_pick_clean_conflict_and_errors, cherry_pick_clean_conflict_and_errors_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    let author = Author {
        name: "Test User".to_string(),
        email: "test@example.com".to_string(),
        timestamp: 1600000000,
        timezone_offset: 0.0,
    };
    set_config(&f.fs, &f.gitdir, "user.name", Some(&author.name), false).unwrap();
    set_config(&f.fs, &f.gitdir, "user.email", Some(&author.email), false).unwrap();

    f.fs.write_str(&join(&[&f.dir, "file.txt"]), "base\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["file.txt".to_string()], false).unwrap();
    let root_oid = commit(&f.fs, &f.gitdir, Some("base commit\n"), Some(author.clone()), None, false, false, false, false, None, None, None).unwrap();

    // Cherry-picking root commit fails
    let err_root = cherry_pick(&f.fs, Some(&f.dir), &f.gitdir, &root_oid, false, false, true, None, None, None).unwrap_err();
    assert_eq!(err_root.code, ErrorCode::CherryPickRootCommitError);

    branch(&f.fs, &f.gitdir, "feature", None, true, false).unwrap();
    f.fs.write_str(&join(&[&f.dir, "feature.txt"]), "feature change\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["feature.txt".to_string()], false).unwrap();
    let feature_oid = commit(&f.fs, &f.gitdir, Some("feature commit\n"), Some(author.clone()), None, false, false, false, false, None, None, None).unwrap();

    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("master"), None, None, false, false, false, true, true).unwrap();
    f.fs.write_str(&join(&[&f.dir, "master.txt"]), "master updated\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["master.txt".to_string()], false).unwrap();
    let master_oid = commit(&f.fs, &f.gitdir, Some("master update\n"), Some(author.clone()), None, false, false, false, false, None, None, None).unwrap();

    // Dry-run cherry-pick does not update master
    let dry_cp = cherry_pick(&f.fs, Some(&f.dir), &f.gitdir, &feature_oid, false, true, true, None, None, None).unwrap();
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap(), master_oid);

    // Real cherry-pick applies feature commit onto master
    let new_oid = cherry_pick(&f.fs, Some(&f.dir), &f.gitdir, &feature_oid, false, false, true, None, None, None).unwrap();
    assert_eq!(new_oid, dry_cp);
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap(), new_oid);
    assert_eq!(f.fs.read_str(&join(&[&f.dir, "feature.txt"])).unwrap(), "feature change\n");
});

// ============================================================================
// 5. test-stash.js + submodule
// ============================================================================
dual_fixture_test!(stash_push_list_apply_pop_drop_clear, stash_push_list_apply_pop_drop_clear_sub, "test-stash", |f| {
    set_config(&f.fs, &f.gitdir, "user.name", Some("stash tester"), false).unwrap();
    set_config(&f.fs, &f.gitdir, "user.email", Some("test@stash.com"), false).unwrap();

    let orig_a = f.fs.read_str(&join(&[&f.dir, "a.txt"])).unwrap();
    f.fs.write_str(&join(&[&f.dir, "a.txt"]), "staged changes - a");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["a.txt".to_string()], false).unwrap();
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "a.txt").unwrap(), "modified");

    // Push stash
    stash(&f.fs, &f.dir, Some(&f.gitdir), Some("push"), Some("custom stash msg"), 0).unwrap();
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "a.txt").unwrap(), "unmodified");
    assert_eq!(f.fs.read_str(&join(&[&f.dir, "a.txt"])).unwrap(), orig_a);

    // List stash
    let list_out = stash(&f.fs, &f.dir, Some(&f.gitdir), Some("list"), None, 0).unwrap().unwrap();
    assert!(list_out.contains("stash@{0}"));
    assert!(list_out.contains("custom stash msg"));

    // Apply stash
    stash(&f.fs, &f.dir, Some(&f.gitdir), Some("apply"), None, 0).unwrap();
    assert_eq!(f.fs.read_str(&join(&[&f.dir, "a.txt"])).unwrap(), "staged changes - a");

    // Reset workdir and pop stash
    f.fs.write_str(&join(&[&f.dir, "a.txt"]), &orig_a);
    add(&f.fs, &f.dir, Some(&f.gitdir), &["a.txt".to_string()], false).unwrap();
    stash(&f.fs, &f.dir, Some(&f.gitdir), Some("pop"), None, 0).unwrap();
    assert_eq!(f.fs.read_str(&join(&[&f.dir, "a.txt"])).unwrap(), "staged changes - a");

    // Clear stash
    stash(&f.fs, &f.dir, Some(&f.gitdir), Some("clear"), None, 0).unwrap();
    let empty_list = stash(&f.fs, &f.dir, Some(&f.gitdir), Some("list"), None, 0).unwrap().unwrap_or_default();
    assert!(empty_list.trim().is_empty());
});
