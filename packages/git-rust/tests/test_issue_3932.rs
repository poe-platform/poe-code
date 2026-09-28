use git_rust::{CliResult, MemoryFs, execute_git_cli};
fn run(fs: &MemoryFs, args: &[&str]) -> CliResult {
    execute_git_cli(fs, "/repo", args)
}
fn ok(fs: &MemoryFs, args: &[&str]) -> String {
    let r = run(fs, args);
    assert_eq!(r.exit_code, 0, "{args:?}: {}", r.stderr);
    r.stdout
}
fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    ok(&fs, &["init", "-b", "main"]);
    fs
}
fn commit(fs: &MemoryFs, text: &str, message: &str) -> String {
    fs.write_str("/repo/file", text);
    ok(fs, &["add", "file"]);
    ok(fs, &["commit", "-m", message]);
    ok(fs, &["rev-parse", "HEAD"]).trim().to_string()
}
#[test]
fn tree_roundtrip_preserves_nested_paths_and_modes() {
    let fs = repo();
    fs.write_str("/repo/README", "root\n");
    fs.write_with_mode("/repo/src/nested/tool", b"run\n", 0o100755);
    fs.symlink("nested/tool", "/repo/src/link").unwrap();
    ok(&fs, &["add", "."]);
    let tree = ok(&fs, &["write-tree"]);
    let listing = ok(&fs, &["ls-tree", "-r", tree.trim()]);
    assert!(listing.contains("src/nested/tool"));
    assert!(listing.contains("src/link"));
    ok(&fs, &["commit", "-m", "nested"]);
    for target in [tree.trim(), "HEAD"] {
        ok(&fs, &["read-tree", target]);
        assert_eq!(ok(&fs, &["write-tree"]), tree);
    }
}
#[test]
fn revert_preserves_later_changes() {
    let fs = repo();
    commit(&fs, "first\nkeep\nlast\n", "base");
    let target = commit(&fs, "FIRST\nkeep\nlast\n", "change first");
    commit(&fs, "FIRST\nkeep\nLAST\n", "change last");
    ok(&fs, &["revert", &target]);
    assert_eq!(fs.read_str("/repo/file").unwrap(), "first\nkeep\nLAST\n");
}
#[test]
fn revert_conflict_does_not_destroy_head_or_worktree() {
    let fs = repo();
    commit(&fs, "base\n", "base");
    let target = commit(&fs, "target\n", "target");
    let head = commit(&fs, "later\n", "later");
    assert_ne!(run(&fs, &["revert", &target]).exit_code, 0);
    assert_eq!(ok(&fs, &["rev-parse", "HEAD"]).trim(), head);
    assert_eq!(fs.read_str("/repo/file").unwrap(), "later\n");
}
#[test]
fn revert_removes_added_files_and_restores_deleted_files() {
    let fs = repo();
    commit(&fs, "base\n", "base");
    fs.write_str("/repo/new", "new\n");
    ok(&fs, &["add", "new"]);
    ok(&fs, &["commit", "-m", "add"]);
    ok(&fs, &["revert", "HEAD"]);
    assert!(!fs.exists("/repo/new"));
    fs.unlink("/repo/file").unwrap();
    ok(&fs, &["add", "-A"]);
    ok(&fs, &["commit", "-m", "delete"]);
    ok(&fs, &["revert", "-n", "HEAD"]);
    assert_eq!(fs.read_str("/repo/file").unwrap(), "base\n");
}
fn mail(subject: &str, before: &str, after: &str) -> String {
    format!(
        "From 0123456789012345678901234567890123456789 Mon Sep 17 00:00:00 2001\nFrom: Patch Author <patch@example.com>\nSubject: [PATCH] {subject}\n\nBody for {subject}.\n\n---\ndiff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-{before}\n+{after}\n-- \n2.0\n\n"
    )
}
#[test]
fn am_applies_each_mail_and_stages_only_patch_paths() {
    let fs = repo();
    commit(&fs, "base\n", "base");
    fs.write_str("/repo/untracked", "do not commit\n");
    fs.write_str(
        "/repo/series.mbox",
        &(mail("first", "base", "one") + &mail("second", "one", "two")),
    );
    ok(&fs, &["am", "series.mbox"]);
    assert_eq!(ok(&fs, &["ls-files"]), "file\n");
    assert_eq!(
        ok(&fs, &["log", "-2", "--format=%B"]),
        "second\n\nBody for second.\n\nfirst\n\nBody for first.\n\n"
    );
    assert_eq!(
        ok(&fs, &["log", "-1", "--format=%an <%ae>"]).trim(),
        "Patch Author <patch@example.com>"
    );
    assert_eq!(fs.read_str("/repo/file").unwrap(), "two\n");
}
#[test]
fn archive_stdout_is_the_same_binary_tar_as_output_file() {
    let fs = repo();
    fs.write("/repo/file", &[0, 255, 128, 10]);
    ok(&fs, &["add", "."]);
    ok(&fs, &["commit", "-m", "binary"]);
    let out = run(&fs, &["archive", "HEAD"]);
    assert_eq!(out.exit_code, 0);
    let bytes = out.stdout_bytes.unwrap_or_else(|| out.stdout.into_bytes());
    ok(&fs, &["archive", "HEAD", "-o", "out.tar"]);
    assert_eq!(bytes, fs.read("/repo/out.tar").unwrap());
    assert_eq!(&bytes[257..262], b"ustar");
    assert_eq!(&bytes[512..516], &[0, 255, 128, 10]);
}
#[test]
fn worktree_add_checks_out_branch_and_lists_its_own_head() {
    let fs = repo();
    let base = commit(&fs, "base\n", "base");
    ok(&fs, &["branch", "feature"]);
    let head = commit(&fs, "main\n", "main");
    ok(&fs, &["worktree", "add", "/feature", "feature"]);
    assert_eq!(fs.read_str("/feature/file").unwrap(), "base\n");
    let r = execute_git_cli(&fs, "/feature", &["rev-parse", "HEAD"]);
    assert_eq!(r.exit_code, 0, "{}", r.stderr);
    assert_eq!(r.stdout.trim(), base);
    assert!(
        ok(&fs, &["worktree", "list"]).contains(&format!("/feature  {} [feature]", &base[..7]))
    );
    assert_eq!(ok(&fs, &["rev-parse", "HEAD"]).trim(), head);
    ok(&fs, &["worktree", "add", "/new-branch"]);
    assert_eq!(ok(&fs, &["rev-parse", "new-branch"]).trim(), head);
    assert_eq!(fs.read_str("/new-branch/file").unwrap(), "main\n");
}

