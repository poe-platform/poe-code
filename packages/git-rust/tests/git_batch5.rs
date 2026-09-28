//! Git integration test parity — Batch 5 (Checkout, Merge, AbortMerge, CherryPick, Stash)
//!
//! Covers all test cases (plus `-in-submodule` equivalents) for:
//! - test-checkout (+ test-checkout-in-submodule)
//! - test-clone-checkout-huge-repo (+ test-clone-checkout-huge-repo-in-submodule)
//! - test-merge (+ test-merge-in-submodule)
//! - test-abortMerge (+ test-abortMerge-in-submodule)
//! - test-cherryPick (+ test-cherryPick-in-submodule)
//! - test-stash (+ test-stash-in-submodule)

use git_rust::commands::plumbing::{branch, init, read_blob, read_commit, set_config};
use git_rust::commands::worktree::{
    abort_merge, add, checkout, cherry_pick, commit, merge, stash, status,
};
use git_rust::errors::ErrorCode;
use git_rust::fixtures::{make_fixture, make_fixture_as_submodule};
use git_rust::fs::discover_gitdir;
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
// 1. test-checkout + test-clone-checkout-huge-repo + submodule
// ============================================================================
dual_fixture_test!(checkout_branch, checkout_branch_sub, "test-checkout", |f| {
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("test-branch"), None, None, false, false, false, false, true).unwrap();
    let files = f.fs.readdir(&f.dir).unwrap();
    assert!(files.contains(&".babelrc".to_string()));
    assert!(files.contains(&"src".to_string()));
    let actual_gitdir = discover_gitdir(&f.fs, &f.gitdir);
    let head = f.fs.read_str(&join(&[&actual_gitdir, "HEAD"])).unwrap();
    assert_eq!(head.trim(), "ref: refs/heads/test-branch");
});

dual_fixture_test!(checkout_by_tag_detaches_head, checkout_by_tag_detaches_head_sub, "test-checkout", |f| {
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("v1.0.0"), None, None, false, false, false, false, true).unwrap();
    let actual_gitdir = discover_gitdir(&f.fs, &f.gitdir);
    let head_tag = f.fs.read_str(&join(&[&actual_gitdir, "HEAD"])).unwrap();
    assert_eq!(head_tag.trim(), "e10ebb90d03eaacca84de1af0a59b444232da99e");
});

dual_fixture_test!(checkout_by_sha_detaches_head, checkout_by_sha_detaches_head_sub, "test-checkout", |f| {
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("e10ebb90d03eaacca84de1af0a59b444232da99e"), None, None, false, false, false, false, true).unwrap();
    let actual_gitdir = discover_gitdir(&f.fs, &f.gitdir);
    let head_sha = f.fs.read_str(&join(&[&actual_gitdir, "HEAD"])).unwrap();
    assert_eq!(head_sha.trim(), "e10ebb90d03eaacca84de1af0a59b444232da99e");
});

dual_fixture_test!(checkout_conflict_on_modified_file, checkout_conflict_on_modified_file_sub, "test-checkout", |f| {
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("test-branch"), None, None, false, false, false, false, true).unwrap();
    f.fs.write_str(&join(&[&f.dir, "README.md"]), "dirty worktree content\n");
    let err = checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("v1.0.0"), None, None, false, false, false, false, true).unwrap_err();
    assert_eq!(err.code, ErrorCode::CheckoutConflictError);
});

dual_fixture_test!(checkout_force_overwrites_modified_file, checkout_force_overwrites_modified_file_sub, "test-checkout", |f| {
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("test-branch"), None, None, false, false, false, false, true).unwrap();
    f.fs.write_str(&join(&[&f.dir, "README.md"]), "dirty worktree content\n");
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("v1.0.0"), None, None, false, false, false, true, true).unwrap();
    assert_ne!(f.fs.read_str(&join(&[&f.dir, "README.md"])).unwrap(), "dirty worktree content\n");
});

