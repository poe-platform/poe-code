use git_rust::{MemoryFs, execute_git_cli, read_commit};

fn ok(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}

fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    ok(&fs, &["init", "-b", "main"]);
    fs.write_str("/repo/file.txt", "v1\n");
    ok(&fs, &["add", "."]);
    ok(&fs, &["commit", "-m", "first"]);
    ok(&fs, &["tag", "-a", "v1", "-m", "release"]);
    ok(&fs, &["tag", "-a", "alias", "-m", "alias", "v1"]);
    ok(&fs, &["tag", "-a", "outer", "-m", "outer", "alias"]);
    fs
}

#[test]
fn read_commit_and_log_peel_arbitrarily_nested_tags() {
    let fs = repo();
    let expected = read_commit(&fs, "/repo/.git", ok(&fs, &["rev-parse", "HEAD"]).trim()).unwrap();
    for target in ["v1", "alias", "outer"] {
        let oid = ok(&fs, &["rev-parse", target]);
        assert_eq!(
            read_commit(&fs, "/repo/.git", oid.trim()).unwrap(),
            expected
        );
        assert_eq!(
            ok(&fs, &["log", "-n", "1", "--oneline", target]),
            ok(&fs, &["log", "-n", "1", "--oneline", "HEAD"])
        );
    }
}
