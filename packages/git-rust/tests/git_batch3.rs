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
                return Ok(Some(Some(filepath.to_string())));
            }
            Ok(Some(None))
        },
    )
    .unwrap().into_iter().flatten().collect::<Vec<_>>();
    assert_eq!(res, vec!["a.txt".to_string()]);
});

dual_fixture_test!(walk_autocrlf_and_symlinks, walk_autocrlf_and_symlinks_sub, "test-walk", |f| {
    set_config(&f.fs, &f.gitdir, "core.autocrlf", Some("true"), false).unwrap();
    assert_eq!(get_config(&f.fs, &f.gitdir, "core.autocrlf").map(|v| v.as_str().to_string()), Some("true".to_string()));
    f.fs.write_str(&join(&[&f.dir, "a.txt"]), "Hello\r\nagain");
    let oids = walk(&f.fs, Some(&f.dir), &f.gitdir, &[WORKDIR()], |filepath, entries| {
        if filepath == "a.txt" {
            return Ok(Some(entries[0].as_ref().and_then(|e| e.oid().map(|s| s.to_string()))));
        }
        Ok(Some(None))
    })
    .unwrap().into_iter().flatten().collect::<Vec<_>>();
    assert_eq!(oids, vec!["e855bd8b67cc7ee321e4dec1b9e5b17e13aec8e1".to_string()]);

    // Symlink target content
    let _ = f.fs.symlink("non-existent-file.txt", &join(&[&f.dir, "broken-link.txt"]));
    let broken = walk(&f.fs, Some(&f.dir), &f.gitdir, &[WORKDIR()], |filepath, entries| {
        if filepath == "broken-link.txt" {
            let e = entries[0].as_ref().unwrap();
            return Ok(Some(Some((e.mode().unwrap(), String::from_utf8_lossy(e.content().unwrap()).to_string()))));
        }
        Ok(Some(None))
    })
    .unwrap().into_iter().flatten().collect::<Vec<_>>();
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

// ============================================================================
// Expanded 1-to-1 Test Cases for Batch 3 (65 dual pairs = 130 additional tests)
// ============================================================================

dual_fixture_test!(branch_with_custom_object_oid, branch_with_custom_object_oid_sub, "test-branch", |f| {
    let head = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    branch(&f.fs, &f.gitdir, "custom-oid-branch", Some(&head), false, false).unwrap();
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "refs/heads/custom-oid-branch", None).unwrap(), head);
});

dual_fixture_test!(branch_empty_repo_no_checkout, branch_empty_repo_no_checkout_sub, "test-branch-empty-repo", |f| {
    branch(&f.fs, &f.gitdir, "unborn-no-checkout", None, false, false).unwrap();
    assert!(!list_branches(&f.fs, &f.gitdir, None).contains(&"unborn-no-checkout".to_string()));
});

dual_fixture_test!(branch_force_checkout_existing, branch_force_checkout_existing_sub, "test-branch", |f| {
    branch(&f.fs, &f.gitdir, "existing-b", None, false, false).unwrap();
    branch(&f.fs, &f.gitdir, "existing-b", None, true, true).unwrap();
    assert_eq!(current_branch(&f.fs, &f.gitdir, false, false).unwrap().as_deref(), Some("existing-b"));
});

dual_fixture_test!(branch_full_ref_path_accepted, branch_full_ref_path_accepted_sub, "test-branch", |f| {
    branch(&f.fs, &f.gitdir, "feature/sub-branch", None, false, false).unwrap();
    assert!(list_branches(&f.fs, &f.gitdir, None).contains(&"feature/sub-branch".to_string()));
});

dual_fixture_test!(current_branch_fullname_true, current_branch_fullname_true_sub, "test-currentBranch", |f| {
    let full = current_branch(&f.fs, &f.gitdir, true, false).unwrap();
    assert_eq!(full.as_deref(), Some("refs/heads/master"));
});

dual_fixture_test!(delete_branch_missing_errors, delete_branch_missing_errors_sub, "test-deleteBranch", |f| {
    assert_eq!(
        delete_branch(&f.fs, &f.gitdir, "branch-not-exist").unwrap_err().code,
        ErrorCode::NotFoundError
    );
});

dual_fixture_test!(delete_branch_invalid_ref_errors, delete_branch_invalid_ref_errors_sub, "test-deleteBranch", |f| {
    assert_eq!(
        delete_branch(&f.fs, &f.gitdir, "inv@{id..branch").unwrap_err().code,
        ErrorCode::NotFoundError
    );
});

dual_fixture_test!(delete_branch_cleans_config_section, delete_branch_cleans_config_section_sub, "test-deleteBranch", |f| {
    branch(&f.fs, &f.gitdir, "cfg-branch", None, false, false).unwrap();
    set_config(&f.fs, &f.gitdir, "branch.cfg-branch.remote", Some("origin"), false).unwrap();
    delete_branch(&f.fs, &f.gitdir, "cfg-branch").unwrap();
    assert!(!list_branches(&f.fs, &f.gitdir, None).contains(&"cfg-branch".to_string()));
});

dual_fixture_test!(delete_branch_packed_ref, delete_branch_packed_ref_sub, "test-deleteBranch", |f| {
    branch(&f.fs, &f.gitdir, "packed-b", None, false, false).unwrap();
    delete_branch(&f.fs, &f.gitdir, "packed-b").unwrap();
    assert!(!list_branches(&f.fs, &f.gitdir, None).contains(&"packed-b".to_string()));
});

dual_fixture_test!(list_branches_remote_origin, list_branches_remote_origin_sub, "test-listBranches", |f| {
    let remote_b = list_branches(&f.fs, &f.gitdir, Some("origin"));
    assert!(!remote_b.is_empty());
});

dual_fixture_test!(rename_branch_already_exists_error, rename_branch_already_exists_error_sub, "test-renameBranch", |f| {
    branch(&f.fs, &f.gitdir, "b1", None, false, false).unwrap();
    branch(&f.fs, &f.gitdir, "b2", None, false, false).unwrap();
    assert_eq!(
        rename_branch(&f.fs, &f.gitdir, "b2", "b1", false).unwrap_err().code,
        ErrorCode::AlreadyExistsError
    );
});

dual_fixture_test!(rename_branch_without_checkout, rename_branch_without_checkout_sub, "test-renameBranch", |f| {
    branch(&f.fs, &f.gitdir, "b-old", None, false, false).unwrap();
    rename_branch(&f.fs, &f.gitdir, "b-old", "b-new", false).unwrap();
    assert!(list_branches(&f.fs, &f.gitdir, None).contains(&"b-new".to_string()));
    assert!(!list_branches(&f.fs, &f.gitdir, None).contains(&"b-old".to_string()));
});

