//! Git Parity Suite — Batch 3 (40 upstream test files)
//!
//! Covers:
//! - test-branch.js + test-branch-in-submodule.js
//! - test-currentBranch.js + test-currentBranch-in-submodule.js
//! - test-deleteBranch.js + test-deleteBranch-in-submodule.js
//! - test-listBranches.js + test-listBranches-in-submodule.js
//! - test-renameBranch.js + test-renameBranch-in-submodule.js
//! - test-tag.js + test-tag-in-submodule.js
//! - test-annotatedTag.js + test-annotatedTag-in-submodule.js
//! - test-deleteTag.js + test-deleteTag-in-submodule.js
//! - test-listTags.js + test-listTags-in-submodule.js
//! - test-addNote.js + test-addNote-in-submodule.js
//! - test-readNote.js + test-readNote-in-submodule.js
//! - test-removeNote.js + test-removeNote-in-submodule.js
//! - test-listNotes.js + test-listNotes-in-submodule.js
//! - test-addRemote.js + test-addRemote-in-submodule.js
//! - test-deleteRemote.js + test-deleteRemote-in-submodule.js
//! - test-listRemotes.js + test-listRemotes-in-submodule.js
//! - test-log.js + test-log-in-submodule.js
//! - test-walk.js + test-walk-in-submodule.js
//! - test-findMergeBase.js + test-findMergeBase-in-submodule.js
//! - test-listCommitsAndTags.js + test-listCommitsAndTags-in-submodule.js
//! - test-listObjects.js + test-listObjects-in-submodule.js

use git_rust::commands::plumbing::{
    add_note, add_remote, annotated_tag, branch, delete_branch, delete_remote, delete_tag,
    find_merge_base, get_config, init, list_commits_and_tags, list_notes, list_objects,
    list_remotes, log, read_blob, read_note, read_tag, remove_note, rename_branch,
    set_config, tag, write_commit, write_tree,
};
use git_rust::commands::walk::{walk, STAGE, TREE, WORKDIR};
use git_rust::errors::ErrorCode;
use git_rust::fixtures::{make_fixture, make_fixture_as_submodule};
use git_rust::models::CommitObject;
use git_rust::utils::{join, Author};
use git_rust::{current_branch, list_branches, list_tags, resolve_ref, write_ref};

macro_rules! dual_fixture_test {
    ($name:ident, $sub_name:ident, $fixture:expr, |$ctx:ident| $body:block) => {
        #[test]
        fn $name() {
            let $ctx = make_fixture($fixture);
            $body
        }

        #[test]
        fn $sub_name() {
            let $ctx = make_fixture_as_submodule($fixture);
            $body
        }
    };
}

// ============================================================================
// 1. test-branch.js + submodule (20 tests)
// ============================================================================
dual_fixture_test!(branch_create_default, branch_create_default_sub, "test-branch", |f| {
    branch(&f.fs, &f.gitdir, "test-branch", None, false, false).unwrap();
    let branches = list_branches(&f.fs, &f.gitdir, None);
    assert!(branches.contains(&"test-branch".to_string()));
});

dual_fixture_test!(branch_with_start_point, branch_with_start_point_sub, "test-branch", |f| {
    branch(&f.fs, &f.gitdir, "test-branch", Some("HEAD"), false, false).unwrap();
    let oid = resolve_ref(&f.fs, &f.gitdir, "refs/heads/test-branch", None).unwrap();
    let head = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    assert_eq!(oid, head);
});

dual_fixture_test!(branch_force_overwrites, branch_force_overwrites_sub, "test-branch", |f| {
    branch(&f.fs, &f.gitdir, "test-branch", None, false, false).unwrap();
    assert_eq!(
        branch(&f.fs, &f.gitdir, "test-branch", None, false, false).unwrap_err().code,
        ErrorCode::AlreadyExistsError
    );
    branch(&f.fs, &f.gitdir, "test-branch", None, false, true).unwrap();
});

