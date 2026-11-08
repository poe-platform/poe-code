use git_rust::{MemoryFs, execute_git_cli};

#[test]
fn wire_commands_reject_missing_and_non_git_targets() {
    let fs = MemoryFs::new();
    fs.mkdir("/plain").unwrap();
    for command in [
        "upload-pack",
        "git-upload-pack",
        "receive-pack",
        "git-receive-pack",
    ] {
        for target in ["/missing", "/plain"] {
            let result = execute_git_cli(&fs, "/", &[command, target]);
            assert_eq!(result.exit_code, 128, "{command} {target}");
            assert_eq!(
                result.stderr,
                format!("fatal: '{target}' does not appear to be a git repository\n")
            );
            assert!(result.stdout.is_empty());
            assert!(result.stdout_bytes.is_none());
        }
    }
}

#[test]
fn wire_commands_accept_empty_worktree_and_bare_gitdirs() {
    let fs = MemoryFs::new();
    fs.mkdir("/repo").unwrap();
    assert_eq!(execute_git_cli(&fs, "/repo", &["init"]).exit_code, 0);
    for command in [
        "upload-pack",
        "git-upload-pack",
        "receive-pack",
        "git-receive-pack",
    ] {
        for target in ["/repo", "/repo/.git"] {
            let result = execute_git_cli(&fs, "/", &[command, target]);
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            assert!(result.stdout.contains("# service=git-"));
        }
    }
}
