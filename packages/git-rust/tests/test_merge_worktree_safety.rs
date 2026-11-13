use git_rust::{MemoryFs, execute_git_cli, fast_forward, update_index};

fn ok(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}

fn setup() -> MemoryFs {
    let fs = MemoryFs::new();
    ok(&fs, &["init", "-b", "main"]);
    ok(&fs, &["config", "user.name", "Tester"]);
    ok(&fs, &["config", "user.email", "tester@example.invalid"]);
    fs.write_str("/repo/f", "base\n");
    ok(&fs, &["add", "f"]);
    ok(&fs, &["commit", "-m", "base"]);
    ok(&fs, &["switch", "-c", "topic"]);
    fs.write_str("/repo/f", "topic\n");
    ok(&fs, &["add", "f"]);
    ok(&fs, &["commit", "-m", "topic"]);
    ok(&fs, &["switch", "main"]);
    fs
}

#[test]
fn fast_forward_api_rejects_local_changes_before_updating_ref() {
    let fs = setup();
    fs.write_str("/repo/f", "local\n");
    let head = ok(&fs, &["rev-parse", "HEAD"]);
    let index = fs.read("/repo/.git/index");
    assert!(fast_forward(&fs, "/repo", None, None, "topic", false).is_err());
    assert_eq!(ok(&fs, &["rev-parse", "HEAD"]), head);
    assert_eq!(fs.read("/repo/.git/index"), index);
    assert_eq!(fs.read_str("/repo/f").unwrap(), "local\n");
}

#[test]
fn fast_forward_merge_preserves_gitlink_entries() {
    let fs = setup();
    ok(&fs, &["switch", "topic"]);
    let target = ok(&fs, &["rev-parse", "HEAD"]);
    update_index(&fs, "/repo", "/repo/.git", "submodule", Some(target.trim()),
        Some(0o160000), true, false, false).unwrap();
    ok(&fs, &["commit", "-m", "gitlink"]);
    ok(&fs, &["switch", "main"]);
    ok(&fs, &["merge", "topic"]);
    assert!(fs.lstat("/repo/submodule").unwrap().is_directory());
    assert!(ok(&fs, &["ls-files", "--stage"]).contains(&format!("160000 {}", target.trim())));
}