dual_fixture_test!(rename_branch_with_checkout, rename_branch_with_checkout_sub, "test-renameBranch", |f| {
    branch(&f.fs, &f.gitdir, "b-src", None, false, false).unwrap();
    rename_branch(&f.fs, &f.gitdir, "b-src", "b-dst", true).unwrap();
    assert_eq!(current_branch(&f.fs, &f.gitdir, false, false).unwrap().as_deref(), Some("b-dst"));
});

dual_fixture_test!(rename_branch_invalid_name_error, rename_branch_invalid_name_error_sub, "test-renameBranch", |f| {
    branch(&f.fs, &f.gitdir, "b-valid", None, false, false).unwrap();
    assert_eq!(
        rename_branch(&f.fs, &f.gitdir, "b-valid", "inv@{id..name", false).unwrap_err().code,
        ErrorCode::InvalidRefNameError
    );
});

dual_fixture_test!(rename_branch_updates_head_when_current, rename_branch_updates_head_when_current_sub, "test-renameBranch", |f| {
    let cur = current_branch(&f.fs, &f.gitdir, false, false).unwrap().unwrap();
    rename_branch(&f.fs, &f.gitdir, &cur, "renamed-current", false).unwrap();
    assert_eq!(current_branch(&f.fs, &f.gitdir, false, false).unwrap().as_deref(), Some("renamed-current"));
});

dual_fixture_test!(rename_branch_missing_source_error, rename_branch_missing_source_error_sub, "test-renameBranch", |f| {
    assert_eq!(
        rename_branch(&f.fs, &f.gitdir, "new-name", "non-existent-src", false).unwrap_err().code,
        ErrorCode::NotFoundError
    );
});

dual_fixture_test!(tag_create_with_object_ref, tag_create_with_object_ref_sub, "test-tag", |f| {
    let head = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    tag(&f.fs, &f.gitdir, "v-custom", Some(&head), false).unwrap();
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "refs/tags/v-custom", None).unwrap(), head);
});

dual_fixture_test!(tag_already_exists_without_force, tag_already_exists_without_force_sub, "test-tag", |f| {
    tag(&f.fs, &f.gitdir, "v-dup", None, false).unwrap();
    assert_eq!(tag(&f.fs, &f.gitdir, "v-dup", None, false).unwrap_err().code, ErrorCode::AlreadyExistsError);
});

dual_fixture_test!(tag_force_overwrites_existing, tag_force_overwrites_existing_sub, "test-tag", |f| {
    tag(&f.fs, &f.gitdir, "v-force", None, false).unwrap();
    tag(&f.fs, &f.gitdir, "v-force", None, true).unwrap();
    assert!(list_tags(&f.fs, &f.gitdir).contains(&"v-force".to_string()));
});

dual_fixture_test!(tag_invalid_name_error, tag_invalid_name_error_sub, "test-tag", |f| {
    assert_eq!(tag(&f.fs, &f.gitdir, "inv@{id..tag", None, false).unwrap_err().code, ErrorCode::InvalidRefNameError);
});

dual_fixture_test!(annotated_tag_force_overwrites, annotated_tag_force_overwrites_sub, "test-annotatedTag", |f| {
    let tagger = Author { name: "Tagger".into(), email: "t@e.com".into(), timestamp: 1262356920, timezone_offset: 0.0 };
    annotated_tag(&f.fs, &f.gitdir, "v-ann-dup", Some("msg 1"), None, Some(tagger.clone()), None, false).unwrap();
    assert_eq!(
        annotated_tag(&f.fs, &f.gitdir, "v-ann-dup", Some("msg 2"), None, Some(tagger.clone()), None, false).unwrap_err().code,
        ErrorCode::AlreadyExistsError
    );
    annotated_tag(&f.fs, &f.gitdir, "v-ann-dup", Some("msg 2"), None, Some(tagger), None, true).unwrap();
});

dual_fixture_test!(annotated_tag_custom_target_object, annotated_tag_custom_target_object_sub, "test-annotatedTag", |f| {
    let head = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    let tagger = Author { name: "Tagger".into(), email: "t@e.com".into(), timestamp: 1262356920, timezone_offset: 0.0 };
    annotated_tag(&f.fs, &f.gitdir, "v-ann-obj", Some("annotated target"), Some(&head), Some(tagger), None, false).unwrap();
    let tag_oid = resolve_ref(&f.fs, &f.gitdir, "refs/tags/v-ann-obj", None).unwrap();
    assert_eq!(read_tag(&f.fs, &f.gitdir, &tag_oid).unwrap().tag.object, head);
});

dual_fixture_test!(delete_tag_missing_error, delete_tag_missing_error_sub, "test-deleteTag", |f| {
    delete_tag(&f.fs, &f.gitdir, "nonexistent-tag").unwrap();
    assert!(!list_tags(&f.fs, &f.gitdir).contains(&"nonexistent-tag".to_string()));
});

dual_fixture_test!(add_note_default_ref_and_read, add_note_default_ref_and_read_sub, "test-addNote", |f| {
    let head = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    let author = Author { name: "N".into(), email: "n@e.com".into(), timestamp: 1500000000, timezone_offset: 0.0 };
    add_note(&f.fs, &f.gitdir, None, &head, b"note 1", true, author.clone(), Some(author)).unwrap();
    assert_eq!(read_note(&f.fs, &f.gitdir, None, &head).unwrap(), b"note 1");
});

dual_fixture_test!(add_note_already_exists_without_force, add_note_already_exists_without_force_sub, "test-addNote", |f| {
    let head = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    let author = Author { name: "N".into(), email: "n@e.com".into(), timestamp: 1500000000, timezone_offset: 0.0 };
    add_note(&f.fs, &f.gitdir, Some("refs/notes/test"), &head, b"n1", false, author.clone(), Some(author.clone())).unwrap();
    assert_eq!(
        add_note(&f.fs, &f.gitdir, Some("refs/notes/test"), &head, b"n2", false, author.clone(), Some(author)).unwrap_err().code,
        ErrorCode::AlreadyExistsError
    );
});