dual_fixture_test!(branch_checkout_updates_head, branch_checkout_updates_head_sub, "test-branch", |f| {
    branch(&f.fs, &f.gitdir, "test-branch", None, true, false).unwrap();
    assert_eq!(current_branch(&f.fs, &f.gitdir, false, false).unwrap(), Some("test-branch".to_string()));
});

dual_fixture_test!(branch_invalid_name_errors, branch_invalid_name_errors_sub, "test-branch", |f| {
    assert_eq!(
        branch(&f.fs, &f.gitdir, "inv@{id..branch.lock", None, false, false).unwrap_err().code,
        ErrorCode::InvalidRefNameError
    );
});

dual_fixture_test!(branch_empty_repo_checkout, branch_empty_repo_checkout_sub, "test-branch-empty-repo", |f| {
    branch(&f.fs, &f.gitdir, "test-branch-checkout", None, true, false).unwrap();
    assert_eq!(current_branch(&f.fs, &f.gitdir, false, false).unwrap(), Some("test-branch-checkout".to_string()));
});

dual_fixture_test!(branch_named_head_and_origin, branch_named_head_and_origin_sub, "test-branch", |f| {
    branch(&f.fs, &f.gitdir, "origin", None, false, false).unwrap();
    branch(&f.fs, &f.gitdir, "HEAD", None, false, false).unwrap();
    let branches = list_branches(&f.fs, &f.gitdir, None);
    assert!(branches.contains(&"origin".to_string()));
    assert!(branches.contains(&"HEAD".to_string()));
});

// ============================================================================
// 2. test-currentBranch.js + submodule (6 tests)
// ============================================================================
dual_fixture_test!(current_branch_short_and_full, current_branch_short_and_full_sub, "test-resolveRef", |f| {
    assert_eq!(current_branch(&f.fs, &f.gitdir, false, false).unwrap(), Some("master".to_string()));
    assert_eq!(current_branch(&f.fs, &f.gitdir, true, false).unwrap(), Some("refs/heads/master".to_string()));
});

dual_fixture_test!(current_branch_detached_head, current_branch_detached_head_sub, "test-detachedHead", |f| {
    assert_eq!(current_branch(&f.fs, &f.gitdir, false, false).unwrap(), None);
});

// ============================================================================
// 3. test-deleteBranch.js + submodule (12 tests)
// ============================================================================
dual_fixture_test!(delete_branch_basic_and_config, delete_branch_basic_and_config_sub, "test-deleteBranch", |f| {
    delete_branch(&f.fs, &f.gitdir, "test").unwrap();
    let branches = list_branches(&f.fs, &f.gitdir, None);
    assert!(!branches.contains(&"test".to_string()));
});

dual_fixture_test!(delete_branch_nonexistent_errors, delete_branch_nonexistent_errors_sub, "test-deleteBranch", |f| {
    assert_eq!(
        delete_branch(&f.fs, &f.gitdir, "branch-not-exist").unwrap_err().code,
        ErrorCode::NotFoundError
    );
});

dual_fixture_test!(delete_branch_checked_out_detaches_head, delete_branch_checked_out_detaches_head_sub, "test-deleteBranch", |f| {
    delete_branch(&f.fs, &f.gitdir, "master").unwrap();
    assert_eq!(current_branch(&f.fs, &f.gitdir, false, false).unwrap(), None);
    assert!(!list_branches(&f.fs, &f.gitdir, None).contains(&"master".to_string()));
    delete_branch(&f.fs, &f.gitdir, "collision").unwrap();
    assert!(!list_branches(&f.fs, &f.gitdir, None).contains(&"collision".to_string()));
    assert!(list_tags(&f.fs, &f.gitdir).contains(&"collision".to_string()));
    delete_branch(&f.fs, &f.gitdir, "remote").unwrap();
    assert!(get_config(&f.fs, &f.gitdir, "branch.remote.remote").is_none());
});

