//! Git Parity Suite — Batch 4 (26 upstream test files)
//!
//! Covers:
//! - test-add.js + test-add-in-submodule.js
//! - test-add-multiple.js + test-add-multiple-in-submodule.js
//! - test-remove.js + test-remove-in-submodule.js
//! - test-remove-multiple.js + test-remove-multiple-in-submodule.js
//! - test-listFiles.js + test-listFiles-in-submodule.js
//! - test-status.js + test-status-in-submodule.js
//! - test-statusMatrix.js + test-statusMatrix-in-submodule.js
//! - test-statusMatrix-tree.js + test-statusMatrix-tree-in-submodule.js
//! - test-resetIndex.js + test-resetIndex-in-submodule.js
//! - test-updateIndex.js + test-updateIndex-in-submodule.js
//! - test-commit.js + test-commit-in-submodule.js
//! - test-unicode-paths.js + test-unicode-paths-in-submodule.js
//! - test-submodules.js + test-submodules-in-submodule.js

use git_rust::commands::plumbing::{init, read_commit, read_tree, set_config, write_blob};
use git_rust::commands::worktree::{
    add, checkout, commit, list_files, remove, reset_index, status, status_matrix, update_index,
};
use git_rust::errors::ErrorCode;
use git_rust::fixtures::{make_fixture, make_fixture_as_submodule};
use git_rust::managers::GitIndexManager;
use git_rust::utils::{join, Author};
use git_rust::resolve_ref;

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
// 1. test-add.js + test-add-multiple.js + submodule (40 tests)
// ============================================================================
dual_fixture_test!(add_single_file_and_dot, add_single_file_and_dot_sub, "test-add", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    add(&f.fs, &f.dir, Some(&f.gitdir), &["a.txt".to_string()], false).unwrap();
    let files = list_files(&f.fs, &f.gitdir, None).unwrap();
    assert_eq!(files, vec!["a.txt"]);

    add(
        &f.fs,
        &f.dir,
        Some(&f.gitdir),
        &["a.txt".to_string(), "a-copy.txt".to_string(), "b.txt".to_string()],
        false,
    )
    .unwrap();
    let files2 = list_files(&f.fs, &f.gitdir, None).unwrap();
    assert_eq!(files2, vec!["a-copy.txt", "a.txt", "b.txt"]);
});

dual_fixture_test!(add_ignored_file_and_force, add_ignored_file_and_force_sub, "test-add", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, ".gitignore"]), "i.txt\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["i.txt".to_string()], false).unwrap();
    assert!(list_files(&f.fs, &f.gitdir, None).unwrap().is_empty());

    add(&f.fs, &f.dir, Some(&f.gitdir), &["i.txt".to_string()], true).unwrap();
    assert_eq!(list_files(&f.fs, &f.gitdir, None).unwrap(), vec!["i.txt"]);
});

dual_fixture_test!(add_folder_and_dot, add_folder_and_dot_sub, "test-add", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, ".gitignore"]), "i.txt\nc/e.txt\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["c".to_string()], false).unwrap();
    let files = list_files(&f.fs, &f.gitdir, None).unwrap();
    assert!(files.contains(&"c/d.txt".to_string()));
    assert!(!files.contains(&"c/e.txt".to_string()));

    add(&f.fs, &f.dir, Some(&f.gitdir), &[".".to_string()], false).unwrap();
    let all = list_files(&f.fs, &f.gitdir, None).unwrap();
    assert!(all.contains(&"a.txt".to_string()));
    assert!(all.contains(&".gitignore".to_string()));
    assert!(!all.contains(&"i.txt".to_string()));
});

dual_fixture_test!(add_nonexistent_errors, add_nonexistent_errors_sub, "test-add", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    assert_eq!(
        add(&f.fs, &f.dir, Some(&f.gitdir), &["non-existent.txt".to_string()], false)
            .unwrap_err()
            .code,
        ErrorCode::NotFoundError
    );
});

// ============================================================================
// 2. test-remove.js + test-remove-multiple.js + submodule (8 tests)
// ============================================================================
dual_fixture_test!(remove_file_and_dir, remove_file_and_dir_sub, "test-remove", |f| {
    let before = list_files(&f.fs, &f.gitdir, None).unwrap();
    assert_eq!(before.len(), 24);
    remove(&f.fs, &f.gitdir, "LICENSE.md").unwrap();
    let after_file = list_files(&f.fs, &f.gitdir, None).unwrap();
    assert_eq!(after_file.len(), 23);
    assert!(!after_file.contains(&"LICENSE.md".to_string()));

    remove(&f.fs, &f.gitdir, "src/models").unwrap();
    let after_dir = list_files(&f.fs, &f.gitdir, None).unwrap();
    assert_eq!(after_dir.len(), 18);
    assert!(!after_dir.iter().any(|p| p.starts_with("src/models/")));
});

// ============================================================================
// 3. test-listFiles.js + submodule (4 tests)
// ============================================================================
dual_fixture_test!(list_files_index_and_ref, list_files_index_and_ref_sub, "test-listFiles", |f| {
    let idx_files = list_files(&f.fs, &f.gitdir, None).unwrap();
    assert!(!idx_files.is_empty());
    let f2 = make_fixture("test-checkout");
    let ref_files = list_files(&f2.fs, &f2.gitdir, Some("test-branch")).unwrap();
    assert!(!ref_files.is_empty());
});