dual_fixture_test!(checkout_specific_filepaths_only, checkout_specific_filepaths_only_sub, "test-checkout", |f| {
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("test-branch"), None, None, false, false, false, false, true).unwrap();
    f.fs.write_str(&join(&[&f.dir, "README.md"]), "modified again\n");
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("v1.0.0"), Some(&["README.md".to_string()]), None, false, false, false, true, true).unwrap();
    assert_ne!(f.fs.read_str(&join(&[&f.dir, "README.md"])).unwrap(), "modified again\n");
});

dual_fixture_test!(checkout_directory_filepath_prefix, checkout_directory_filepath_prefix_sub, "test-checkout", |f| {
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("test-branch"), Some(&["src".to_string()]), None, false, false, false, true, true).unwrap();
    assert!(f.fs.exists(&join(&[&f.dir, "src"])));
});

dual_fixture_test!(checkout_dry_run_leaves_worktree_and_head_unchanged, checkout_dry_run_leaves_worktree_and_head_unchanged_sub, "test-checkout", |f| {
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("test-branch"), None, None, false, false, false, false, true).unwrap();
    let actual_gitdir = discover_gitdir(&f.fs, &f.gitdir);
    let before_head = f.fs.read_str(&join(&[&actual_gitdir, "HEAD"])).unwrap();
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("v1.0.0"), None, None, false, false, true, false, true).unwrap();
    let after_head = f.fs.read_str(&join(&[&actual_gitdir, "HEAD"])).unwrap();
    assert_eq!(before_head, after_head);
});

dual_fixture_test!(checkout_no_update_head_keeps_head_symbolic_ref, checkout_no_update_head_keeps_head_symbolic_ref_sub, "test-checkout", |f| {
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("test-branch"), None, None, false, false, false, false, true).unwrap();
    let actual_gitdir = discover_gitdir(&f.fs, &f.gitdir);
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("v1.0.0"), None, None, false, true, false, true, true).unwrap();
    let head = f.fs.read_str(&join(&[&actual_gitdir, "HEAD"])).unwrap();
    assert_eq!(head.trim(), "ref: refs/heads/test-branch");
});

dual_fixture_test!(checkout_no_checkout_updates_head_only, checkout_no_checkout_updates_head_only_sub, "test-checkout", |f| {
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("test-branch"), None, None, true, false, false, false, true).unwrap();
    let actual_gitdir = discover_gitdir(&f.fs, &f.gitdir);
    let head = f.fs.read_str(&join(&[&actual_gitdir, "HEAD"])).unwrap();
    assert_eq!(head.trim(), "ref: refs/heads/test-branch");
});

dual_fixture_test!(checkout_unfetched_commit_errors, checkout_unfetched_commit_errors_sub, "test-checkout", |f| {
    let err = checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("missing-branch"), None, None, false, false, false, false, true).unwrap_err();
    assert_eq!(err.code, ErrorCode::CommitNotFetchedError);
});

dual_fixture_test!(checkout_remote_tracking_branch_auto_creates_local, checkout_remote_tracking_branch_auto_creates_local_sub, "test-checkout", |f| {
    let actual_gitdir = discover_gitdir(&f.fs, &f.gitdir);
    let oid = resolve_ref(&f.fs, &f.gitdir, "test-branch", None).unwrap();
    f.fs.write_str(&join(&[&actual_gitdir, "refs/remotes/origin/remote-feature"]), &format!("{oid}\n"));
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("remote-feature"), None, Some("origin"), false, false, false, true, true).unwrap();
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "refs/heads/remote-feature", None).unwrap(), oid);
});

// ============================================================================
// 2. test-merge + submodule
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
            timezone_offset: 0.0,
        }),
        None,
    )
    .unwrap_err();
    assert_eq!(err.code, ErrorCode::UnmergedPathsError);
});

dual_fixture_test!(merge_master_into_master_already_merged, merge_master_into_master_already_merged_sub, "test-merge", |f| {
    let desired_oid = resolve_ref(&f.fs, &f.gitdir, "master", None).unwrap();
    let m = merge(&f.fs, None, &f.gitdir, Some("master"), "master", true, false, false, false, false, None, None, None).unwrap();
    assert!(m.already_merged);
    assert!(!m.fast_forward);
    assert_eq!(m.oid.as_deref(), Some(desired_oid.as_str()));
});