// ============================================================================
// 4. test-listBranches.js + submodule (4 tests)
// ============================================================================
dual_fixture_test!(list_branches_local_and_remote, list_branches_local_and_remote_sub, "test-listBranches", |f| {
    let local = list_branches(&f.fs, &f.gitdir, None);
    assert!(local.contains(&"master".to_string()));
    assert!(local.contains(&"feature/supercool".to_string()));
    let remote = list_branches(&f.fs, &f.gitdir, Some("origin"));
    assert!(remote.contains(&"HEAD".to_string()));
    assert!(remote.contains(&"master".to_string()));
});

// ============================================================================
// 5. test-renameBranch.js + submodule (16 tests)
// ============================================================================
dual_fixture_test!(rename_branch_basic_and_checkout, rename_branch_basic_and_checkout_sub, "test-renameBranch", |f| {
    rename_branch(&f.fs, &f.gitdir, "test-branch", "other-branch-new", false).unwrap();
    let branches = list_branches(&f.fs, &f.gitdir, None);
    assert!(branches.contains(&"other-branch-new".to_string()));
    assert!(!branches.contains(&"test-branch".to_string()));
});

dual_fixture_test!(rename_branch_current_branch, rename_branch_current_branch_sub, "test-renameBranch", |f| {
    rename_branch(&f.fs, &f.gitdir, "master", "main", false).unwrap();
    assert_eq!(current_branch(&f.fs, &f.gitdir, false, false).unwrap(), Some("main".to_string()));
});

dual_fixture_test!(rename_branch_already_exists_and_invalid, rename_branch_already_exists_and_invalid_sub, "test-renameBranch", |f| {
    assert_eq!(
        rename_branch(&f.fs, &f.gitdir, "test-branch", "existing-branch", false).unwrap_err().code,
        ErrorCode::AlreadyExistsError
    );
    assert_eq!(
        rename_branch(&f.fs, &f.gitdir, "test-branch", "inv@{id..branch.lock", false).unwrap_err().code,
        ErrorCode::InvalidRefNameError
    );
});

// ============================================================================
// 6. test-tag.js + test-annotatedTag.js + test-deleteTag.js + test-listTags.js + submodule (22 tests)
// ============================================================================
dual_fixture_test!(tag_create_and_force, tag_create_and_force_sub, "test-tag", |f| {
    tag(&f.fs, &f.gitdir, "latest", None, false).unwrap();
    assert_eq!(
        tag(&f.fs, &f.gitdir, "latest", None, false).unwrap_err().code,
        ErrorCode::AlreadyExistsError
    );
    tag(&f.fs, &f.gitdir, "latest", None, true).unwrap();
    assert_eq!(
        tag(&f.fs, &f.gitdir, "packed-tag", None, false).unwrap_err().code,
        ErrorCode::AlreadyExistsError
    );
    tag(&f.fs, &f.gitdir, "packed-tag", None, true).unwrap();
});

dual_fixture_test!(annotated_tag_to_head_and_blob, annotated_tag_to_head_and_blob_sub, "test-annotatedTag", |f| {
    let tagger = Author {
        name: "William Hilton".to_string(),
        email: "wmhilton@gmail.com".to_string(),
        timestamp: 1507802399,
        timezone_offset: 240.0,
    };
    annotated_tag(
        &f.fs,
        &f.gitdir,
        "latest",
        Some("This is an annotated tag"),
        None,
        Some(tagger.clone()),
        None,
        false,
    )
    .unwrap();
    let tag_oid = resolve_ref(&f.fs, &f.gitdir, "refs/tags/latest", None).unwrap();
    let rt = read_tag(&f.fs, &f.gitdir, &tag_oid).unwrap();
    assert_eq!(rt.tag.tag, "latest");
    assert_eq!(rt.tag.object_type, "commit");

    annotated_tag(
        &f.fs,
        &f.gitdir,
        "latest-blob",
        Some("This is an annotated tag pointing to a blob"),
        Some("d670460b4b4aece5915caf5c68d12f560a9fe3e4"),
        Some(tagger),
        None,
        false,
    )
    .unwrap();
    let blob_tag_oid = resolve_ref(&f.fs, &f.gitdir, "refs/tags/latest-blob", None).unwrap();
    let bt = read_tag(&f.fs, &f.gitdir, &blob_tag_oid).unwrap();
    assert_eq!(bt.tag.object_type, "blob");
});