#[test]
fn revert_rejects_staged_changes_without_losing_them() {
    let fs = repo();
    commit(&fs, "base\n", "base");
    let target = commit(&fs, "changed\n", "target");
    fs.write_str("/repo/unrelated", "staged\n");
    ok(&fs, &["add", "unrelated"]);
    let tree = ok(&fs, &["write-tree"]);
    assert_ne!(run(&fs, &["revert", &target]).exit_code, 0);
    assert_eq!(ok(&fs, &["write-tree"]), tree);
    assert_eq!(fs.read_str("/repo/file").unwrap(), "changed\n");
}

#[test]
fn worktree_commits_update_shared_refs_without_changing_main_head() {
    let fs = repo();
    let main = commit(&fs, "base\n", "base");
    ok(&fs, &["worktree", "add", "/topic"]);
    fs.write_str("/topic/file", "topic\n");
    for args in [vec!["add", "file"], vec!["commit", "-m", "topic"]] {
        let r = execute_git_cli(&fs, "/topic", &args);
        assert_eq!(r.exit_code, 0, "{}", r.stderr);
    }
    assert_eq!(ok(&fs, &["rev-parse", "HEAD"]).trim(), main);
    assert_ne!(ok(&fs, &["rev-parse", "topic"]).trim(), main);
    let status = execute_git_cli(&fs, "/topic", &["status", "--porcelain"]);
    assert_eq!(status.exit_code, 0, "{}", status.stderr);
    assert_eq!(status.stdout, "");
}

#[test]
fn am_stages_patch_additions_and_deletions_only() {
    let fs = repo();
    commit(&fs, "base\n", "base");
    fs.write_str("/repo/untracked", "leave alone\n");
    fs.write_str("/repo/change.patch", "From: Author <author@example.com>\nSubject: [PATCH] replace file\n\nMessage body.\n---\ndiff --git a/file b/file\n--- a/file\n+++ /dev/null\n@@ -1 +0,0 @@\n-base\ndiff --git a/new b/new\n--- /dev/null\n+++ b/new\n@@ -0,0 +1 @@\n+new\n");
    ok(&fs, &["am", "change.patch"]);
    assert_eq!(ok(&fs, &["ls-files"]), "new\n");
    assert!(!fs.exists("/repo/file"));
    assert_eq!(fs.read_str("/repo/new").unwrap(), "new\n");
}
