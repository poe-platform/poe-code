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
fn blame_tracks_reintroduced_and_duplicate_lines() {
    let fs = repo();
    save(&fs, "file", "same\nkeep\n", "original");
    save(&fs, "file", "other\nkeep\n", "replacement");
    let newest = save(&fs, "file", "same\nkeep\nsame\n", "reintroduced");
    let blame = ok(&fs, &["blame", "-l", "file"]);
    let lines: Vec<_> = blame.lines().collect();
    assert!(lines[0].starts_with(&newest), "{blame}");
    assert!(lines[2].starts_with(&newest), "{blame}");
}
