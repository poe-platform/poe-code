use git_rust::{MemoryFs, execute_git_cli};

fn ok(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}

#[test]
fn non_text_conflicts_require_resolution_or_abort() {
    for (ours, theirs, stages) in [
        (Some("o\0"), Some("t\0"), vec![1, 2, 3]),
        (Some("ours\n"), None, vec![1, 2]),
        (None, Some("theirs\n"), vec![1, 3]),
    ] {
        for abort in [false, true] {
            let fs = MemoryFs::new();
            ok(&fs, &["init", "-b", "main"]);
            ok(&fs, &["config", "user.name", "Test"]);
            ok(&fs, &["config", "user.email", "test@example.com"]);
            fs.write_str("/repo/f", "a\0");
            ok(&fs, &["add", "f"]);
            ok(&fs, &["commit", "-m", "base"]);
            ok(&fs, &["branch", "topic"]);
            for (branch, contents) in [("main", ours), ("topic", theirs)] {
                ok(&fs, &["checkout", branch]);
                if let Some(contents) = contents {
                    fs.write_str("/repo/f", contents);
                    ok(&fs, &["add", "f"]);
                } else {
                    ok(&fs, &["rm", "f"]);
                }
                ok(&fs, &["commit", "-m", branch]);
            }
            ok(&fs, &["checkout", "main"]);
            let head = ok(&fs, &["rev-parse", "HEAD"]);
            assert_eq!(
                execute_git_cli(&fs, "/repo", &["merge", "topic"]).exit_code,
                1
            );
            let index = ok(&fs, &["ls-files", "--stage"]);
            let actual: Vec<u8> = index
                .lines()
                .map(|line| line.split_whitespace().nth(2).unwrap().parse().unwrap())
                .collect();
            assert_eq!(actual, stages, "ours={ours:?}, theirs={theirs:?}");
            assert!(!ok(&fs, &["status", "--porcelain"]).is_empty());
            assert_eq!(fs.read_str("/repo/f").as_deref(), ours.or(theirs));
            assert_eq!(
                execute_git_cli(&fs, "/repo", &["commit", "-m", "unresolved"]).exit_code,
                128
            );
            assert_eq!(ok(&fs, &["rev-parse", "HEAD"]), head);
            assert!(fs.exists("/repo/.git/MERGE_HEAD"));
            if abort {
                ok(&fs, &["merge", "--abort"]);
                assert_eq!(fs.read_str("/repo/f").as_deref(), ours);
            } else {
                fs.write_str("/repo/f", "resolved\n");
                ok(&fs, &["add", "f"]);
                ok(&fs, &["commit", "-m", "resolved"]);
                assert_eq!(
                    ok(&fs, &["cat-file", "-p", "HEAD"])
                        .lines()
                        .filter(|line| line.starts_with("parent "))
                        .count(),
                    2
                );
            }
            assert!(!fs.exists("/repo/.git/MERGE_HEAD"));
            assert_eq!(ok(&fs, &["status", "--porcelain"]), "");
        }
    }
}
