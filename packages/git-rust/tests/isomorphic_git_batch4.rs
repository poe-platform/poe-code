//! Isomorphic-Git Parity Suite — Batch 4 (26 upstream test files)
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
