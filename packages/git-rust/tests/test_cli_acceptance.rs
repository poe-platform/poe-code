use git_rust::{MemoryFs, execute_git_cli};
fn ok(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}
fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    ok(&fs, &["init", "-b", "main"]);
    ok(&fs, &["config", "user.name", "Configured"]);
    ok(&fs, &["config", "user.email", "configured@example.com"]);
    save(&fs, "file", "base\n", "base");
    fs
}
fn save(fs: &MemoryFs, path: &str, text: &str, message: &str) -> String {
    fs.write_str(&format!("/repo/{path}"), text);
    ok(fs, &["add", path]);
    ok(fs, &["commit", "-m", message]);
    ok(fs, &["rev-parse", "HEAD"]).trim().into()
}
#[test]
fn requested_worktree_and_revision_operations() {
    let fs = repo();
    let first = ok(&fs, &["rev-parse", "HEAD"]);
    assert_eq!(ok(&fs, &["rev-parse", "--git-dir"]), ".git\n");
    ok(&fs, &["config", "branch.main.remote", "origin"]);
    ok(&fs, &["config", "branch.main.merge", "refs/heads/main"]);
    ok(&fs, &["update-ref", "refs/remotes/origin/main", first.trim()]);
    assert_eq!(ok(&fs, &["rev-parse", "main@{u}"]), first);

    fs.write_str("/repo/file", "next\n");
    assert_eq!(ok(&fs, &["diff", "--name-only", "--", "file"]), "file\n");
    assert!(ok(&fs, &["diff", "--stat"]).contains("file"));
    ok(&fs, &["add", "file"]);
    for flag in ["--cached", "--staged"] {
        assert_eq!(ok(&fs, &["diff", flag, "--name-status"]), "M\tfile\n");
    }
    ok(&fs, &["commit", "-am", "next"]);
    assert_eq!(ok(&fs, &["rev-parse", "HEAD~1"]), first);
    assert_eq!(ok(&fs, &["rev-parse", "HEAD^"]), first);
    assert_eq!(
        ok(&fs, &["rev-parse", "--short", "HEAD~1"]).trim(),
        &first[..7]
    );
    assert_eq!(ok(&fs, &["rev-parse", "--show-toplevel"]), "/repo\n");
    assert_eq!(ok(&fs, &["rev-parse", "--is-inside-work-tree"]), "true\n");
    assert_eq!(ok(&fs, &["rev-parse", "--verify", "HEAD~1"]), first);
    assert_eq!(ok(&fs, &["show", "HEAD:file"]), "next\n");
    assert!(ok(&fs, &["diff", "HEAD~1", "HEAD", "--", "file"]).contains("+next"));
    fs.write_str("/repo/file", "all\n");
    ok(&fs, &["commit", "--all", "-m", "all"]);
    assert_eq!(ok(&fs, &["show", "HEAD:file"]), "all\n");
    ok(&fs, &["reset", "--soft", "HEAD~1"]);
    assert!(ok(&fs, &["diff", "--cached"]).contains("+all"));
    ok(&fs, &["reset", "HEAD", "file"]);
    assert!(ok(&fs, &["diff", "--cached"]).is_empty());
    ok(&fs, &["reset", "--mixed", "HEAD~1"]);
    assert_eq!(fs.read_str("/repo/file").as_deref(), Some("all\n"));
    ok(&fs, &["reset", "--hard", "HEAD"]);
    assert_eq!(fs.read_str("/repo/file").as_deref(), Some("base\n"));
    fs.write_str("/repo/file", "dirty\n");
    ok(&fs, &["restore", "file"]);
    ok(&fs, &["mv", "file", "moved"]);
    assert_eq!(fs.read_str("/repo/moved").as_deref(), Some("base\n"));
    fs.write_str("/repo/junk", "untracked\n");
    ok(&fs, &["clean", "-f"]);
    assert!(!fs.exists("/repo/junk"));
    assert!(!ok(&fs, &["reflog"]).is_empty());
    fs.write_str(
        "/repo/change.patch",
        "--- a/moved\n+++ b/moved\n@@ -1 +1 @@\n-base\n+patched\n",
    );
    ok(&fs, &["apply", "--check", "change.patch"]);
    ok(&fs, &["apply", "change.patch"]);
    assert_eq!(fs.read_str("/repo/moved").as_deref(), Some("patched\n"));
}
