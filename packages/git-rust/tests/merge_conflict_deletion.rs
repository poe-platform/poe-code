use git_rust::{MemoryFs, execute_git_cli};

fn ok(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}

#[test]
fn conflicted_merge_preserves_clean_deletion_in_both_directions() {
    for reverse in [false, true] {
        let fs = MemoryFs::new();
        ok(&fs, &["init", "-b", "main"]);
        ok(&fs, &["config", "user.name", "Tester"]);
        ok(&fs, &["config", "user.email", "tester@example.invalid"]);
        fs.write_str("/repo/f", "row\n");
        fs.write_str("/repo/keep", "kept\n");
        ok(&fs, &["add", "f", "keep"]);
        ok(&fs, &["commit", "-m", "base"]);
        ok(&fs, &["branch", "topic"]);
        fs.write_str("/repo/f", "our\n");
        ok(&fs, &["add", "f"]);
        ok(&fs, &["commit", "-m", "ours"]);
        ok(&fs, &["switch", "topic"]);
        fs.write_str("/repo/f", "their\n");
        ok(&fs, &["rm", "keep"]);
        ok(&fs, &["add", "f"]);
        ok(&fs, &["commit", "-m", "theirs"]);
        let target = if reverse {
            "main"
        } else {
            ok(&fs, &["switch", "main"]);
            "topic"
        };
        let result = execute_git_cli(&fs, "/repo", &["merge", target]);
        assert_eq!(result.exit_code, 1, "{}", result.stderr);
        assert!(fs.read_str("/repo/f").unwrap().contains("<<<<<<<"));
        assert!(fs.lstat("/repo/keep").is_err(), "reverse={reverse}");
        let index = ok(&fs, &["ls-files", "--stage"]);
        assert!(!index.contains("\tkeep\n"), "{index}");
        for stage in 1..=3 {
            assert!(index.contains(&format!(" {stage}\tf\n")), "{index}");
        }
        let status = ok(&fs, &["status", "--porcelain"]);
        if !reverse {
            assert!(status.contains("D  keep\n"), "{status}");
        }
        fs.write_str("/repo/f", "resolved\n");
        ok(&fs, &["add", "f"]);
        ok(&fs, &["commit", "-m", "resolved merge"]);
        assert_eq!(ok(&fs, &["ls-tree", "--name-only", "HEAD"]), "f\n");
        assert!(ok(&fs, &["status", "--porcelain"]).is_empty());
    }
}