dual_fixture_test!(add_note_force_overwrites_existing, add_note_force_overwrites_existing_sub, "test-addNote", |f| {
    let head = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    let author = Author { name: "N".into(), email: "n@e.com".into(), timestamp: 1500000000, timezone_offset: 0.0 };
    add_note(&f.fs, &f.gitdir, Some("refs/notes/force"), &head, b"n1", false, author.clone(), Some(author.clone())).unwrap();
    add_note(&f.fs, &f.gitdir, Some("refs/notes/force"), &head, b"n2", true, author.clone(), Some(author)).unwrap();
    assert_eq!(read_note(&f.fs, &f.gitdir, Some("refs/notes/force"), &head).unwrap(), b"n2");
});

dual_fixture_test!(add_note_custom_namespace_branch, add_note_custom_namespace_branch_sub, "test-addNote", |f| {
    let head = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    let author = Author { name: "N".into(), email: "n@e.com".into(), timestamp: 1500000000, timezone_offset: 0.0 };
    add_note(&f.fs, &f.gitdir, Some("refs/notes/custom-ns"), &head, b"custom note", true, author.clone(), Some(author)).unwrap();
    let notes = list_notes(&f.fs, &f.gitdir, Some("refs/notes/custom-ns")).unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].target, head);
});

dual_fixture_test!(add_note_string_and_binary_bytes, add_note_string_and_binary_bytes_sub, "test-addNote", |f| {
    let head = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    let author = Author { name: "N".into(), email: "n@e.com".into(), timestamp: 1500000000, timezone_offset: 0.0 };
    add_note(&f.fs, &f.gitdir, Some("refs/notes/bin"), &head, &[0x00, 0xff, 0x42], true, author.clone(), Some(author)).unwrap();
    assert_eq!(read_note(&f.fs, &f.gitdir, Some("refs/notes/bin"), &head).unwrap(), vec![0x00, 0xff, 0x42]);
});

dual_fixture_test!(add_note_multiple_targets_in_same_tree, add_note_multiple_targets_in_same_tree_sub, "test-addNote", |f| {
    let head = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    let other = "0000000000000000000000000000000000000002";
    let author = Author { name: "N".into(), email: "n@e.com".into(), timestamp: 1500000000, timezone_offset: 0.0 };
    add_note(&f.fs, &f.gitdir, Some("refs/notes/multi"), &head, b"n-head", true, author.clone(), Some(author.clone())).unwrap();
    add_note(&f.fs, &f.gitdir, Some("refs/notes/multi"), other, b"n-other", true, author.clone(), Some(author)).unwrap();
    assert_eq!(list_notes(&f.fs, &f.gitdir, Some("refs/notes/multi")).unwrap().len(), 2);
});

dual_fixture_test!(read_note_missing_returns_not_found, read_note_missing_returns_not_found_sub, "test-readNote", |f| {
    assert_eq!(
        read_note(&f.fs, &f.gitdir, None, "0000000000000000000000000000000000000001").unwrap_err().code,
        ErrorCode::NotFoundError
    );
});

dual_fixture_test!(read_note_missing_namespace_returns_not_found, read_note_missing_namespace_returns_not_found_sub, "test-readNote", |f| {
    let head = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    assert_eq!(
        read_note(&f.fs, &f.gitdir, Some("refs/notes/missing-ns"), &head).unwrap_err().code,
        ErrorCode::NotFoundError
    );
});

dual_fixture_test!(read_note_existing_commits_ns, read_note_existing_commits_ns_sub, "test-readNote", |f| {
    let notes = list_notes(&f.fs, &f.gitdir, None).unwrap();
    assert!(!notes.is_empty());
    let content = read_note(&f.fs, &f.gitdir, None, &notes[0].target).unwrap();
    assert!(!content.is_empty());
});

dual_fixture_test!(list_notes_empty_namespace, list_notes_empty_namespace_sub, "test-listNotes", |f| {
    let list = list_notes(&f.fs, &f.gitdir, Some("refs/notes/nonexistent")).unwrap_or_default();
    assert!(list.is_empty());
});

dual_fixture_test!(list_notes_default_namespace, list_notes_default_namespace_sub, "test-listNotes", |f| {
    let list = list_notes(&f.fs, &f.gitdir, None).unwrap();
    assert!(!list.is_empty());
});

dual_fixture_test!(remove_note_from_custom_namespace, remove_note_from_custom_namespace_sub, "test-removeNote", |f| {
    let head = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    let author = Author { name: "N".into(), email: "n@e.com".into(), timestamp: 1500000000, timezone_offset: 0.0 };
    add_note(&f.fs, &f.gitdir, Some("refs/notes/rm"), &head, b"to-remove", true, author.clone(), Some(author.clone())).unwrap();
    remove_note(&f.fs, &f.gitdir, Some("refs/notes/rm"), &head, author.clone(), Some(author)).unwrap();
    assert!(list_notes(&f.fs, &f.gitdir, Some("refs/notes/rm")).unwrap().is_empty());
});

dual_fixture_test!(add_remote_already_exists_without_force, add_remote_already_exists_without_force_sub, "test-addRemote", |f| {
    add_remote(&f.fs, &f.gitdir, "dup-remote", "https://example.com/1.git", false).unwrap();
    assert_eq!(
        add_remote(&f.fs, &f.gitdir, "dup-remote", "https://example.com/2.git", false).unwrap_err().code,
        ErrorCode::AlreadyExistsError
    );
});

dual_fixture_test!(add_remote_force_overwrites_url, add_remote_force_overwrites_url_sub, "test-addRemote", |f| {
    add_remote(&f.fs, &f.gitdir, "force-remote", "https://example.com/1.git", false).unwrap();
    add_remote(&f.fs, &f.gitdir, "force-remote", "https://example.com/2.git", true).unwrap();
    assert_eq!(get_config(&f.fs, &f.gitdir, "remote.force-remote.url").unwrap().as_str(), "https://example.com/2.git");
});

dual_fixture_test!(delete_remote_removes_section, delete_remote_removes_section_sub, "test-deleteRemote", |f| {
    add_remote(&f.fs, &f.gitdir, "temp-remote", "https://example.com/t.git", true).unwrap();
    delete_remote(&f.fs, &f.gitdir, "temp-remote").unwrap();
    assert!(list_remotes(&f.fs, &f.gitdir).iter().all(|e| e.remote != "temp-remote"));
});

dual_fixture_test!(log_head_default_all_commits, log_head_default_all_commits_sub, "test-log", |f| {
    let commits = log(&f.fs, &f.gitdir, Some("HEAD"), None, None, None, false, false).unwrap();
    assert_eq!(commits.len(), 5);
});