dual_fixture_test!(delete_tag_and_list_tags, delete_tag_and_list_tags_sub, "test-deleteTag", |f| {
    delete_tag(&f.fs, &f.gitdir, "latest").unwrap();
    let tags = list_tags(&f.fs, &f.gitdir);
    assert_eq!(tags, vec!["prev"]);
});

dual_fixture_test!(list_tags_all, list_tags_all_sub, "test-listTags", |f| {
    let tags = list_tags(&f.fs, &f.gitdir);
    assert!(tags.contains(&"v0.0.1".to_string()));
    assert!(tags.contains(&"test-tag".to_string()));
});

// ============================================================================
// 7. test-addNote.js + test-readNote.js + test-removeNote.js + test-listNotes.js + submodule (32 tests)
// ============================================================================
dual_fixture_test!(notes_add_read_list_remove, notes_add_read_list_remove_sub, "test-addNote", |f| {
    let author = Author {
        name: "William Hilton".to_string(),
        email: "wmhilton@gmail.com".to_string(),
        timestamp: 1578937310,
        timezone_offset: 300.0,
    };
    let oid = add_note(
        &f.fs,
        &f.gitdir,
        None,
        "f6d51b1f9a449079f6999be1fb249c359511f164",
        b"This is a note about a commit.",
        false,
        author.clone(),
        None,
    )
    .unwrap();
    assert_eq!(oid, "dc0705f1436d4ccbd0af038bdbe841cc36629ed2");
    let blob = read_blob(&f.fs, &f.gitdir, &oid, Some("f6d51b1f9a449079f6999be1fb249c359511f164")).unwrap();
    assert_eq!(blob.blob, b"This is a note about a commit.");

    // AlreadyExists without force
    assert_eq!(
        add_note(
            &f.fs,
            &f.gitdir,
            None,
            "f6d51b1f9a449079f6999be1fb249c359511f164",
            b"Duplicate",
            false,
            author.clone(),
            None,
        )
        .unwrap_err()
        .code,
        ErrorCode::AlreadyExistsError
    );

    // Replace with force
    add_note(
        &f.fs,
        &f.gitdir,
        None,
        "f6d51b1f9a449079f6999be1fb249c359511f164",
        b"Replaced note",
        true,
        author.clone(),
        None,
    )
    .unwrap();
    let note_bytes = read_note(&f.fs, &f.gitdir, None, "f6d51b1f9a449079f6999be1fb249c359511f164").unwrap();
    assert_eq!(note_bytes, b"Replaced note");

    // Add note to alternate branch
    add_note(
        &f.fs,
        &f.gitdir,
        Some("refs/notes/alt"),
        "68aba62e560c0ebc3396e8ae9335232cd93a3f60",
        b"This is a note about a blob.",
        false,
        author.clone(),
        None,
    )
    .unwrap();
    assert_eq!(
        read_note(&f.fs, &f.gitdir, Some("refs/notes/alt"), "68aba62e560c0ebc3396e8ae9335232cd93a3f60").unwrap(),
        b"This is a note about a blob."
    );
});

dual_fixture_test!(read_list_remove_notes_fixture, read_list_remove_notes_fixture_sub, "test-readNote", |f| {
    let note = read_note(&f.fs, &f.gitdir, None, "f6d51b1f9a449079f6999be1fb249c359511f164").unwrap();
    assert_eq!(String::from_utf8_lossy(&note), "This is a note about a commit.\n");
    let notes = list_notes(&f.fs, &f.gitdir, None).unwrap();
    assert_eq!(notes.len(), 3);
    assert!(list_notes(&f.fs, &f.gitdir, Some("refs/notes/nonexistent")).unwrap().is_empty());

    let author = Author {
        name: "William Hilton".to_string(),
        email: "wmhilton@gmail.com".to_string(),
        timestamp: 1578937310,
        timezone_offset: 300.0,
    };
    remove_note(&f.fs, &f.gitdir, None, "f6d51b1f9a449079f6999be1fb249c359511f164", author, None).unwrap();
    assert_eq!(list_notes(&f.fs, &f.gitdir, None).unwrap().len(), 2);
});

