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
fn revert_root_and_configured_timestamps() {
    let fs = repo();
    let before = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    ok(&fs, &["revert", "HEAD"]);
    assert!(!fs.exists("/repo/file"));
    let oid = ok(&fs, &["rev-parse", "HEAD"]);
    let reverted = git_rust::read_commit(&fs, "/repo/.git", oid.trim())
        .unwrap()
        .commit;
    assert_eq!(reverted.author.name, "Configured");
    assert!(reverted.author.timestamp >= before);
    ok(&fs, &["tag", "-a", "v1", "-m", "release"]);
    let tag = ok(&fs, &["cat-file", "-p", "v1"]);
    assert!(tag.contains("tagger Configured <configured@example.com>"));
    assert!(!tag.contains("1502484200"));
}