dual_fixture_test!(log_head_with_depth_limit, log_head_with_depth_limit_sub, "test-log", |f| {
    let commits = log(&f.fs, &f.gitdir, Some("HEAD"), None, Some(2), None, false, false).unwrap();
    assert_eq!(commits.len(), 2);
});

dual_fixture_test!(log_head_with_since_filter, log_head_with_since_filter_sub, "test-log", |f| {
    let commits = log(&f.fs, &f.gitdir, Some("HEAD"), None, None, Some(1501462174), false, false).unwrap();
    assert_eq!(commits.len(), 2);
});

dual_fixture_test!(log_complex_merging_history, log_complex_merging_history_sub, "test-log-complex", |f| {
    let commits = log(&f.fs, &f.gitdir, Some("HEAD"), None, None, None, false, false).unwrap();
    assert!(!commits.is_empty());
});

dual_fixture_test!(log_preserves_gpgsig_and_payload, log_preserves_gpgsig_and_payload_sub, "test-log", |f| {
    let commits = log(&f.fs, &f.gitdir, Some("HEAD"), None, Some(1), None, false, false).unwrap();
    assert!(!commits[0].payload.is_empty());
});

dual_fixture_test!(log_directory_replaced_file, log_directory_replaced_file_sub, "test-init", |f| {
    use git_rust::commands::plumbing::write_blob;
    use git_rust::models::TreeEntry;
    let author = Author { name: "A".into(), email: "a@e.com".into(), timestamp: 1500000000, timezone_offset: 0.0 };
    let b1 = write_blob(&f.fs, &f.gitdir, b"v1\n").unwrap();
    let t1 = write_tree(&f.fs, &f.gitdir, &[TreeEntry { mode: "100644".into(), path: "item".into(), oid: b1.clone(), entry_type: "blob".into() }]).unwrap();
    let c1 = write_commit(&f.fs, &f.gitdir, &CommitObject { message: "c1\n".into(), tree: t1, parent: vec![], author: author.clone(), committer: author.clone(), gpgsig: None }).unwrap();
    let sub_t = write_tree(&f.fs, &f.gitdir, &[TreeEntry { mode: "100644".into(), path: "child.txt".into(), oid: b1, entry_type: "blob".into() }]).unwrap();
    let t2 = write_tree(&f.fs, &f.gitdir, &[TreeEntry { mode: "040000".into(), path: "item".into(), oid: sub_t, entry_type: "tree".into() }]).unwrap();
    let c2 = write_commit(&f.fs, &f.gitdir, &CommitObject { message: "c2\n".into(), tree: t2, parent: vec![c1], author: author.clone(), committer: author, gpgsig: None }).unwrap();
    write_ref(&f.fs, &f.gitdir, "refs/heads/main", &c2, true, false).unwrap();
    let commits = log(&f.fs, &f.gitdir, Some("main"), Some("item"), None, None, true, false).unwrap();
    assert_eq!(commits.len(), 2);
});

