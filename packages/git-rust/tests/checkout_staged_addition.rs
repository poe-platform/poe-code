use git_rust::{MemoryFs, cli::execute_git_cli, resolve_ref};

#[test]
fn branch_from_another_commit_preserves_unrelated_staged_addition() {
    for (command, flag) in [("switch", "-c"), ("checkout", "-b")] {
        for force in [false, true] {
            let fs = MemoryFs::new();
            let run = |args: &[&str]| {
                let result = execute_git_cli(&fs, "/repo", args);
                assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
                result.stdout
            };
            run(&["init", "-b", "main"]);
            run(&["config", "user.name", "Audit"]);
            run(&["config", "user.email", "audit@example.invalid"]);
            fs.write_str("/repo/a", "base\n");
            fs.write_str("/repo/b", "second\n");
            run(&["add", "a", "b"]);
            run(&["commit", "-m", "base"]);
            run(&["checkout", "-b", "topic"]);
            fs.write_str("/repo/a", "topic\n");
            run(&["commit", "-am", "topic"]);
            let topic = resolve_ref(&fs, "/repo/.git", "HEAD", None).unwrap();
            run(&["checkout", "main"]);
            fs.write_str("/repo/z", "local");
            run(&["add", "z"]);
            // Keep the staged blob distinct from the working copy.
            fs.write_str("/repo/z", "unstaged");
            let mut args = vec![command, flag, "work", "topic"];
            if force {
                args.push("--force");
            }
            run(&args);
            assert_eq!(run(&["branch", "--show-current"]), "work\n");
            assert_eq!(resolve_ref(&fs, "/repo/.git", "HEAD", None).unwrap(), topic);
            assert_eq!(fs.read_str("/repo/a").unwrap(), "topic\n");
            assert_eq!(fs.read_str("/repo/b").unwrap(), "second\n");
            assert_eq!(fs.read_str("/repo/z").unwrap(), "unstaged");
            if force {
                assert_eq!(run(&["diff", "--cached", "--name-only"]), "");
            } else {
                assert_eq!(run(&["show", ":z"]), "local");
                assert_eq!(run(&["diff", "--cached", "--name-only"]), "z\n");
                run(&["commit", "-m", "keep staged addition"]);
                assert_eq!(run(&["show", "HEAD:z"]), "local");
                assert_eq!(fs.read_str("/repo/z").unwrap(), "unstaged");
            }
        }
    }
}