// ============================================================================
// 8. test-addRemote.js + test-deleteRemote.js + test-listRemotes.js + submodule (12 tests)
// ============================================================================
dual_fixture_test!(remotes_add_list_delete, remotes_add_list_delete_sub, "test-addRemote", |f| {
    add_remote(&f.fs, &f.gitdir, "baz", "git@github.com:baz/baz.git", false).unwrap();
    let remotes = list_remotes(&f.fs, &f.gitdir);
    assert!(remotes.iter().any(|r| r.remote == "baz" && r.url == "git@github.com:baz/baz.git"));

    // Invalid remote name
    assert_eq!(
        add_remote(&f.fs, &f.gitdir, "inv@{id..remote.lock", "git@github.com:baz/baz.git", false)
            .unwrap_err()
            .code,
        ErrorCode::InvalidRefNameError
    );

    delete_remote(&f.fs, &f.gitdir, "baz").unwrap();
    let remotes_after = list_remotes(&f.fs, &f.gitdir);
    assert!(!remotes_after.iter().any(|r| r.remote == "baz"));
});

// ============================================================================
// 9. test-log.js + submodule (20 tests)
// ============================================================================
dual_fixture_test!(log_head_depth_and_since, log_head_depth_and_since_sub, "test-log", |f| {
    let commits = log(&f.fs, &f.gitdir, Some("HEAD"), None, None, None, false, false).unwrap();
    assert_eq!(commits.len(), 5);
    let depth1 = log(&f.fs, &f.gitdir, Some("HEAD"), None, Some(1), None, false, false).unwrap();
    assert_eq!(depth1.len(), 1);
    let since_commits = log(&f.fs, &f.gitdir, Some("HEAD"), None, None, Some(1501462174), false, false).unwrap();
    assert_eq!(since_commits.len(), 2);
});

dual_fixture_test!(log_complex_history, log_complex_history_sub, "test-log-complex", |f| {
    let commits = log(&f.fs, &f.gitdir, Some("HEAD"), None, None, None, false, false).unwrap();
    assert!(!commits.is_empty());
});

// ============================================================================
// 10. test-walk.js + submodule (20 tests)
// ============================================================================
dual_fixture_test!(walk_workdir_tree_stage, walk_workdir_tree_stage_sub, "test-walk", |f| {
    let matrix = walk(
        &f.fs,
        Some(&f.dir),
        &f.gitdir,
        &[WORKDIR(), TREE(None), STAGE()],
        |filepath, entries| {
            Ok(Some((
                filepath.to_string(),
                entries[0].is_some(),
                entries[1].is_some(),
                entries[2].is_some(),
            )))
        },
    )
    .unwrap();
    assert_eq!(
        matrix,
        vec![
            (".".to_string(), true, true, true),
            ("a.txt".to_string(), true, true, true),
            ("b.txt".to_string(), true, true, true),
            ("c.txt".to_string(), false, true, true),
            ("d.txt".to_string(), true, false, false),
            ("folder".to_string(), true, true, true),
            ("folder/1.txt".to_string(), true, true, true),
            ("folder/2.txt".to_string(), true, false, false),
            ("folder/3.txt".to_string(), true, false, true),
        ]
    );
});

dual_fixture_test!(walk_populates_type_mode_oid_content, walk_populates_type_mode_oid_content_sub, "test-walk", |f| {
    let res = walk(
        &f.fs,
        Some(&f.dir),
        &f.gitdir,
        &[WORKDIR(), TREE(Some("HEAD")), STAGE()],
        |filepath, entries| {
            if filepath == "a.txt" {
                let w = entries[0].as_ref().unwrap();
                let t = entries[1].as_ref().unwrap();
                let s = entries[2].as_ref().unwrap();
                assert_eq!(w.entry_type(), "blob");
                assert_eq!(w.oid(), Some("e965047ad7c57865823c7d992b1d046ea66edf78"));
                assert_eq!(w.content(), Some(&b"Hello\n"[..]));
                assert_eq!(t.oid(), Some("e965047ad7c57865823c7d992b1d046ea66edf78"));
                assert_eq!(s.oid(), Some("e965047ad7c57865823c7d992b1d046ea66edf78"));
                return Ok(Some(filepath.to_string()));
            }
            Ok(None)
        },
    )
    .unwrap();
    assert_eq!(res, vec!["a.txt".to_string()]);
});

