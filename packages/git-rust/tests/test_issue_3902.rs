use git_rust::{MemoryFs, execute_git_cli, read_commit};

fn run(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}
fn repo() -> (MemoryFs, String) {
    let fs = MemoryFs::new();
    run(&fs, &["init", "-b", "main"]);
    run(&fs, &["config", "user.name", "User"]);
    run(&fs, &["config", "user.email", "user@example.test"]);
    fs.write_str("/repo/base", "base");
    run(&fs, &["add", "."]);
    run(&fs, &["commit", "-m", "base"]);
    let oid = run(&fs, &["rev-parse", "HEAD"]).trim().to_string();
    (fs, oid)
}
#[test]
fn root_cherry_pick_and_no_commit_objects() {
    for flag in [None, Some("-n"), Some("--no-commit")] {
        let (fs, head) = repo();
        run(&fs, &["checkout", "--orphan", "orphan"]);
        run(&fs, &["rm", "base"]);
        fs.write_str("/repo/root", "root content");
        run(&fs, &["add", "."]);
        run(&fs, &["commit", "-m", "root"]);
        let root = run(&fs, &["rev-parse", "HEAD"]);
        run(&fs, &["checkout", "main"]);
        let before = fs.readdir_deep("/repo/.git/objects");
        let mut args = vec!["cherry-pick"];
        args.extend(flag);
        args.push(root.trim());
        run(&fs, &args);
        assert_eq!(fs.read_str("/repo/root").unwrap(), "root content");
        assert_eq!(fs.read_str("/repo/base").unwrap(), "base");
        if flag.is_some() {
            assert_eq!(run(&fs, &["rev-parse", "HEAD"]).trim(), head);
            assert_eq!(run(&fs, &["diff", "--cached", "--name-only"]), "root\n");
            for path in fs.readdir_deep("/repo/.git/objects") {
                if !before.contains(&path) {
                    let relative = path.strip_prefix("/repo/.git/objects/").unwrap();
                    let oid = relative.replace('/', "");
                    assert!(
                        read_commit(&fs, "/repo/.git", &oid).is_err(),
                        "unexpected commit {oid}"
                    );
                }
            }
        } else {
            let picked = run(&fs, &["rev-parse", "HEAD"]);
            assert_eq!(
                read_commit(&fs, "/repo/.git", picked.trim())
                    .unwrap()
                    .commit
                    .parent,
                vec![head]
            );
        }
    }
}

#[test]
fn no_commit_pick_does_not_create_a_commit_object() {
    let (fs, head) = repo();
    run(&fs, &["checkout", "-b", "side"]);
    fs.write_str("/repo/side", "side");
    run(&fs, &["add", "."]);
    run(&fs, &["commit", "-m", "side"]);
    let pick = run(&fs, &["rev-parse", "HEAD"]);
    run(&fs, &["checkout", "main"]);
    run(&fs, &["config", "user.name", "Picker"]);
    let before = fs.readdir_deep("/repo/.git/objects");
    run(&fs, &["cherry-pick", "-n", pick.trim()]);
    assert_eq!(run(&fs, &["rev-parse", "HEAD"]).trim(), head);
    assert_eq!(run(&fs, &["diff", "--cached", "--name-only"]), "side\n");
    for path in fs.readdir_deep("/repo/.git/objects") {
        if !before.contains(&path) {
            let relative = path.strip_prefix("/repo/.git/objects/").unwrap();
            let oid = relative.replace('/', "");
            assert!(
                read_commit(&fs, "/repo/.git", &oid).is_err(),
                "unexpected commit {oid}"
            );
        }
    }
}
