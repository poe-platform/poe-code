use git_rust::{MemoryFs, execute_git_cli};

fn ok(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}

#[test]
fn scoped_diff_does_not_read_unrelated_blobs() {
    let fs = MemoryFs::new();
    ok(&fs, &["init"]);
    ok(&fs, &["config", "user.name", "Test"]);
    ok(&fs, &["config", "user.email", "test@example.com"]);
    fs.write_str("/repo/selected", "selected\n");
    fs.write_str("/repo/unrelated", "unrelated\n");
    ok(&fs, &["add", "."]);
    ok(&fs, &["commit", "-m", "base"]);
    let oid = ok(&fs, &["hash-object", "unrelated"]);
    let oid = oid.trim();
    fs.unlink(&format!("/repo/.git/objects/{}/{}", &oid[..2], &oid[2..])).unwrap();
    for args in [
        vec!["diff", "--numstat", "--", "selected"],
        vec!["diff", "--cached", "--", "selected"],
        vec!["diff", "HEAD", "--", "selected"],
    ] {
        assert_eq!(ok(&fs, &args), "");
    }
}