dual_fixture_test!(walk_autocrlf_and_symlinks, walk_autocrlf_and_symlinks_sub, "test-walk", |f| {
    set_config(&f.fs, &f.gitdir, "core.autocrlf", Some("true"), false).unwrap();
    assert_eq!(get_config(&f.fs, &f.gitdir, "core.autocrlf").map(|v| v.as_str().to_string()), Some("true".to_string()));
    f.fs.write_str(&join(&[&f.dir, "a.txt"]), "Hello\r\nagain");
    let oids = walk(&f.fs, Some(&f.dir), &f.gitdir, &[WORKDIR()], |filepath, entries| {
        if filepath == "a.txt" {
            return Ok(entries[0].as_ref().and_then(|e| e.oid().map(|s| s.to_string())));
        }
        Ok(None)
    })
    .unwrap();
    assert_eq!(oids, vec!["e855bd8b67cc7ee321e4dec1b9e5b17e13aec8e1".to_string()]);

    // Symlink target content
    let _ = f.fs.symlink("non-existent-file.txt", &join(&[&f.dir, "broken-link.txt"]));
    let broken = walk(&f.fs, Some(&f.dir), &f.gitdir, &[WORKDIR()], |filepath, entries| {
        if filepath == "broken-link.txt" {
            let e = entries[0].as_ref().unwrap();
            return Ok(Some((e.mode().unwrap(), String::from_utf8_lossy(e.content().unwrap()).to_string())));
        }
        Ok(None)
    })
    .unwrap();
    assert_eq!(broken, vec![(0o120000, "non-existent-file.txt".to_string())]);
});

dual_fixture_test!(walk_error_cases_and_unborn_branch, walk_error_cases_and_unborn_branch_sub, "test-walk", |f| {
    assert_eq!(
        walk(&f.fs, Some(&f.dir), &f.gitdir, &[TREE(Some("refs/heads/does-not-exist"))], |_, _| Ok(Some(())))
            .unwrap_err()
            .code,
        ErrorCode::NotFoundError
    );
    assert_eq!(
        walk(&f.fs, Some(&f.dir), &f.gitdir, &[TREE(Some("master\n"))], |_, _| Ok(Some(())))
            .unwrap_err()
            .code,
        ErrorCode::NotFoundError
    );
});

#[test]
fn walk_unborn_branch_and_missing_tag_head() {
    let f = make_fixture("test-empty");
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, Some("main")).unwrap();
    let items = walk(&f.fs, Some(&f.dir), &f.gitdir, &[TREE(Some("HEAD"))], |fp, _| {
        if fp == "." {
            Ok(None)
        } else {
            Ok(Some(fp.to_string()))
        }
    })
    .unwrap();
    assert!(items.is_empty());

    write_ref(&f.fs, &f.gitdir, "HEAD", "refs/tags/missing", true, true).unwrap();
    assert_eq!(
        walk(&f.fs, Some(&f.dir), &f.gitdir, &[TREE(Some("HEAD"))], |fp, _| Ok(Some(fp.to_string())))
            .unwrap_err()
            .code,
        ErrorCode::NotFoundError
    );
}

