use git_rust::{MemoryFs, execute_git_cli};

fn ok(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}

#[test]
fn status_preserves_literal_backslashes_in_tracked_and_ignored_paths() {
    let fs = MemoryFs::new();
    ok(&fs, &["init", "-b", "main"]);
    ok(&fs, &["config", "user.name", "Test"]);
    ok(&fs, &["config", "user.email", "test@example.com"]);
    for path in [
        r"back\slash",
        r"..\literal",
        "back/slash",
        "ordinary",
        ".gitignore",
    ] {
        fs.write_str(
            &format!("/repo/{path}"),
            if path == ".gitignore" {
                "ignored/\n"
            } else {
                "base\n"
            },
        );
        ok(&fs, &["add", path]);
    }
    ok(&fs, &["commit", "-m", "fixtures"]);
    fs.write_str(r"/repo/ignored/back\slash", "ignored\n");
    for args in [
        vec!["status", "--short"],
        vec!["status", "--short", "--untracked-files=no"],
        vec!["status", "--short", "--", "ordinary"],
    ] {
        assert_eq!(ok(&fs, &args), "");
    }
    fs.write_str(r"/repo/back\slash", "changed\n");
    assert_eq!(fs.read_str("/repo/back/slash").as_deref(), Some("base\n"));
    for args in [
        vec!["status", "--short"],
        vec!["status", "--short", "--untracked-files=no"],
        vec!["status", "--short", "--", r"back\slash"],
    ] {
        assert_eq!(ok(&fs, &args), " M back\\slash\n");
    }
    assert_eq!(ok(&fs, &["status", "--short", "--", "ordinary"]), "");
    ok(&fs, &["add", r"back\slash"]);
    ok(&fs, &["commit", "-m", "update literal path"]);
    assert_eq!(ok(&fs, &["status", "--short"]), "");
}