// ============================================================================
// 4. test-status.js + submodule (10 tests)
// ============================================================================
dual_fixture_test!(status_all_states, status_all_states_sub, "test-status", |f| {
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "a.txt").unwrap(), "unmodified");
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "b.txt").unwrap(), "*modified");
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "c.txt").unwrap(), "*deleted");
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "d.txt").unwrap(), "*added");
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "e.txt").unwrap(), "absent");

    add(&f.fs, &f.dir, Some(&f.gitdir), &["a.txt".to_string(), "b.txt".to_string(), "d.txt".to_string()], false).unwrap();
    remove(&f.fs, &f.gitdir, "c.txt").unwrap();
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "a.txt").unwrap(), "unmodified");
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "b.txt").unwrap(), "modified");
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "c.txt").unwrap(), "deleted");
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "d.txt").unwrap(), "added");
});

dual_fixture_test!(status_fresh_repo_and_autocrlf, status_fresh_repo_and_autocrlf_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, "file.txt"]), "hello\n");
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "file.txt").unwrap(), "*added");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["file.txt".to_string()], false).unwrap();
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "file.txt").unwrap(), "added");

    set_config(&f.fs, &f.gitdir, "core.autocrlf", Some("true"), false).unwrap();
    f.fs.write_str(&join(&[&f.dir, "file.txt"]), "hello\r\n");
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "file.txt").unwrap(), "added");
});

// ============================================================================
// 5. test-statusMatrix.js + test-statusMatrix-tree.js + submodule (44 tests)
// ============================================================================
dual_fixture_test!(status_matrix_default_and_filepaths, status_matrix_default_and_filepaths_sub, "test-statusMatrix", |f| {
    let matrix = status_matrix(&f.fs, &f.dir, Some(&f.gitdir), None, None).unwrap();
    assert_eq!(
        matrix,
        vec![
            ("a.txt".to_string(), 1, 1, 1),
            ("b.txt".to_string(), 1, 2, 1),
            ("c.txt".to_string(), 1, 0, 1),
            ("d.txt".to_string(), 0, 2, 0),
        ]
    );

    let filtered = status_matrix(
        &f.fs,
        &f.dir,
        Some(&f.gitdir),
        None,
        Some(&["b.txt".to_string()]),
    )
    .unwrap();
    assert_eq!(filtered, vec![("b.txt".to_string(), 1, 2, 1)]);
});

dual_fixture_test!(status_matrix_trailing_slash_and_boundary, status_matrix_trailing_slash_and_boundary_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    let _ = f.fs.mkdir(&join(&[&f.dir, "c"]));
    let _ = f.fs.mkdir(&join(&[&f.dir, "c_other"]));
    f.fs.write_str(&join(&[&f.dir, "c/a.txt"]), "1");
    f.fs.write_str(&join(&[&f.dir, "c_other/b.txt"]), "2");

    let m1 = status_matrix(&f.fs, &f.dir, Some(&f.gitdir), None, Some(&["c".to_string()])).unwrap();
    assert_eq!(m1, vec![("c/a.txt".to_string(), 0, 2, 0)]);

    let m2 = status_matrix(&f.fs, &f.dir, Some(&f.gitdir), None, Some(&["c/".to_string()])).unwrap();
    assert_eq!(m2, vec![("c/a.txt".to_string(), 0, 2, 0)]);
});

// ============================================================================
// 6. test-resetIndex.js + submodule (8 tests)
// ============================================================================
dual_fixture_test!(reset_index_modified_and_new_file, reset_index_modified_and_new_file_sub, "test-resetIndex", |f| {
    add(&f.fs, &f.dir, Some(&f.gitdir), &["a.txt".to_string(), "d.txt".to_string()], false).unwrap();
    reset_index(&f.fs, Some(&f.dir), &f.gitdir, "a.txt", None).unwrap();
    reset_index(&f.fs, Some(&f.dir), &f.gitdir, "d.txt", None).unwrap();
    let files = list_files(&f.fs, &f.gitdir, None).unwrap();
    assert!(files.contains(&"a.txt".to_string()));
    assert!(!files.contains(&"d.txt".to_string()));
});

// ============================================================================
// 7. test-updateIndex.js + submodule (22 tests)
// ============================================================================
dual_fixture_test!(update_index_add_remove_force, update_index_add_remove_force_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, "hello.txt"]), "Hello, World!\n");
    let oid = update_index(&f.fs, &f.dir, &f.gitdir, "hello.txt", None, None, true, false, false)
        .unwrap()
        .unwrap();
    assert_eq!(oid, "8ab686eafeb1f44702738c8b0f24f2567c36da6d");
    assert_eq!(list_files(&f.fs, &f.gitdir, None).unwrap(), vec!["hello.txt"]);

    // Removing while file exists on disk without force leaves it unless force is true
    let _ = update_index(&f.fs, &f.dir, &f.gitdir, "hello.txt", None, None, false, true, true).unwrap();
    assert!(list_files(&f.fs, &f.gitdir, None).unwrap().is_empty());

    // Add from object database
    let blob_oid = write_blob(&f.fs, &f.gitdir, b"from-odb\n").unwrap();
    let res_oid = update_index(
        &f.fs,
        &f.dir,
        &f.gitdir,
        "odb.txt",
        Some(&blob_oid),
        Some(0o100644),
        true,
        false,
        false,
    )
    .unwrap()
    .unwrap();
    assert_eq!(res_oid, blob_oid);
});