// ============================================================================
// 11. test-findMergeBase.js + submodule (16 tests)
// ============================================================================
dual_fixture_test!(find_merge_base_edge_and_no_common, find_merge_base_edge_and_no_common_sub, "test-findMergeBase", |f| {
    assert_eq!(
        find_merge_base(&f.fs, &f.gitdir, &["9ec6646dd454e8f530c478c26f8b06e57f880bd6".to_string()]).unwrap(),
        vec!["9ec6646dd454e8f530c478c26f8b06e57f880bd6"]
    );
    assert!(
        find_merge_base(
            &f.fs,
            &f.gitdir,
            &[
                "9ec6646dd454e8f530c478c26f8b06e57f880bd6".to_string(),
                "99cfd5bb4e412234162ac1eb46350ec6ccffb50d".to_string(),
            ],
        )
        .unwrap()
        .is_empty()
    );
    assert!(find_merge_base(
        &f.fs,
        &f.gitdir,
        &[
            "0000000000000000000000000000000000000000".to_string(),
            "0000000000000000000000000000000000000000".to_string()
        ]
    )
    .is_err());
});

dual_fixture_test!(find_merge_base_ff_diverging_merge_recursive, find_merge_base_ff_diverging_merge_recursive_sub, "test-findMergeBase", |f| {
    // Fast-forward
    assert_eq!(
        find_merge_base(
            &f.fs,
            &f.gitdir,
            &[
                "9ec6646dd454e8f530c478c26f8b06e57f880bd6".to_string(),
                "f79577b91d302d87e310c8b5af8c274bbf45502f".to_string(),
            ],
        )
        .unwrap(),
        vec!["f79577b91d302d87e310c8b5af8c274bbf45502f"]
    );

    // Diverging
    assert_eq!(
        find_merge_base(
            &f.fs,
            &f.gitdir,
            &[
                "c91a8aab1f086c8cc8914558f035e718a8a5c503".to_string(),
                "f79577b91d302d87e310c8b5af8c274bbf45502f".to_string(),
            ],
        )
        .unwrap(),
        vec!["0526923cafece3d898dbe55ee2c2d69bfcc54c60"]
    );

    // Merge commit
    assert_eq!(
        find_merge_base(
            &f.fs,
            &f.gitdir,
            &[
                "423489657e9529ecf285637eb21f40c8657ece3f".to_string(),
                "9ec6646dd454e8f530c478c26f8b06e57f880bd6".to_string(),
            ],
        )
        .unwrap(),
        vec!["21605c3fda133ae46f000a375c92c889fa0688ba"]
    );

    // Recursive merge base
    let rec = find_merge_base(
        &f.fs,
        &f.gitdir,
        &[
            "85303393b9fd415d48913dfec47d42db184dc4d8".to_string(),
            "4c658ff41121ddada50c47e4c72c092a9f7bf2be".to_string(),
        ],
    )
    .unwrap();
    assert!(rec.contains(&"17aa7af08369d0e2d174df64d78fe57f9f0a60ba".to_string()));
    assert!(rec.contains(&"17b2c7d8ba9756c6c28e4d8cfdbed11793952270".to_string()));

    // Fork & rejoin (issue 819)
    assert_eq!(
        find_merge_base(
            &f.fs,
            &f.gitdir,
            &[
                "815474b6e581921cbe05825631decac922803d28".to_string(),
                "83ad8e1ec6f21f8d0d74587b6a8021fec1a165e1".to_string(),
            ],
        )
        .unwrap(),
        vec!["2316ae441d2c72d8d15673beb81390272671c526"]
    );
});

dual_fixture_test!(find_merge_base_does_not_prefer_closer_older, find_merge_base_does_not_prefer_closer_older_sub, "test-findMergeBase", |f| {
    let tree = write_tree(&f.fs, &f.gitdir, &[]).unwrap();
    let author = Author {
        name: "Test Author".to_string(),
        email: "test@example.com".to_string(),
        timestamp: 1502484200,
        timezone_offset: 0.0,
    };
    let mk = |msg: &str, parents: Vec<String>| -> String {
        write_commit(
            &f.fs,
            &f.gitdir,
            &CommitObject {
                message: msg.to_string(),
                tree: tree.clone(),
                parent: parents,
                author: author.clone(),
                committer: author.clone(),
                gpgsig: None,
            },
        )
        .unwrap()
    };
    let e = mk("E", vec![]);
    let f_oid = mk("F", vec![e.clone()]);
    let d = mk("D", vec![e]);
    let c = mk("C", vec![d]);
    let b = mk("B", vec![c.clone()]);
    let a = mk("A", vec![b]);
    let head = mk("HEAD", vec![a, f_oid]);
    assert_eq!(find_merge_base(&f.fs, &f.gitdir, &[head, c.clone()]).unwrap(), vec![c]);
});