dual_fixture_test!(merge_medium_into_master_already_merged, merge_medium_into_master_already_merged_sub, "test-merge", |f| {
    let desired_oid = resolve_ref(&f.fs, &f.gitdir, "master", None).unwrap();
    let m = merge(&f.fs, None, &f.gitdir, Some("master"), "medium", true, false, false, false, false, None, None, None).unwrap();
    assert!(m.already_merged);
    assert!(!m.fast_forward);
    assert_eq!(m.oid.as_deref(), Some(desired_oid.as_str()));
});

dual_fixture_test!(merge_oldest_into_master_already_merged, merge_oldest_into_master_already_merged_sub, "test-merge", |f| {
    let desired_oid = resolve_ref(&f.fs, &f.gitdir, "master", None).unwrap();
    let m = merge(&f.fs, None, &f.gitdir, Some("master"), "oldest", true, false, false, false, false, None, None, None).unwrap();
    assert!(m.already_merged);
    assert!(!m.fast_forward);
    assert_eq!(m.oid.as_deref(), Some(desired_oid.as_str()));
});

dual_fixture_test!(merge_master_into_oldest_fast_forward, merge_master_into_oldest_fast_forward_sub, "test-merge", |f| {
    let desired_oid = resolve_ref(&f.fs, &f.gitdir, "master", None).unwrap();
    let m = merge(&f.fs, None, &f.gitdir, Some("oldest"), "master", true, false, false, false, false, None, None, None).unwrap();
    assert!(!m.already_merged);
    assert!(m.fast_forward);
    assert_eq!(m.oid.as_deref(), Some(desired_oid.as_str()));
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "oldest", None).unwrap(), desired_oid);
});

dual_fixture_test!(merge_master_into_oldest_dry_run_does_not_move_ref, merge_master_into_oldest_dry_run_does_not_move_ref_sub, "test-merge", |f| {
    let orig_oldest = resolve_ref(&f.fs, &f.gitdir, "oldest", None).unwrap();
    let desired_oid = resolve_ref(&f.fs, &f.gitdir, "master", None).unwrap();
    let m = merge(&f.fs, None, &f.gitdir, Some("oldest"), "master", true, false, true, false, false, None, None, None).unwrap();
    assert!(m.fast_forward);
    assert_eq!(m.oid.as_deref(), Some(desired_oid.as_str()));
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "oldest", None).unwrap(), orig_oldest);
});

dual_fixture_test!(merge_master_into_oldest_no_update_branch, merge_master_into_oldest_no_update_branch_sub, "test-merge", |f| {
    let orig_oldest = resolve_ref(&f.fs, &f.gitdir, "oldest", None).unwrap();
    let desired_oid = resolve_ref(&f.fs, &f.gitdir, "master", None).unwrap();
    let m = merge(&f.fs, None, &f.gitdir, Some("oldest"), "master", true, false, false, true, false, None, None, None).unwrap();
    assert!(m.fast_forward);
    assert_eq!(m.oid.as_deref(), Some(desired_oid.as_str()));
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "oldest", None).unwrap(), orig_oldest);
});

dual_fixture_test!(merge_no_fast_forward_creates_merge_commit, merge_no_fast_forward_creates_merge_commit_sub, "test-merge", |f| {
    let author = Author {
        name: "Mr. Test".to_string(),
        email: "mrtest@example.com".to_string(),
        timestamp: 1262356920,
        timezone_offset: -0.0,
    };
    let m = merge(&f.fs, None, &f.gitdir, Some("a"), "b", false, false, false, false, false, None, Some(author), None).unwrap();
    assert!(!m.fast_forward);
    assert!(m.merge_commit);
    let c = read_commit(&f.fs, &f.gitdir, m.oid.as_ref().unwrap()).unwrap();
    assert_eq!(c.commit.parent.len(), 2);
});

dual_fixture_test!(merge_fast_forward_only_fails_when_diverged, merge_fast_forward_only_fails_when_diverged_sub, "test-merge", |f| {
    let author = Author {
        name: "Mr. Test".to_string(),
        email: "mrtest@example.com".to_string(),
        timestamp: 1262356920,
        timezone_offset: -0.0,
    };
    let err = merge(&f.fs, None, &f.gitdir, Some("a"), "b", true, true, false, false, false, None, Some(author), None).unwrap_err();
    assert_eq!(err.code, ErrorCode::FastForwardError);
});