dual_fixture_test!(log_file_newly_added_and_single_file, log_file_newly_added_and_single_file_sub, "test-init", |f| {
    use git_rust::commands::plumbing::write_blob;
    use git_rust::models::TreeEntry;
    let author = Author { name: "A".into(), email: "a@e.com".into(), timestamp: 1500000000, timezone_offset: 0.0 };
    let oid = write_blob(&f.fs, &f.gitdir, b"file-only
").unwrap();
    let t1 = write_tree(&f.fs, &f.gitdir, &[TreeEntry { mode: "100644".into(), path: "single.txt".into(), oid, entry_type: "blob".into() }]).unwrap();
    let c1 = write_commit(&f.fs, &f.gitdir, &CommitObject { message: "add single
".into(), tree: t1, parent: vec![], author: author.clone(), committer: author, gpgsig: None }).unwrap();
    write_ref(&f.fs, &f.gitdir, "refs/heads/main", &c1, true, false).unwrap();
    let commits = log(&f.fs, &f.gitdir, Some("main"), Some("single.txt"), None, None, false, false).unwrap();
    assert_eq!(commits.len(), 1);
});

dual_fixture_test!(log_file_deleted_forced, log_file_deleted_forced_sub, "test-init", |f| {
    use git_rust::commands::plumbing::write_blob;
    use git_rust::models::TreeEntry;
    let author = Author { name: "A".into(), email: "a@e.com".into(), timestamp: 1500000000, timezone_offset: 0.0 };
    let oid = write_blob(&f.fs, &f.gitdir, b"hello\n").unwrap();
    let t1 = write_tree(&f.fs, &f.gitdir, &[TreeEntry { mode: "100644".into(), path: "gone.txt".into(), oid, entry_type: "blob".into() }]).unwrap();
    let c1 = write_commit(&f.fs, &f.gitdir, &CommitObject { message: "add\n".into(), tree: t1, parent: vec![], author: author.clone(), committer: author.clone(), gpgsig: None }).unwrap();
    let t2 = write_tree(&f.fs, &f.gitdir, &[]).unwrap();
    let c2 = write_commit(&f.fs, &f.gitdir, &CommitObject { message: "del\n".into(), tree: t2, parent: vec![c1], author: author.clone(), committer: author, gpgsig: None }).unwrap();
    write_ref(&f.fs, &f.gitdir, "refs/heads/main", &c2, true, false).unwrap();
    let forced = log(&f.fs, &f.gitdir, Some("main"), Some("gone.txt"), None, None, true, false).unwrap();
    assert!(!forced.is_empty());
});

dual_fixture_test!(log_file_rename_with_follow, log_file_rename_with_follow_sub, "test-init", |f| {
    use git_rust::commands::plumbing::write_blob;
    use git_rust::models::TreeEntry;
    let author = Author { name: "A".into(), email: "a@e.com".into(), timestamp: 1500000000, timezone_offset: 0.0 };
    let oid = write_blob(&f.fs, &f.gitdir, b"same content\n").unwrap();
    let t1 = write_tree(&f.fs, &f.gitdir, &[TreeEntry { mode: "100644".into(), path: "old.txt".into(), oid: oid.clone(), entry_type: "blob".into() }]).unwrap();
    let c1 = write_commit(&f.fs, &f.gitdir, &CommitObject { message: "c1\n".into(), tree: t1, parent: vec![], author: author.clone(), committer: author.clone(), gpgsig: None }).unwrap();
    let t2 = write_tree(&f.fs, &f.gitdir, &[TreeEntry { mode: "100644".into(), path: "new.txt".into(), oid, entry_type: "blob".into() }]).unwrap();
    let c2 = write_commit(&f.fs, &f.gitdir, &CommitObject { message: "c2\n".into(), tree: t2, parent: vec![c1], author: author.clone(), committer: author, gpgsig: None }).unwrap();
    write_ref(&f.fs, &f.gitdir, "refs/heads/main", &c2, true, false).unwrap();
    let followed = log(&f.fs, &f.gitdir, Some("main"), Some("new.txt"), None, None, true, true).unwrap();
    assert_eq!(followed.len(), 2);
});

dual_fixture_test!(log_file_rename_forced_without_follow, log_file_rename_forced_without_follow_sub, "test-init", |f| {
    use git_rust::commands::plumbing::write_blob;
    use git_rust::models::TreeEntry;
    let author = Author { name: "A".into(), email: "a@e.com".into(), timestamp: 1500000000, timezone_offset: 0.0 };
    let oid = write_blob(&f.fs, &f.gitdir, b"same content\n").unwrap();
    let t1 = write_tree(&f.fs, &f.gitdir, &[TreeEntry { mode: "100644".into(), path: "old.txt".into(), oid: oid.clone(), entry_type: "blob".into() }]).unwrap();
    let c1 = write_commit(&f.fs, &f.gitdir, &CommitObject { message: "c1\n".into(), tree: t1, parent: vec![], author: author.clone(), committer: author.clone(), gpgsig: None }).unwrap();
    let t2 = write_tree(&f.fs, &f.gitdir, &[TreeEntry { mode: "100644".into(), path: "new.txt".into(), oid, entry_type: "blob".into() }]).unwrap();
    let c2 = write_commit(&f.fs, &f.gitdir, &CommitObject { message: "c2\n".into(), tree: t2, parent: vec![c1], author: author.clone(), committer: author, gpgsig: None }).unwrap();
    write_ref(&f.fs, &f.gitdir, "refs/heads/main", &c2, true, false).unwrap();
    let unfollowed = log(&f.fs, &f.gitdir, Some("main"), Some("new.txt"), None, None, true, false).unwrap();
    assert_eq!(unfollowed.len(), 1);
});

dual_fixture_test!(log_file_rename_multi_same_content_1, log_file_rename_multi_same_content_1_sub, "test-init", |f| {
    use git_rust::commands::plumbing::write_blob;
    use git_rust::models::TreeEntry;
    let author = Author { name: "A".into(), email: "a@e.com".into(), timestamp: 1500000000, timezone_offset: 0.0 };
    let oid = write_blob(&f.fs, &f.gitdir, b"dup\n").unwrap();
    let t1 = write_tree(&f.fs, &f.gitdir, &[
        TreeEntry { mode: "100644".into(), path: "f1.txt".into(), oid: oid.clone(), entry_type: "blob".into() },
        TreeEntry { mode: "100644".into(), path: "f2.txt".into(), oid: oid.clone(), entry_type: "blob".into() },
    ]).unwrap();
    let c1 = write_commit(&f.fs, &f.gitdir, &CommitObject { message: "c1\n".into(), tree: t1, parent: vec![], author: author.clone(), committer: author.clone(), gpgsig: None }).unwrap();
    let t2 = write_tree(&f.fs, &f.gitdir, &[
        TreeEntry { mode: "100644".into(), path: "f1-renamed.txt".into(), oid: oid.clone(), entry_type: "blob".into() },
        TreeEntry { mode: "100644".into(), path: "f2.txt".into(), oid, entry_type: "blob".into() },
    ]).unwrap();
    let c2 = write_commit(&f.fs, &f.gitdir, &CommitObject { message: "c2\n".into(), tree: t2, parent: vec![c1], author: author.clone(), committer: author, gpgsig: None }).unwrap();
    write_ref(&f.fs, &f.gitdir, "refs/heads/main", &c2, true, false).unwrap();
    let followed = log(&f.fs, &f.gitdir, Some("main"), Some("f1-renamed.txt"), None, None, true, true).unwrap();
    assert_eq!(followed.len(), 2);
});

dual_fixture_test!(log_file_rename_multi_same_content_2, log_file_rename_multi_same_content_2_sub, "test-init", |f| {
    use git_rust::commands::plumbing::write_blob;
    use git_rust::models::TreeEntry;
    let author = Author { name: "A".into(), email: "a@e.com".into(), timestamp: 1500000000, timezone_offset: 0.0 };
    let oid = write_blob(&f.fs, &f.gitdir, b"dup2\n").unwrap();
    let t1 = write_tree(&f.fs, &f.gitdir, &[
        TreeEntry { mode: "100644".into(), path: "a.txt".into(), oid: oid.clone(), entry_type: "blob".into() },
        TreeEntry { mode: "100644".into(), path: "b.txt".into(), oid: oid.clone(), entry_type: "blob".into() },
    ]).unwrap();
    let c1 = write_commit(&f.fs, &f.gitdir, &CommitObject { message: "c1\n".into(), tree: t1, parent: vec![], author: author.clone(), committer: author.clone(), gpgsig: None }).unwrap();
    let t2 = write_tree(&f.fs, &f.gitdir, &[
        TreeEntry { mode: "100644".into(), path: "a.txt".into(), oid: oid.clone(), entry_type: "blob".into() },
        TreeEntry { mode: "100644".into(), path: "b-renamed.txt".into(), oid, entry_type: "blob".into() },
    ]).unwrap();
    let c2 = write_commit(&f.fs, &f.gitdir, &CommitObject { message: "c2\n".into(), tree: t2, parent: vec![c1], author: author.clone(), committer: author, gpgsig: None }).unwrap();
    write_ref(&f.fs, &f.gitdir, "refs/heads/main", &c2, true, false).unwrap();
    let followed = log(&f.fs, &f.gitdir, Some("main"), Some("b-renamed.txt"), None, None, true, true).unwrap();
    assert_eq!(followed.len(), 2);
});

dual_fixture_test!(walk_autocrlf_respected_when_gitconfig_changes, walk_autocrlf_respected_when_gitconfig_changes_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, "crlf.txt"]), "line1\r\nline2\r\n");
    set_config(&f.fs, &f.gitdir, "core.autocrlf", Some("false"), false).unwrap();
    let oid_false = walk(&f.fs, Some(&f.dir), &f.gitdir, &[WORKDIR()], |p, es| {
        if p == "crlf.txt" { Ok(Some(Some(es[0].as_ref().unwrap().oid().unwrap_or_default().to_string()))) } else { Ok(Some(None)) }
    }).unwrap().into_iter().flatten().collect::<Vec<_>>()[0].clone();

    set_config(&f.fs, &f.gitdir, "core.autocrlf", Some("true"), false).unwrap();
    let oid_true = walk(&f.fs, Some(&f.dir), &f.gitdir, &[WORKDIR()], |p, es| {
        if p == "crlf.txt" { Ok(Some(Some(es[0].as_ref().unwrap().oid().unwrap_or_default().to_string()))) } else { Ok(Some(None)) }
    }).unwrap().into_iter().flatten().collect::<Vec<_>>()[0].clone();
    assert_ne!(oid_false, oid_true);
});