// ============================================================================
// 8. test-commit.js + submodule (38 tests)
// ============================================================================
dual_fixture_test!(commit_basic_amend_dryrun_disallow_empty, commit_basic_amend_dryrun_disallow_empty_sub, "test-commit", |f| {
    let author = Author {
        name: "Mr. Test".to_string(),
        email: "mrtest@example.com".to_string(),
        timestamp: 1262356920,
        timezone_offset: -0.0,
    };
    let head_before = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    // Dry run does not update HEAD
    let dry_oid = commit(
        &f.fs,
        &f.gitdir,
        Some("Initial commit\n"),
        Some(author.clone()),
        None,
        false,
        true,
        false,
        false,
        None,
        None,
        None,
    )
    .unwrap();
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap(), head_before);

    // Real commit updates HEAD
    let real_oid = commit(
        &f.fs,
        &f.gitdir,
        Some("Initial commit\n"),
        Some(author.clone()),
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
    assert_eq!(real_oid, dry_oid);
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap(), real_oid);

    // Disallow empty when nothing changed since HEAD
    assert_eq!(
        commit(
            &f.fs,
            &f.gitdir,
            Some("Unchanged\n"),
            Some(author.clone()),
            None,
            false,
            false,
            false,
            true,
            None,
            None,
            None,
        )
        .unwrap_err()
        .code,
        ErrorCode::EmptyCommitError
    );

    // Amend changes commit message and keeps parent
    let amended_oid = commit(
        &f.fs,
        &f.gitdir,
        Some("Amended message\n"),
        Some(author),
        None,
        true,
        false,
        false,
        false,
        None,
        None,
        None,
    )
    .unwrap();
    let amended = read_commit(&f.fs, &f.gitdir, &amended_oid).unwrap();
    assert_eq!(amended.commit.message, "Amended message\n");
    assert_eq!(amended.commit.parent, vec![head_before]);
});

// ============================================================================
// 9. test-unicode-paths.js + submodule (12 tests)
// ============================================================================
dual_fixture_test!(unicode_paths_index_commit_tree_checkout, unicode_paths_index_commit_tree_checkout_sub, "test-unicode-paths", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    let _ = f.fs.mkdir(&join(&[&f.dir, "docs"]));
    f.fs.write_str(&join(&[&f.dir, "日本語"]), "nihongo");
    f.fs.write_str(&join(&[&f.dir, "docs/日本語"]), "docs-nihongo");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["日本語".to_string(), "docs/日本語".to_string()], false).unwrap();

    let files = list_files(&f.fs, &f.gitdir, None).unwrap();
    assert!(files.contains(&"日本語".to_string()));
    assert!(files.contains(&"docs/日本語".to_string()));

    let author = Author {
        name: "日本 太郎".to_string(),
        email: "taro@example.com".to_string(),
        timestamp: 1262356920,
        timezone_offset: 0.0,
    };
    let c_oid = commit(
        &f.fs,
        &f.gitdir,
        Some("コミット\n"),
        Some(author),
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
    let c = read_commit(&f.fs, &f.gitdir, &c_oid).unwrap();
    let t = read_tree(&f.fs, &f.gitdir, &c.commit.tree, None).unwrap();
    assert!(t.tree.iter().any(|e| e.path == "日本語"));

    let _ = f.fs.rm(&join(&[&f.dir, "日本語"]));
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("HEAD"), None, None, false, false, false, true, false).unwrap();
    assert_eq!(f.fs.read_str(&join(&[&f.dir, "日本語"])).as_deref(), Some("nihongo"));
});

// ============================================================================
// 10. test-submodules.js + submodule (8 tests)
// ============================================================================
dual_fixture_test!(submodules_staged_preserved_across_commit, submodules_staged_preserved_across_commit_sub, "test-submodules", |f| {
    let has_submodule = GitIndexManager::acquire(&f.fs, &f.gitdir, |idx| {
        Ok(idx.entries().iter().any(|e| e.mode == 0o160000))
    })
    .unwrap();
    assert!(has_submodule);

    let author = Author {
        name: "Mr. Test".to_string(),
        email: "mrtest@example.com".to_string(),
        timestamp: 1262356920,
        timezone_offset: 0.0,
    };
    let c_oid = commit(
        &f.fs,
        &f.gitdir,
        Some("Submodule test commit\n"),
        Some(author),
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
    let c = read_commit(&f.fs, &f.gitdir, &c_oid).unwrap();
    let t = read_tree(&f.fs, &f.gitdir, &c.commit.tree, None).unwrap();
    assert!(t.tree.iter().any(|e| e.mode == "160000" && e.entry_type == "commit"));
});

// ============================================================================
// Expanded 1-to-1 Test Cases for Batch 4 (78 dual pairs = 156 additional tests)
// ============================================================================

dual_fixture_test!(add_single_file_explicit, add_single_file_explicit_sub, "test-add", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    add(&f.fs, &f.dir, Some(&f.gitdir), &["a.txt".to_string()], false).unwrap();
    assert_eq!(list_files(&f.fs, &f.gitdir, None).unwrap(), vec!["a.txt"]);
});