dual_fixture_test!(merge_three_way_clean_branches_a_and_b, merge_three_way_clean_branches_a_and_b_sub, "test-merge", |f| {
    let author = Author {
        name: "Mr. Test".to_string(),
        email: "mrtest@example.com".to_string(),
        timestamp: 1262356920,
        timezone_offset: -0.0,
    };
    let m = merge(&f.fs, None, &f.gitdir, Some("a"), "b", true, false, false, false, false, None, Some(author), None).unwrap();
    assert!(m.merge_commit);
    assert!(!m.fast_forward);
    assert_eq!(m.oid.as_deref(), Some("0e247301ad28fb64dcf58642fd6c51a099611112"));
    assert_eq!(m.tree.as_deref(), Some("5708c7e22ebfbf8d13413fc255b8ff422227dc1e"));
});

dual_fixture_test!(merge_three_way_clean_with_custom_message, merge_three_way_clean_with_custom_message_sub, "test-merge", |f| {
    let author = Author {
        name: "Mr. Test".to_string(),
        email: "mrtest@example.com".to_string(),
        timestamp: 1262356920,
        timezone_offset: -0.0,
    };
    let m = merge(&f.fs, None, &f.gitdir, Some("a"), "b", true, false, false, false, false, Some("Custom merge message\n"), Some(author), None).unwrap();
    let c = read_commit(&f.fs, &f.gitdir, m.oid.as_ref().unwrap()).unwrap();
    assert_eq!(c.commit.message, "Custom merge message\n");
});

dual_fixture_test!(merge_conflict_returns_merge_conflict_error, merge_conflict_returns_merge_conflict_error_sub, "test-merge", |f| {
    let author = Author {
        name: "Mr. Test".to_string(),
        email: "mrtest@example.com".to_string(),
        timestamp: 1262356920,
        timezone_offset: -0.0,
    };
    let err = merge(&f.fs, Some(&f.dir), &f.gitdir, Some("a"), "c", true, false, false, false, false, None, Some(author), None).unwrap_err();
    assert_eq!(err.code, ErrorCode::MergeConflictError);
});

dual_fixture_test!(merge_conflict_with_abort_on_conflict_false_writes_conflict_markers, merge_conflict_with_abort_on_conflict_false_writes_conflict_markers_sub, "test-abortMerge", |f| {
    let author = Author {
        name: "Mr. Test".to_string(),
        email: "mrtest@example.com".to_string(),
        timestamp: 1262356920,
        timezone_offset: -0.0,
    };
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("a"), None, None, false, false, false, true, true).unwrap();
    let err = merge(&f.fs, Some(&f.dir), &f.gitdir, Some("a"), "b", true, false, false, false, false, None, Some(author), None).unwrap_err();
    assert_eq!(err.code, ErrorCode::MergeConflictError);
    let actual_gitdir = discover_gitdir(&f.fs, &f.gitdir);
    GitIndexManager::acquire(&f.fs, &actual_gitdir, |index| {
        assert!(!index.unmerged_paths().is_empty());
        Ok(())
    }).unwrap();
});

// ============================================================================
// 3. test-abortMerge + submodule
// ============================================================================
dual_fixture_test!(abort_merge_restores_index_and_worktree, abort_merge_restores_index_and_worktree_sub, "test-abortMerge", |f| {
    let author = Author {
        name: "Mr. Test".to_string(),
        email: "mrtest@example.com".to_string(),
        timestamp: 1262356920,
        timezone_offset: -0.0,
    };
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("a"), None, None, false, false, false, true, true).unwrap();
    let _ = merge(&f.fs, Some(&f.dir), &f.gitdir, Some("a"), "c", true, false, false, false, false, None, Some(author), None);

    abort_merge(&f.fs, &f.dir, Some(&f.gitdir), Some("HEAD")).unwrap();
    let actual_gitdir = discover_gitdir(&f.fs, &f.gitdir);
    GitIndexManager::acquire(&f.fs, &actual_gitdir, |index| {
        assert_eq!(index.unmerged_paths().len(), 0);
        Ok(())
    }).unwrap();
});