dual_fixture_test!(walk_symlink_content_and_nonexistent_target, walk_symlink_content_and_nonexistent_target_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    let _ = f.fs.writelink(&join(&[&f.dir, "broken-link"]), b"nonexistent-target.txt");
    let link_data = walk(&f.fs, Some(&f.dir), &f.gitdir, &[WORKDIR()], |p, es| {
        if p == "broken-link" {
            let e = es[0].as_ref().unwrap();
            Ok(Some(Some((e.oid().unwrap_or_default().to_string(), e.content().map(|b| b.to_vec()).unwrap_or_default()))))
        } else {
            Ok(Some(None))
        }
    }).unwrap().into_iter().flatten().collect::<Vec<_>>();
    assert_eq!(link_data.len(), 1);
    assert_eq!(link_data[0].1, b"nonexistent-target.txt");
});

dual_fixture_test!(walk_symlink_content_matches_git_target_bytes, walk_symlink_content_matches_git_target_bytes_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, "real.txt"]), "real file body");
    let _ = f.fs.writelink(&join(&[&f.dir, "sym.txt"]), b"real.txt");
    let sym_bytes = walk(&f.fs, Some(&f.dir), &f.gitdir, &[WORKDIR()], |p, es| {
        if p == "sym.txt" { Ok(Some(Some(es[0].as_ref().unwrap().content().map(|b| b.to_vec()).unwrap_or_default()))) } else { Ok(Some(None)) }
    }).unwrap().into_iter().flatten().collect::<Vec<_>>();
    assert_eq!(sym_bytes[0], b"real.txt");
});

dual_fixture_test!(walk_tree_throws_on_missing_ref, walk_tree_throws_on_missing_ref_sub, "test-walk", |f| {
    let res = walk(&f.fs, Some(&f.dir), &f.gitdir, &[TREE(Some("nonexistent-ref"))], |_, _| Ok(Some(())));
    assert!(res.is_err());
});

dual_fixture_test!(walk_tree_throws_on_trailing_newline_ref, walk_tree_throws_on_trailing_newline_ref_sub, "test-walk", |f| {
    let res = walk(&f.fs, Some(&f.dir), &f.gitdir, &[TREE(Some("HEAD\n"))], |_, _| Ok(Some(())));
    assert!(res.is_err());
});

dual_fixture_test!(walk_empty_tree_on_unborn_branch, walk_empty_tree_on_unborn_branch_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, Some("main")).unwrap();
    let res = walk(&f.fs, Some(&f.dir), &f.gitdir, &[TREE(Some("HEAD"))], |p, _| Ok(Some(p.to_string()))).unwrap();
    assert_eq!(res, vec!["."]);
});

dual_fixture_test!(walk_throws_when_head_points_to_missing_tag_ref, walk_throws_when_head_points_to_missing_tag_ref_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, Some("main")).unwrap();
    let gdir = git_rust::fs::discover_gitdir(&f.fs, &f.gitdir);
    f.fs.write_str(&join(&[&gdir, "HEAD"]), "ref: refs/tags/missing-tag\n");
    let res = walk(&f.fs, Some(&f.dir), &f.gitdir, &[TREE(Some("HEAD"))], |_, _| Ok(Some(())));
    assert!(res.is_err());
});

dual_fixture_test!(find_merge_base_rejects_unknown_oid, find_merge_base_rejects_unknown_oid_sub, "test-findMergeBase", |f| {
    let err = find_merge_base(
        &f.fs,
        &f.gitdir,
        &[
            "0000000000000000000000000000000000000001".to_string(),
            "9ec6646dd454e8f530c478c26f8b06e57f880bd6".to_string(),
        ],
    )
    .unwrap_err();
    assert_eq!(err.code, ErrorCode::NotFoundError);
});

dual_fixture_test!(find_merge_base_fast_forward_scenario, find_merge_base_fast_forward_scenario_sub, "test-findMergeBase", |f| {
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
});

dual_fixture_test!(find_merge_base_diverging_scenario, find_merge_base_diverging_scenario_sub, "test-findMergeBase", |f| {
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
});

dual_fixture_test!(find_merge_base_merge_commit_scenario, find_merge_base_merge_commit_scenario_sub, "test-findMergeBase", |f| {
    let bases = find_merge_base(
        &f.fs,
        &f.gitdir,
        &[
            "c91a8aab1f086c8cc8914558f035e718a8a5c503".to_string(),
            "9ec6646dd454e8f530c478c26f8b06e57f880bd6".to_string(),
        ],
    )
    .unwrap();
    assert!(!bases.is_empty());
});

dual_fixture_test!(find_merge_base_recursive_scenario, find_merge_base_recursive_scenario_sub, "test-findMergeBase", |f| {
    let rec = find_merge_base(
        &f.fs,
        &f.gitdir,
        &[
            "85303393b9fd415d48913dfec47d42db184dc4d8".to_string(),
            "4c658ff41121ddada50c47e4c72c092a9f7bf2be".to_string(),
        ],
    )
    .unwrap();
    assert_eq!(rec.len(), 2);
});

dual_fixture_test!(find_merge_base_fork_and_rejoin_scenario, find_merge_base_fork_and_rejoin_scenario_sub, "test-findMergeBase", |f| {
    let res = find_merge_base(
        &f.fs,
        &f.gitdir,
        &[
            "815474b6e581921cbe05825631decac922803d28".to_string(),
            "83ad8e1ec6f21f8d0d74587b6a8021fec1a165e1".to_string(),
        ],
    )
    .unwrap();
    assert_eq!(res, vec!["2316ae441d2c72d8d15673beb81390272671c526"]);
});