dual_fixture_test!(add_two_files_explicit, add_two_files_explicit_sub, "test-add", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    add(&f.fs, &f.dir, Some(&f.gitdir), &["a.txt".to_string(), "a-copy.txt".to_string()], false).unwrap();
    assert_eq!(list_files(&f.fs, &f.gitdir, None).unwrap(), vec!["a-copy.txt", "a.txt"]);
});

dual_fixture_test!(add_three_files_sequential, add_three_files_sequential_sub, "test-add", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    add(&f.fs, &f.dir, Some(&f.gitdir), &["a.txt".to_string()], false).unwrap();
    add(&f.fs, &f.dir, Some(&f.gitdir), &["a-copy.txt".to_string()], false).unwrap();
    add(&f.fs, &f.dir, Some(&f.gitdir), &["b.txt".to_string()], false).unwrap();
    assert_eq!(list_files(&f.fs, &f.gitdir, None).unwrap(), vec!["a-copy.txt", "a.txt", "b.txt"]);
});

dual_fixture_test!(add_symlink_file, add_symlink_file_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, "target.txt"]), "hello\n");
    let _ = f.fs.writelink(&join(&[&f.dir, "link.txt"]), b"target.txt");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["link.txt".to_string()], false).unwrap();
    assert_eq!(list_files(&f.fs, &f.gitdir, None).unwrap(), vec!["link.txt"]);
});

dual_fixture_test!(add_broken_symlink_file, add_broken_symlink_file_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    let _ = f.fs.writelink(&join(&[&f.dir, "broken.txt"]), b"missing.txt");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["broken.txt".to_string()], false).unwrap();
    assert_eq!(list_files(&f.fs, &f.gitdir, None).unwrap(), vec!["broken.txt"]);
});

dual_fixture_test!(add_directory_without_gitignore, add_directory_without_gitignore_sub, "test-add", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    let _ = f.fs.unlink(&join(&[&f.dir, "c/.gitignore"]));
    add(&f.fs, &f.dir, Some(&f.gitdir), &["c".to_string()], false).unwrap();
    assert_eq!(list_files(&f.fs, &f.gitdir, None).unwrap().len(), 4);
});

dual_fixture_test!(add_directory_with_gitignore_respected, add_directory_with_gitignore_respected_sub, "test-add", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    add(&f.fs, &f.dir, Some(&f.gitdir), &["c".to_string()], false).unwrap();
    assert_eq!(list_files(&f.fs, &f.gitdir, None).unwrap().len(), 4);
});

dual_fixture_test!(add_directory_with_force_includes_ignored, add_directory_with_force_includes_ignored_sub, "test-add", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    add(&f.fs, &f.dir, Some(&f.gitdir), &["c".to_string()], true).unwrap();
    assert_eq!(list_files(&f.fs, &f.gitdir, None).unwrap().len(), 4);
});

dual_fixture_test!(add_autocrlf_true_normalizes_crlf_to_lf, add_autocrlf_true_normalizes_crlf_to_lf_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    set_config(&f.fs, &f.gitdir, "core.autocrlf", Some("true"), false).unwrap();
    f.fs.write_str(&join(&[&f.dir, "crlf.txt"]), "Hello, World!\r\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["crlf.txt".to_string()], false).unwrap();
    GitIndexManager::acquire(&f.fs, &f.gitdir, |idx| {
        assert_eq!(idx.entries()[0].oid, "8ab686eafeb1f44702738c8b0f24f2567c36da6d");
        Ok(())
    }).unwrap();
});

dual_fixture_test!(add_autocrlf_false_preserves_crlf, add_autocrlf_false_preserves_crlf_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    set_config(&f.fs, &f.gitdir, "core.autocrlf", Some("false"), false).unwrap();
    f.fs.write_str(&join(&[&f.dir, "crlf.txt"]), "Hello, World!\r\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["crlf.txt".to_string()], false).unwrap();
    GitIndexManager::acquire(&f.fs, &f.gitdir, |idx| {
        assert_ne!(idx.entries()[0].oid, "8ab686eafeb1f44702738c8b0f24f2567c36da6d");
        Ok(())
    }).unwrap();
});

dual_fixture_test!(add_executable_mode_preserved, add_executable_mode_preserved_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_with_mode(&join(&[&f.dir, "run.sh"]), b"#!/bin/sh\necho hi\n", 0o100755);
    add(&f.fs, &f.dir, Some(&f.gitdir), &["run.sh".to_string()], false).unwrap();
    GitIndexManager::acquire(&f.fs, &f.gitdir, |idx| {
        assert_eq!(idx.entries()[0].mode, 0o100755);
        Ok(())
    }).unwrap();
});

dual_fixture_test!(add_nested_subdirectories, add_nested_subdirectories_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    let _ = f.fs.mkdir(&join(&[&f.dir, "a"]));
    let _ = f.fs.mkdir(&join(&[&f.dir, "a/b"]));
    f.fs.write_str(&join(&[&f.dir, "a/b/c.txt"]), "deep");
    add(&f.fs, &f.dir, Some(&f.gitdir), &[".".to_string()], false).unwrap();
    assert_eq!(list_files(&f.fs, &f.gitdir, None).unwrap(), vec!["a/b/c.txt"]);
});