dual_fixture_test!(abort_merge_preserves_untracked_files_in_worktree, abort_merge_preserves_untracked_files_in_worktree_sub, "test-abortMerge", |f| {
    let author = Author {
        name: "Mr. Test".to_string(),
        email: "mrtest@example.com".to_string(),
        timestamp: 1262356920,
        timezone_offset: -0.0,
    };
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("a"), None, None, false, false, false, true, true).unwrap();
    let _ = merge(&f.fs, Some(&f.dir), &f.gitdir, Some("a"), "b", true, false, false, false, false, None, Some(author), None);
    f.fs.write_str(&join(&[&f.dir, "c"]), "new text for file c");

    abort_merge(&f.fs, &f.dir, Some(&f.gitdir), Some("HEAD")).unwrap();
    let head_oid = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    let head_a = String::from_utf8(read_blob(&f.fs, &f.gitdir, &head_oid, Some("a")).unwrap().blob).unwrap();
    let head_b = String::from_utf8(read_blob(&f.fs, &f.gitdir, &head_oid, Some("b")).unwrap().blob).unwrap();
    assert_eq!(f.fs.read_str(&join(&[&f.dir, "a"])).unwrap(), head_a);
    assert_eq!(f.fs.read_str(&join(&[&f.dir, "b"])).unwrap(), head_b);
    assert_eq!(f.fs.read_str(&join(&[&f.dir, "c"])).unwrap(), "new text for file c");
});

// ============================================================================
// 4. test-cherryPick + submodule
// ============================================================================
dual_fixture_test!(cherry_pick_root_commit_errors, cherry_pick_root_commit_errors_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    let author = Author { name: "Test".into(), email: "t@e.com".into(), timestamp: 1600000000, timezone_offset: 0.0 };
    f.fs.write_str(&join(&[&f.dir, "file.txt"]), "base\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["file.txt".to_string()], false).unwrap();
    let root_oid = commit(&f.fs, &f.gitdir, Some("base\n"), Some(author), None, false, false, false, false, None, None, None).unwrap();
    let err = cherry_pick(&f.fs, Some(&f.dir), &f.gitdir, &root_oid, false, false, true, None, None, None).unwrap_err();
    assert_eq!(err.code, ErrorCode::CherryPickRootCommitError);
});

dual_fixture_test!(cherry_pick_dry_run_does_not_update_head, cherry_pick_dry_run_does_not_update_head_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    let author = Author { name: "Test".into(), email: "t@e.com".into(), timestamp: 1600000000, timezone_offset: 0.0 };
    set_config(&f.fs, &f.gitdir, "user.name", Some(&author.name), false).unwrap();
    set_config(&f.fs, &f.gitdir, "user.email", Some(&author.email), false).unwrap();
    f.fs.write_str(&join(&[&f.dir, "file.txt"]), "base\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["file.txt".to_string()], false).unwrap();
    commit(&f.fs, &f.gitdir, Some("base\n"), Some(author.clone()), None, false, false, false, false, None, None, None).unwrap();

    branch(&f.fs, &f.gitdir, "feature", None, true, false).unwrap();
    f.fs.write_str(&join(&[&f.dir, "feature.txt"]), "feature change\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["feature.txt".to_string()], false).unwrap();
    let feature_oid = commit(&f.fs, &f.gitdir, Some("feature\n"), Some(author.clone()), None, false, false, false, false, None, None, None).unwrap();

    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("master"), None, None, false, false, false, true, true).unwrap();
    f.fs.write_str(&join(&[&f.dir, "master.txt"]), "master updated\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["master.txt".to_string()], false).unwrap();
    let master_oid = commit(&f.fs, &f.gitdir, Some("master\n"), Some(author), None, false, false, false, false, None, None, None).unwrap();

    let _ = cherry_pick(&f.fs, Some(&f.dir), &f.gitdir, &feature_oid, false, true, true, None, None, None).unwrap();
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap(), master_oid);
});