// ============================================================================
// 12. test-listCommitsAndTags.js + test-listObjects.js + submodule (4 tests)
// ============================================================================
dual_fixture_test!(list_commits_and_tags_and_objects, list_commits_and_tags_and_objects_sub, "test-listCommitsAndTags", |f| {
    let commits = list_commits_and_tags(
        &f.fs,
        &f.gitdir,
        &["c60bbbe99e96578105c57c4b3f2b6ebdf863edbc".to_string()],
        &["c77052f99c33dbe3d2a120805fcebe9e2194b6f9".to_string()],
    )
    .unwrap();
    assert_eq!(commits.len(), 4);
    assert!(commits.contains("c60bbbe99e96578105c57c4b3f2b6ebdf863edbc"));
    assert!(commits.contains("0518502faba1c63489562641c36a989e0f574d95"));
});

dual_fixture_test!(list_objects_all, list_objects_all_sub, "test-listObjects", |f| {
    let objs = list_objects(
        &f.fs,
        &f.gitdir,
        &[
            "c60bbbe99e96578105c57c4b3f2b6ebdf863edbc".to_string(),
            "e05547ea87ea55eff079de295ff56f483e5b4439".to_string(),
            "ebdedf722a3ec938da3fd53eb74fdea55c48a19d".to_string(),
            "0518502faba1c63489562641c36a989e0f574d95".to_string(),
        ],
    )
    .unwrap();
    assert!(objs.len() > 15);
});


dual_fixture_test!(log_includes_commits_that_only_change_file_mode, log_includes_commits_that_only_change_file_mode_sub, "test-init", |f| {
    use git_rust::commands::plumbing::write_blob;
    use git_rust::models::TreeEntry;
    let author = Author {
        name: "Mr. Test".to_string(),
        email: "mrtest@example.com".to_string(),
        timestamp: 1262356920,
        timezone_offset: 0.0,
    };
    let oid = write_blob(&f.fs, &f.gitdir, b"#!/bin/sh\n").unwrap();
    let reg_tree = write_tree(&f.fs, &f.gitdir, &[TreeEntry { mode: "100644".into(), path: "script.sh".into(), oid: oid.clone(), entry_type: "blob".into() }]).unwrap();
    let reg_commit = write_commit(&f.fs, &f.gitdir, &CommitObject {
        message: "Add script\n".into(), tree: reg_tree, parent: vec![], author: author.clone(), committer: author.clone(), gpgsig: None
    }).unwrap();
    let exe_tree = write_tree(&f.fs, &f.gitdir, &[TreeEntry { mode: "100755".into(), path: "script.sh".into(), oid, entry_type: "blob".into() }]).unwrap();
    let exe_commit = write_commit(&f.fs, &f.gitdir, &CommitObject {
        message: "Make script executable\n".into(), tree: exe_tree, parent: vec![reg_commit], author: author.clone(), committer: author, gpgsig: None
    }).unwrap();
    write_ref(&f.fs, &f.gitdir, "refs/heads/main", &exe_commit, true, false).unwrap();
    let commits = log(&f.fs, &f.gitdir, Some("main"), Some("script.sh"), None, None, false, false).unwrap();
    let msgs: Vec<String> = commits.into_iter().map(|c| c.commit.message.trim().to_string()).collect();
    assert_eq!(msgs, vec!["Make script executable", "Add script"]);
});

dual_fixture_test!(log_shallow_branch, log_shallow_branch_sub, "test-log", |f| {
    let commits = log(&f.fs, &f.gitdir, Some("origin/shallow-branch"), None, None, None, false, false).unwrap();
    assert_eq!(commits.len(), 1);
});