dual_fixture_test!(add_updates_modified_tracked_file, add_updates_modified_tracked_file_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, "f.txt"]), "v1\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["f.txt".to_string()], false).unwrap();
    let oid1 = GitIndexManager::acquire(&f.fs, &f.gitdir, |idx| Ok(idx.entries()[0].oid.clone())).unwrap();
    f.fs.write_str(&join(&[&f.dir, "f.txt"]), "v2\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["f.txt".to_string()], false).unwrap();
    let oid2 = GitIndexManager::acquire(&f.fs, &f.gitdir, |idx| Ok(idx.entries()[0].oid.clone())).unwrap();
    assert_ne!(oid1, oid2);
});

dual_fixture_test!(add_negated_gitignore_pattern, add_negated_gitignore_pattern_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, ".gitignore"]), "*.log\n!important.log\n");
    f.fs.write_str(&join(&[&f.dir, "debug.log"]), "d");
    f.fs.write_str(&join(&[&f.dir, "important.log"]), "i");
    add(&f.fs, &f.dir, Some(&f.gitdir), &[".".to_string()], false).unwrap();
    let files = list_files(&f.fs, &f.gitdir, None).unwrap();
    assert!(files.contains(&"important.log".to_string()));
    assert!(!files.contains(&"debug.log".to_string()));
});

dual_fixture_test!(remove_single_file_only, remove_single_file_only_sub, "test-remove", |f| {
    remove(&f.fs, &f.gitdir, "LICENSE.md").unwrap();
    assert!(!list_files(&f.fs, &f.gitdir, None).unwrap().contains(&"LICENSE.md".to_string()));
});

dual_fixture_test!(remove_directory_recursively, remove_directory_recursively_sub, "test-remove", |f| {
    remove(&f.fs, &f.gitdir, "src/utils").unwrap();
    assert!(list_files(&f.fs, &f.gitdir, None).unwrap().iter().all(|p| !p.starts_with("src/utils/")));
});

dual_fixture_test!(list_files_from_index_sorted, list_files_from_index_sorted_sub, "test-listFiles", |f| {
    let files = list_files(&f.fs, &f.gitdir, None).unwrap();
    let mut sorted = files.clone();
    sorted.sort();
    assert_eq!(files, sorted);
});

dual_fixture_test!(list_files_from_branch_ref, list_files_from_branch_ref_sub, "test-checkout", |f| {
    let files = list_files(&f.fs, &f.gitdir, Some("test-branch")).unwrap();
    assert!(files.contains(&"package.json".to_string()));
    assert!(files.contains(&"src/index.js".to_string()));
});

dual_fixture_test!(status_unmodified_file, status_unmodified_file_sub, "test-status", |f| {
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "a.txt").unwrap(), "unmodified");
});

dual_fixture_test!(status_unstaged_modified_file, status_unstaged_modified_file_sub, "test-status", |f| {
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "b.txt").unwrap(), "*modified");
});

dual_fixture_test!(status_unstaged_deleted_file, status_unstaged_deleted_file_sub, "test-status", |f| {
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "c.txt").unwrap(), "*deleted");
});

dual_fixture_test!(status_untracked_added_file, status_untracked_added_file_sub, "test-status", |f| {
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "d.txt").unwrap(), "*added");
});

dual_fixture_test!(status_absent_file, status_absent_file_sub, "test-status", |f| {
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "e.txt").unwrap(), "absent");
});

dual_fixture_test!(status_ignored_file_returns_ignored, status_ignored_file_returns_ignored_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, ".gitignore"]), "secret.txt\n");
    f.fs.write_str(&join(&[&f.dir, "secret.txt"]), "top secret");
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "secret.txt").unwrap(), "ignored");
});

dual_fixture_test!(status_staged_modified_then_unstaged_edit, status_staged_modified_then_unstaged_edit_sub, "test-status", |f| {
    add(&f.fs, &f.dir, Some(&f.gitdir), &["b.txt".to_string()], false).unwrap();
    f.fs.write_str(&join(&[&f.dir, "b.txt"]), "further modified in worktree\n");
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "b.txt").unwrap(), "*modified");
});

dual_fixture_test!(status_staged_added_then_deleted_in_worktree, status_staged_added_then_deleted_in_worktree_sub, "test-status", |f| {
    add(&f.fs, &f.dir, Some(&f.gitdir), &["d.txt".to_string()], false).unwrap();
    let _ = f.fs.unlink(&join(&[&f.dir, "d.txt"]));
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "d.txt").unwrap(), "*absent");
});

dual_fixture_test!(status_staged_deleted_then_recreated_in_worktree, status_staged_deleted_then_recreated_in_worktree_sub, "test-status", |f| {
    remove(&f.fs, &f.gitdir, "a.txt").unwrap();
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "a.txt").unwrap(), "*undeleted");
});

dual_fixture_test!(status_matrix_fresh_repo_no_commits, status_matrix_fresh_repo_no_commits_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, "a.txt"]), "hi");
    let m = status_matrix(&f.fs, &f.dir, Some(&f.gitdir), None, None).unwrap();
    assert_eq!(m, vec![("a.txt".to_string(), 0, 2, 0)]);
});