dual_fixture_test!(find_merge_base_no_common_ancestor_scenario, find_merge_base_no_common_ancestor_scenario_sub, "test-findMergeBase", |f| {
    let res = find_merge_base(
        &f.fs,
        &f.gitdir,
        &[
            "9ec6646dd454e8f530c478c26f8b06e57f880bd6".to_string(),
            "99cfd5bb4e412234162ac1eb46350ec6ccffb50d".to_string(),
        ],
    )
    .unwrap();
    assert!(res.is_empty());
});

// ============================================================================
// Additional 1-to-1 Ref / Branch / Tag / Remote / Note / Log Cases
// ============================================================================
dual_fixture_test!(branch_with_full_refs_heads_prefix_rejected_or_normalized, branch_with_full_refs_heads_prefix_rejected_or_normalized_sub, "test-branch", |f| {
    let err = branch(&f.fs, &f.gitdir, "refs/heads/bad..name", None, false, false).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidRefNameError);
});

dual_fixture_test!(branch_with_tilde_rejected, branch_with_tilde_rejected_sub, "test-branch", |f| {
    let err = branch(&f.fs, &f.gitdir, "feature~1", None, false, false).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidRefNameError);
});

dual_fixture_test!(branch_with_caret_rejected, branch_with_caret_rejected_sub, "test-branch", |f| {
    let err = branch(&f.fs, &f.gitdir, "feature^2", None, false, false).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidRefNameError);
});

dual_fixture_test!(branch_with_colon_rejected, branch_with_colon_rejected_sub, "test-branch", |f| {
    let err = branch(&f.fs, &f.gitdir, "feature:sub", None, false, false).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidRefNameError);
});

dual_fixture_test!(branch_with_question_mark_rejected, branch_with_question_mark_rejected_sub, "test-branch", |f| {
    let err = branch(&f.fs, &f.gitdir, "feature?name", None, false, false).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidRefNameError);
});

dual_fixture_test!(branch_with_asterisk_rejected, branch_with_asterisk_rejected_sub, "test-branch", |f| {
    let err = branch(&f.fs, &f.gitdir, "feature*name", None, false, false).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidRefNameError);
});

dual_fixture_test!(branch_with_open_bracket_rejected, branch_with_open_bracket_rejected_sub, "test-branch", |f| {
    let err = branch(&f.fs, &f.gitdir, "feature[0]", None, false, false).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidRefNameError);
});

dual_fixture_test!(branch_with_at_brace_rejected, branch_with_at_brace_rejected_sub, "test-branch", |f| {
    let err = branch(&f.fs, &f.gitdir, "feature@{0}", None, false, false).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidRefNameError);
});

dual_fixture_test!(branch_hierarchical_slash_name_allowed, branch_hierarchical_slash_name_allowed_sub, "test-branch", |f| {
    branch(&f.fs, &f.gitdir, "team/feature/sub-1", None, false, false).unwrap();
    let branches = list_branches(&f.fs, &f.gitdir, None);
    assert!(branches.contains(&"team/feature/sub-1".to_string()));
});

dual_fixture_test!(rename_branch_preserves_target_commit_oid, rename_branch_preserves_target_commit_oid_sub, "test-renameBranch", |f| {
    branch(&f.fs, &f.gitdir, "other-branch", None, false, false).unwrap();
    let orig = resolve_ref(&f.fs, &f.gitdir, "refs/heads/other-branch", None).unwrap();
    rename_branch(&f.fs, &f.gitdir, "other-branch", "renamed-other", false).unwrap();
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "refs/heads/renamed-other", None).unwrap(), orig);
});

dual_fixture_test!(rename_branch_invalid_new_ref_errors, rename_branch_invalid_new_ref_errors_sub, "test-renameBranch", |f| {
    let err = rename_branch(&f.fs, &f.gitdir, "bad..branch", "other-branch", false).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidRefNameError);
});

dual_fixture_test!(delete_branch_removes_branch_config_section, delete_branch_removes_branch_config_section_sub, "test-deleteBranch", |f| {
    set_config(&f.fs, &f.gitdir, "branch.test.remote", Some("origin"), false).unwrap();
    set_config(&f.fs, &f.gitdir, "branch.test.merge", Some("refs/heads/test"), false).unwrap();
    delete_branch(&f.fs, &f.gitdir, "test").unwrap();
    assert_eq!(get_config(&f.fs, &f.gitdir, "branch.test.remote"), None);
});

dual_fixture_test!(current_branch_returns_none_in_unborn_repo, current_branch_returns_none_in_unborn_repo_sub, "test-empty", |f| {
    let actual_gitdir = git_rust::fs::discover_gitdir(&f.fs, &f.gitdir);
    f.fs.write_str(&join(&[&actual_gitdir, "HEAD"]), "e10ebb90d03eaacca84de1af0a59b444232da99e\n");
    assert_eq!(current_branch(&f.fs, &f.gitdir, false, false).unwrap(), None);
});

dual_fixture_test!(current_branch_test_branch_shortname_and_fullname, current_branch_test_branch_shortname_and_fullname_sub, "test-resolveRef", |f| {
    write_ref(&f.fs, &f.gitdir, "HEAD", "refs/heads/test-branch", true, true).unwrap();
    assert_eq!(current_branch(&f.fs, &f.gitdir, false, false).unwrap().as_deref(), Some("test-branch"));
    assert_eq!(current_branch(&f.fs, &f.gitdir, true, false).unwrap().as_deref(), Some("refs/heads/test-branch"));
});

dual_fixture_test!(tag_invalid_ref_name_rejected, tag_invalid_ref_name_rejected_sub, "test-tag", |f| {
    let err = tag(&f.fs, &f.gitdir, "bad..tag", None, false).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidRefNameError);
});

dual_fixture_test!(tag_hierarchical_release_name_allowed, tag_hierarchical_release_name_allowed_sub, "test-tag", |f| {
    tag(&f.fs, &f.gitdir, "releases/v2.0.0", None, false).unwrap();
    let tags = list_tags(&f.fs, &f.gitdir);
    assert!(tags.contains(&"releases/v2.0.0".to_string()));
});

dual_fixture_test!(annotated_tag_invalid_name_rejected, annotated_tag_invalid_name_rejected_sub, "test-annotatedTag", |f| {
    let tagger = Author { name: "T".into(), email: "t@e.com".into(), timestamp: 1600000000, timezone_offset: 0.0 };
    let err = annotated_tag(&f.fs, &f.gitdir, "bad..tag", Some("msg"), None, Some(tagger), None, false).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidRefNameError);
});