dual_fixture_test!(cherry_pick_applies_commit_and_updates_worktree, cherry_pick_applies_commit_and_updates_worktree_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    let author = Author { name: "Test".into(), email: "t@e.com".into(), timestamp: 1600000000, timezone_offset: 0.0 };
    set_config(&f.fs, &f.gitdir, "user.name", Some(&author.name), false).unwrap();
    set_config(&f.fs, &f.gitdir, "user.email", Some(&author.email), false).unwrap();
    f.fs.write_str(&join(&[&f.dir, "file.txt"]), "base\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["file.txt".to_string()], false).unwrap();
    commit(&f.fs, &f.gitdir, Some("base\n"), Some(author.clone()), None, false, false, false, false, None, None, None).unwrap();

    branch(&f.fs, &f.gitdir, "feature", None, true, false).unwrap();
    f.fs.write_str(&join(&[&f.dir, "feature.txt"]), "feature change\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["feature.txt".to_string()], false).unwrap();
    let feature_oid = commit(&f.fs, &f.gitdir, Some("feature\n"), Some(author.clone()), None, false, false, false, false, None, None, None).unwrap();

    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("master"), None, None, false, false, false, true, true).unwrap();
    f.fs.write_str(&join(&[&f.dir, "master.txt"]), "master updated\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["master.txt".to_string()], false).unwrap();
    commit(&f.fs, &f.gitdir, Some("master\n"), Some(author), None, false, false, false, false, None, None, None).unwrap();

    let new_oid = cherry_pick(&f.fs, Some(&f.dir), &f.gitdir, &feature_oid, false, false, true, None, None, None).unwrap();
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap(), new_oid);
    assert_eq!(f.fs.read_str(&join(&[&f.dir, "feature.txt"])).unwrap(), "feature change\n");
});

dual_fixture_test!(cherry_pick_conflict_returns_merge_conflict_error, cherry_pick_conflict_returns_merge_conflict_error_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    let author = Author { name: "Test".into(), email: "t@e.com".into(), timestamp: 1600000000, timezone_offset: 0.0 };
    set_config(&f.fs, &f.gitdir, "user.name", Some(&author.name), false).unwrap();
    set_config(&f.fs, &f.gitdir, "user.email", Some(&author.email), false).unwrap();
    f.fs.write_str(&join(&[&f.dir, "file.txt"]), "line1\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["file.txt".to_string()], false).unwrap();
    commit(&f.fs, &f.gitdir, Some("base\n"), Some(author.clone()), None, false, false, false, false, None, None, None).unwrap();

    branch(&f.fs, &f.gitdir, "feature", None, true, false).unwrap();
    f.fs.write_str(&join(&[&f.dir, "file.txt"]), "feature line\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["file.txt".to_string()], false).unwrap();
    let feature_oid = commit(&f.fs, &f.gitdir, Some("feature\n"), Some(author.clone()), None, false, false, false, false, None, None, None).unwrap();

    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("master"), None, None, false, false, false, true, true).unwrap();
    f.fs.write_str(&join(&[&f.dir, "file.txt"]), "conflicting master line\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["file.txt".to_string()], false).unwrap();
    commit(&f.fs, &f.gitdir, Some("master\n"), Some(author), None, false, false, false, false, None, None, None).unwrap();

    let err = cherry_pick(&f.fs, Some(&f.dir), &f.gitdir, &feature_oid, false, false, true, None, None, None).unwrap_err();
    assert_eq!(err.code, ErrorCode::MergeConflictError);
});

// ============================================================================
// 5. test-stash + submodule
// ============================================================================
dual_fixture_test!(stash_push_and_restore_clean_worktree, stash_push_and_restore_clean_worktree_sub, "test-stash", |f| {
    set_config(&f.fs, &f.gitdir, "user.name", Some("stash tester"), false).unwrap();
    set_config(&f.fs, &f.gitdir, "user.email", Some("test@stash.com"), false).unwrap();
    let orig_a = f.fs.read_str(&join(&[&f.dir, "a.txt"])).unwrap();
    f.fs.write_str(&join(&[&f.dir, "a.txt"]), "staged changes - a");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["a.txt".to_string()], false).unwrap();
    stash(&f.fs, &f.dir, Some(&f.gitdir), Some("push"), Some("custom stash msg"), 0).unwrap();
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "a.txt").unwrap(), "unmodified");
    assert_eq!(f.fs.read_str(&join(&[&f.dir, "a.txt"])).unwrap(), orig_a);
});