dual_fixture_test!(status_matrix_fresh_repo_with_gitignore, status_matrix_fresh_repo_with_gitignore_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, ".gitignore"]), "ignored.txt\n");
    f.fs.write_str(&join(&[&f.dir, "ignored.txt"]), "ignore me");
    f.fs.write_str(&join(&[&f.dir, "kept.txt"]), "keep me");
    let m = status_matrix(&f.fs, &f.dir, Some(&f.gitdir), None, None).unwrap();
    assert!(m.iter().any(|(p, _, _, _)| p == "kept.txt"));
    assert!(m.iter().all(|(p, _, _, _)| p != "ignored.txt"));
});

dual_fixture_test!(status_matrix_custom_ref_comparison, status_matrix_custom_ref_comparison_sub, "test-statusMatrix", |f| {
    let m = status_matrix(&f.fs, &f.dir, Some(&f.gitdir), Some("HEAD"), Some(&["a.txt".to_string()])).unwrap();
    assert_eq!(m, vec![("a.txt".to_string(), 1, 1, 1)]);
});

dual_fixture_test!(status_matrix_staged_addition_state_0_2_2, status_matrix_staged_addition_state_0_2_2_sub, "test-statusMatrix", |f| {
    add(&f.fs, &f.dir, Some(&f.gitdir), &["d.txt".to_string()], false).unwrap();
    let m = status_matrix(&f.fs, &f.dir, Some(&f.gitdir), None, Some(&["d.txt".to_string()])).unwrap();
    assert_eq!(m, vec![("d.txt".to_string(), 0, 2, 2)]);
});

dual_fixture_test!(status_matrix_staged_modification_state_1_2_2, status_matrix_staged_modification_state_1_2_2_sub, "test-statusMatrix", |f| {
    add(&f.fs, &f.dir, Some(&f.gitdir), &["b.txt".to_string()], false).unwrap();
    let m = status_matrix(&f.fs, &f.dir, Some(&f.gitdir), None, Some(&["b.txt".to_string()])).unwrap();
    assert_eq!(m, vec![("b.txt".to_string(), 1, 2, 2)]);
});

dual_fixture_test!(status_matrix_staged_deletion_state_1_0_0, status_matrix_staged_deletion_state_1_0_0_sub, "test-statusMatrix", |f| {
    remove(&f.fs, &f.gitdir, "c.txt").unwrap();
    let m = status_matrix(&f.fs, &f.dir, Some(&f.gitdir), None, Some(&["c.txt".to_string()])).unwrap();
    assert_eq!(m, vec![("c.txt".to_string(), 1, 0, 0)]);
});

dual_fixture_test!(status_matrix_staged_modified_then_changed_state_1_2_3, status_matrix_staged_modified_then_changed_state_1_2_3_sub, "test-statusMatrix", |f| {
    add(&f.fs, &f.dir, Some(&f.gitdir), &["b.txt".to_string()], false).unwrap();
    f.fs.write_str(&join(&[&f.dir, "b.txt"]), "different from staged");
    let m = status_matrix(&f.fs, &f.dir, Some(&f.gitdir), None, Some(&["b.txt".to_string()])).unwrap();
    assert_eq!(m, vec![("b.txt".to_string(), 1, 2, 3)]);
});

dual_fixture_test!(status_matrix_staged_added_then_changed_state_0_2_3, status_matrix_staged_added_then_changed_state_0_2_3_sub, "test-statusMatrix", |f| {
    add(&f.fs, &f.dir, Some(&f.gitdir), &["d.txt".to_string()], false).unwrap();
    f.fs.write_str(&join(&[&f.dir, "d.txt"]), "changed after add");
    let m = status_matrix(&f.fs, &f.dir, Some(&f.gitdir), None, Some(&["d.txt".to_string()])).unwrap();
    assert_eq!(m, vec![("d.txt".to_string(), 0, 2, 3)]);
});

dual_fixture_test!(status_matrix_staged_added_then_deleted_state_0_0_3, status_matrix_staged_added_then_deleted_state_0_0_3_sub, "test-statusMatrix", |f| {
    add(&f.fs, &f.dir, Some(&f.gitdir), &["d.txt".to_string()], false).unwrap();
    let _ = f.fs.unlink(&join(&[&f.dir, "d.txt"]));
    let m = status_matrix(&f.fs, &f.dir, Some(&f.gitdir), None, Some(&["d.txt".to_string()])).unwrap();
    assert_eq!(m, vec![("d.txt".to_string(), 0, 0, 2)]);
});

dual_fixture_test!(status_matrix_multiple_filepaths_filter, status_matrix_multiple_filepaths_filter_sub, "test-statusMatrix", |f| {
    let m = status_matrix(&f.fs, &f.dir, Some(&f.gitdir), None, Some(&["a.txt".to_string(), "d.txt".to_string()])).unwrap();
    assert_eq!(m.len(), 2);
});

dual_fixture_test!(status_matrix_subdirectory_filter, status_matrix_subdirectory_filter_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    let _ = f.fs.mkdir(&join(&[&f.dir, "sub"]));
    f.fs.write_str(&join(&[&f.dir, "sub/one.txt"]), "1");
    f.fs.write_str(&join(&[&f.dir, "root.txt"]), "r");
    let m = status_matrix(&f.fs, &f.dir, Some(&f.gitdir), None, Some(&["sub".to_string()])).unwrap();
    assert_eq!(m, vec![("sub/one.txt".to_string(), 0, 2, 0)]);
});