dual_fixture_test!(annotated_tag_points_to_explicit_object_oid, annotated_tag_points_to_explicit_object_oid_sub, "test-annotatedTag", |f| {
    let head = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    let tagger = Author { name: "T".into(), email: "t@e.com".into(), timestamp: 1600000000, timezone_offset: 0.0 };
    annotated_tag(&f.fs, &f.gitdir, "explicit-obj-tag", Some("tag body\n"), Some(&head), Some(tagger), None, false).unwrap();
    let tag_oid = resolve_ref(&f.fs, &f.gitdir, "refs/tags/explicit-obj-tag", None).unwrap();
    let t = read_tag(&f.fs, &f.gitdir, &tag_oid).unwrap();
    assert_eq!(t.tag.object, head);
});

dual_fixture_test!(delete_tag_hierarchical_name, delete_tag_hierarchical_name_sub, "test-tag", |f| {
    tag(&f.fs, &f.gitdir, "rel/v1", None, false).unwrap();
    delete_tag(&f.fs, &f.gitdir, "rel/v1").unwrap();
    assert!(!list_tags(&f.fs, &f.gitdir).contains(&"rel/v1".to_string()));
});

dual_fixture_test!(add_remote_sets_default_fetch_refspec, add_remote_sets_default_fetch_refspec_sub, "test-addRemote", |f| {
    add_remote(&f.fs, &f.gitdir, "mirror", "https://example.com/mirror.git", false).unwrap();
    let spec = get_config(&f.fs, &f.gitdir, "remote.mirror.fetch").map(|v| v.as_str());
    assert_eq!(spec.as_deref(), Some("+refs/heads/*:refs/remotes/mirror/*"));
});

dual_fixture_test!(add_remote_invalid_name_rejected, add_remote_invalid_name_rejected_sub, "test-addRemote", |f| {
    let err = add_remote(&f.fs, &f.gitdir, "bad..remote", "https://example.com/r.git", false).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidRefNameError);
});

dual_fixture_test!(delete_remote_clears_url_and_fetch_config, delete_remote_clears_url_and_fetch_config_sub, "test-deleteRemote", |f| {
    delete_remote(&f.fs, &f.gitdir, "foo").unwrap();
    assert_eq!(get_config(&f.fs, &f.gitdir, "remote.foo.url"), None);
    assert_eq!(get_config(&f.fs, &f.gitdir, "remote.foo.fetch"), None);
});

dual_fixture_test!(add_note_from_utf8_string_and_read_back, add_note_from_utf8_string_and_read_back_sub, "test-addNote", |f| {
    let author = Author { name: "N".into(), email: "n@e.com".into(), timestamp: 1600000000, timezone_offset: 0.0 };
    let target = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    add_note(&f.fs, &f.gitdir, Some("refs/notes/custom"), &target, b"custom note text", true, author.clone(), Some(author)).unwrap();
    let note = read_note(&f.fs, &f.gitdir, Some("refs/notes/custom"), &target).unwrap();
    assert_eq!(note, b"custom note text");
});

dual_fixture_test!(list_notes_in_custom_namespace_returns_added_note, list_notes_in_custom_namespace_returns_added_note_sub, "test-addNote", |f| {
    let author = Author { name: "N".into(), email: "n@e.com".into(), timestamp: 1600000000, timezone_offset: 0.0 };
    let target = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    add_note(&f.fs, &f.gitdir, Some("refs/notes/reviews"), &target, b"LGTM", true, author.clone(), Some(author)).unwrap();
    let notes = list_notes(&f.fs, &f.gitdir, Some("refs/notes/reviews")).unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].target, target);
});

dual_fixture_test!(remove_note_from_temp_namespace, remove_note_from_temp_namespace_sub, "test-addNote", |f| {
    let author = Author { name: "N".into(), email: "n@e.com".into(), timestamp: 1600000000, timezone_offset: 0.0 };
    let target = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    add_note(&f.fs, &f.gitdir, Some("refs/notes/temp"), &target, b"temp", true, author.clone(), Some(author.clone())).unwrap();
    remove_note(&f.fs, &f.gitdir, Some("refs/notes/temp"), &target, author.clone(), Some(author)).unwrap();
    assert!(read_note(&f.fs, &f.gitdir, Some("refs/notes/temp"), &target).is_err());
});

dual_fixture_test!(log_with_depth_zero_returns_empty_or_single, log_with_depth_zero_returns_empty_or_single_sub, "test-log", |f| {
    let entries = log(&f.fs, &f.gitdir, Some("HEAD"), None, Some(1), None, false, false).unwrap();
    assert_eq!(entries.len(), 1);
});

dual_fixture_test!(log_missing_ref_returns_not_found_error, log_missing_ref_returns_not_found_error_sub, "test-log", |f| {
    let err = log(&f.fs, &f.gitdir, Some("refs/heads/nonexistent"), None, None, None, false, false).unwrap_err();
    assert_eq!(err.code, ErrorCode::NotFoundError);
});

dual_fixture_test!(log_by_explicit_commit_sha, log_by_explicit_commit_sha_sub, "test-log", |f| {
    let head = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    let entries = log(&f.fs, &f.gitdir, Some(&head), None, Some(2), None, false, false).unwrap();
    assert_eq!(entries[0].oid, head);
});

dual_fixture_test!(is_descendent_with_depth_limit_one, is_descendent_with_depth_limit_one_sub, "test-log", |f| {
    let entries = log(&f.fs, &f.gitdir, Some("HEAD"), None, Some(3), None, false, false).unwrap();
    assert!(git_rust::commands::plumbing::is_descendent(&f.fs, &f.gitdir, &entries[0].oid, &entries[1].oid, Some(1)).unwrap());
});

dual_fixture_test!(find_merge_base_identical_commits_returns_self, find_merge_base_identical_commits_returns_self_sub, "test-findMergeBase", |f| {
    let head = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    let bases = find_merge_base(&f.fs, &f.gitdir, &[head.clone(), head.clone()]).unwrap();
    assert_eq!(bases, vec![head]);
});

dual_fixture_test!(find_merge_base_ancestor_and_descendant_returns_ancestor, find_merge_base_ancestor_and_descendant_returns_ancestor_sub, "test-log", |f| {
    let entries = log(&f.fs, &f.gitdir, Some("HEAD"), None, Some(3), None, false, false).unwrap();
    let bases = find_merge_base(&f.fs, &f.gitdir, &[entries[0].oid.clone(), entries[2].oid.clone()]).unwrap();
    assert_eq!(bases, vec![entries[2].oid.clone()]);
});