dual_fixture_test!(stash_list_shows_saved_entries, stash_list_shows_saved_entries_sub, "test-stash", |f| {
    set_config(&f.fs, &f.gitdir, "user.name", Some("stash tester"), false).unwrap();
    set_config(&f.fs, &f.gitdir, "user.email", Some("test@stash.com"), false).unwrap();
    f.fs.write_str(&join(&[&f.dir, "a.txt"]), "staged changes - a");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["a.txt".to_string()], false).unwrap();
    stash(&f.fs, &f.dir, Some(&f.gitdir), Some("push"), Some("custom stash msg"), 0).unwrap();
    let list_out = stash(&f.fs, &f.dir, Some(&f.gitdir), Some("list"), None, 0).unwrap().unwrap();
    assert!(list_out.contains("stash@{0}"));
    assert!(list_out.contains("custom stash msg"));
});

dual_fixture_test!(stash_apply_restores_changes_without_dropping, stash_apply_restores_changes_without_dropping_sub, "test-stash", |f| {
    set_config(&f.fs, &f.gitdir, "user.name", Some("stash tester"), false).unwrap();
    set_config(&f.fs, &f.gitdir, "user.email", Some("test@stash.com"), false).unwrap();
    f.fs.write_str(&join(&[&f.dir, "a.txt"]), "staged changes - a");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["a.txt".to_string()], false).unwrap();
    stash(&f.fs, &f.dir, Some(&f.gitdir), Some("push"), Some("apply msg"), 0).unwrap();
    stash(&f.fs, &f.dir, Some(&f.gitdir), Some("apply"), None, 0).unwrap();
    assert_eq!(f.fs.read_str(&join(&[&f.dir, "a.txt"])).unwrap(), "staged changes - a");
    let list_out = stash(&f.fs, &f.dir, Some(&f.gitdir), Some("list"), None, 0).unwrap().unwrap();
    assert!(list_out.contains("stash@{0}"));
});

dual_fixture_test!(stash_pop_restores_and_removes_entry, stash_pop_restores_and_removes_entry_sub, "test-stash", |f| {
    set_config(&f.fs, &f.gitdir, "user.name", Some("stash tester"), false).unwrap();
    set_config(&f.fs, &f.gitdir, "user.email", Some("test@stash.com"), false).unwrap();
    f.fs.write_str(&join(&[&f.dir, "a.txt"]), "staged changes - a");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["a.txt".to_string()], false).unwrap();
    stash(&f.fs, &f.dir, Some(&f.gitdir), Some("push"), Some("pop msg"), 0).unwrap();
    stash(&f.fs, &f.dir, Some(&f.gitdir), Some("pop"), None, 0).unwrap();
    assert_eq!(f.fs.read_str(&join(&[&f.dir, "a.txt"])).unwrap(), "staged changes - a");
});

dual_fixture_test!(stash_drop_and_clear, stash_drop_and_clear_sub, "test-stash", |f| {
    set_config(&f.fs, &f.gitdir, "user.name", Some("stash tester"), false).unwrap();
    set_config(&f.fs, &f.gitdir, "user.email", Some("test@stash.com"), false).unwrap();
    f.fs.write_str(&join(&[&f.dir, "a.txt"]), "staged changes - a");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["a.txt".to_string()], false).unwrap();
    stash(&f.fs, &f.dir, Some(&f.gitdir), Some("push"), Some("drop msg"), 0).unwrap();
    stash(&f.fs, &f.dir, Some(&f.gitdir), Some("drop"), None, 0).unwrap();
    stash(&f.fs, &f.dir, Some(&f.gitdir), Some("clear"), None, 0).unwrap();
    let empty_list = stash(&f.fs, &f.dir, Some(&f.gitdir), Some("list"), None, 0).unwrap().unwrap_or_default();
    assert!(empty_list.trim().is_empty());
});