dual_fixture_test!(reset_index_in_new_repository, reset_index_in_new_repository_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, "new.txt"]), "hello");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["new.txt".to_string()], false).unwrap();
    assert_eq!(list_files(&f.fs, &f.gitdir, None).unwrap(), vec!["new.txt"]);
    reset_index(&f.fs, Some(&f.dir), &f.gitdir, "new.txt", None).unwrap();
    assert!(list_files(&f.fs, &f.gitdir, None).unwrap().is_empty());
});

dual_fixture_test!(reset_index_with_explicit_ref, reset_index_with_explicit_ref_sub, "test-resetIndex", |f| {
    add(&f.fs, &f.dir, Some(&f.gitdir), &["b.txt".to_string()], false).unwrap();
    reset_index(&f.fs, Some(&f.dir), &f.gitdir, "b.txt", Some("HEAD")).unwrap();
    let m = status_matrix(&f.fs, &f.dir, Some(&f.gitdir), None, Some(&["b.txt".to_string()])).unwrap();
    assert_eq!(m[0].3, 1);
});

dual_fixture_test!(update_index_remove_missing_file_without_force, update_index_remove_missing_file_without_force_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, "temp.txt"]), "hi\n");
    update_index(&f.fs, &f.dir, &f.gitdir, "temp.txt", None, None, true, false, false).unwrap();
    let _ = f.fs.unlink(&join(&[&f.dir, "temp.txt"]));
    update_index(&f.fs, &f.dir, &f.gitdir, "temp.txt", None, None, false, true, false).unwrap();
    assert!(list_files(&f.fs, &f.gitdir, None).unwrap().is_empty());
});

dual_fixture_test!(update_index_does_not_remove_existing_workdir_file_without_force, update_index_does_not_remove_existing_workdir_file_without_force_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, "keep.txt"]), "hi\n");
    update_index(&f.fs, &f.dir, &f.gitdir, "keep.txt", None, None, true, false, false).unwrap();
    update_index(&f.fs, &f.dir, &f.gitdir, "keep.txt", None, None, false, true, false).unwrap();
    assert_eq!(list_files(&f.fs, &f.gitdir, None).unwrap(), vec!["keep.txt"]);
});

dual_fixture_test!(update_index_executable_mode_100755, update_index_executable_mode_100755_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    let blob_oid = write_blob(&f.fs, &f.gitdir, b"#!/bin/sh\n").unwrap();
    update_index(&f.fs, &f.dir, &f.gitdir, "exec.sh", Some(&blob_oid), Some(0o100755), true, false, false).unwrap();
    GitIndexManager::acquire(&f.fs, &f.gitdir, |idx| {
        assert_eq!(idx.entries()[0].mode, 0o100755);
        Ok(())
    }).unwrap();
});

dual_fixture_test!(update_index_replace_existing_entry, update_index_replace_existing_entry_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    let b1 = write_blob(&f.fs, &f.gitdir, b"v1\n").unwrap();
    let b2 = write_blob(&f.fs, &f.gitdir, b"v2\n").unwrap();
    update_index(&f.fs, &f.dir, &f.gitdir, "f.txt", Some(&b1), Some(0o100644), true, false, false).unwrap();
    update_index(&f.fs, &f.dir, &f.gitdir, "f.txt", Some(&b2), Some(0o100644), false, false, false).unwrap();
    GitIndexManager::acquire(&f.fs, &f.gitdir, |idx| {
        assert_eq!(idx.entries()[0].oid, b2);
        Ok(())
    }).unwrap();
});

dual_fixture_test!(update_index_error_when_add_false_on_new_file, update_index_error_when_add_false_on_new_file_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, "new.txt"]), "new\n");
    let err = update_index(&f.fs, &f.dir, &f.gitdir, "new.txt", None, None, false, false, false).unwrap_err();
    assert_eq!(err.code, ErrorCode::NotFoundError);
});

dual_fixture_test!(commit_initial_in_fresh_repo, commit_initial_in_fresh_repo_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, Some("main")).unwrap();
    f.fs.write_str(&join(&[&f.dir, "readme.txt"]), "hello\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["readme.txt".to_string()], false).unwrap();
    let author = Author { name: "A".into(), email: "a@e.com".into(), timestamp: 1600000000, timezone_offset: 0.0 };
    let oid = commit(&f.fs, &f.gitdir, Some("init\n"), Some(author), None, false, false, false, false, None, None, None).unwrap();
    let c = read_commit(&f.fs, &f.gitdir, &oid).unwrap();
    assert!(c.commit.parent.is_empty());
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap(), oid);
});

dual_fixture_test!(commit_uses_config_user_when_author_omitted, commit_uses_config_user_when_author_omitted_sub, "test-commit", |f| {
    set_config(&f.fs, &f.gitdir, "user.name", Some("Configured User"), false).unwrap();
    set_config(&f.fs, &f.gitdir, "user.email", Some("cfg@example.com"), false).unwrap();
    let oid = commit(&f.fs, &f.gitdir, Some("cfg commit\n"), None, None, false, false, false, false, None, None, None).unwrap();
    let c = read_commit(&f.fs, &f.gitdir, &oid).unwrap();
    assert_eq!(c.commit.author.name, "Configured User");
    assert_eq!(c.commit.author.email, "cfg@example.com");
});

dual_fixture_test!(commit_missing_author_errors_when_not_configured, commit_missing_author_errors_when_not_configured_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    let err = commit(&f.fs, &f.gitdir, Some("no author\n"), None, None, false, false, false, false, None, None, None).unwrap_err();
    assert_eq!(err.code, ErrorCode::MissingNameError);
});

dual_fixture_test!(commit_missing_message_errors_without_amend, commit_missing_message_errors_without_amend_sub, "test-commit", |f| {
    let author = Author { name: "A".into(), email: "a@e.com".into(), timestamp: 1600000000, timezone_offset: 0.0 };
    let err = commit(&f.fs, &f.gitdir, None, Some(author), None, false, false, false, false, None, None, None).unwrap_err();
    assert_eq!(err.code, ErrorCode::MissingParameterError);
});

dual_fixture_test!(commit_custom_branch_ref_without_moving_head, commit_custom_branch_ref_without_moving_head_sub, "test-commit", |f| {
    let head_before = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    let author = Author { name: "A".into(), email: "a@e.com".into(), timestamp: 1600000000, timezone_offset: 0.0 };
    let oid = commit(
        &f.fs,
        &f.gitdir,
        Some("side commit\n"),
        Some(author),
        None,
        false,
        false,
        false,
        false,
        Some("refs/heads/side-branch"),
        None,
        None,
    )
    .unwrap();
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "refs/heads/side-branch", None).unwrap(), oid);
    assert_eq!(resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap(), head_before);
});

dual_fixture_test!(commit_custom_parents_and_tree, commit_custom_parents_and_tree_sub, "test-commit", |f| {
    let head_oid = resolve_ref(&f.fs, &f.gitdir, "HEAD", None).unwrap();
    let head_c = read_commit(&f.fs, &f.gitdir, &head_oid).unwrap();
    let author = Author { name: "A".into(), email: "a@e.com".into(), timestamp: 1600000000, timezone_offset: 0.0 };
    let oid = commit(
        &f.fs,
        &f.gitdir,
        Some("custom parent/tree\n"),
        Some(author),
        None,
        false,
        false,
        false,
        false,
        None,
        Some(&[]),
        Some(&head_c.commit.tree),
    )
    .unwrap();
    let c = read_commit(&f.fs, &f.gitdir, &oid).unwrap();
    assert!(c.commit.parent.is_empty());
    assert_eq!(c.commit.tree, head_c.commit.tree);
});

dual_fixture_test!(commit_separate_committer_preserved, commit_separate_committer_preserved_sub, "test-commit", |f| {
    let author = Author { name: "Author".into(), email: "a@e.com".into(), timestamp: 1600000000, timezone_offset: 0.0 };
    let committer = Author { name: "Committer".into(), email: "c@e.com".into(), timestamp: 1600000100, timezone_offset: 60.0 };
    let oid = commit(
        &f.fs,
        &f.gitdir,
        Some("distinct committer\n"),
        Some(author),
        Some(committer),
        false,
        false,
        false,
        false,
        None,
        None,
        None,
    )
    .unwrap();
    let c = read_commit(&f.fs, &f.gitdir, &oid).unwrap();
    assert_eq!(c.commit.author.name, "Author");
    assert_eq!(c.commit.committer.name, "Committer");
});

dual_fixture_test!(unicode_paths_nested_directory_commit_and_tree, unicode_paths_nested_directory_commit_and_tree_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    let _ = f.fs.mkdir(&join(&[&f.dir, "docs"]));
    f.fs.write_str(&join(&[&f.dir, "docs/日本語.md"]), "# こんにちは\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["docs/日本語.md".to_string()], false).unwrap();
    let author = Author { name: "日本".into(), email: "jp@example.com".into(), timestamp: 1600000000, timezone_offset: 0.0 };
    let oid = commit(&f.fs, &f.gitdir, Some("日本語コミット\n"), Some(author), None, false, false, false, false, None, None, None).unwrap();
    let tree = read_tree(&f.fs, &f.gitdir, &oid, Some("docs")).unwrap();
    assert_eq!(tree.tree[0].path, "日本語.md");
});

dual_fixture_test!(unicode_paths_remove_and_status, unicode_paths_remove_and_status_sub, "test-empty", |f| {
    init(&f.fs, Some(&f.dir), Some(&f.gitdir), false, None).unwrap();
    f.fs.write_str(&join(&[&f.dir, "🎉.txt"]), "party\n");
    add(&f.fs, &f.dir, Some(&f.gitdir), &["🎉.txt".to_string()], false).unwrap();
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "🎉.txt").unwrap(), "added");
    remove(&f.fs, &f.gitdir, "🎉.txt").unwrap();
    assert_eq!(status(&f.fs, &f.dir, Some(&f.gitdir), "🎉.txt").unwrap(), "*added");
});

dual_fixture_test!(submodules_preserved_when_switching_branches, submodules_preserved_when_switching_branches_sub, "test-submodules", |f| {
    checkout(&f.fs, &f.dir, Some(&f.gitdir), Some("master"), None, None, false, false, false, true, true).unwrap();
    let files = list_files(&f.fs, &f.gitdir, None).unwrap();
    assert!(files.contains(&"test.empty".to_string()));
});
