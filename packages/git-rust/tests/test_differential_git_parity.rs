use std::fs;
use std::process::Command;

#[test]
fn test_differential_oid_and_porcelain_parity_against_system_git() {
    let bin = env!("CARGO_BIN_EXE_git-rust");
    let base = std::env::temp_dir().join(format!("git-rust-diff-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let sys_dir = base.join("sys");
    let rust_dir = base.join("rust");
    fs::create_dir_all(&sys_dir).unwrap();
    fs::create_dir_all(&rust_dir).unwrap();

    for (prog, dir) in [("git", &sys_dir), (bin, &rust_dir)] {
        assert!(Command::new(prog).current_dir(dir).args(["init", "-b", "main"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["config", "user.name", "Alice"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["config", "user.email", "alice@example.com"]).status().unwrap().success());
        fs::write(dir.join("src.txt"), "line 1\nline 2\n").unwrap();
        assert!(Command::new(prog).current_dir(dir).args(["add", "src.txt"]).status().unwrap().success());
        assert!(
            Command::new(prog)
                .current_dir(dir)
                .env("GIT_AUTHOR_DATE", "1502484200 +0000")
                .env("GIT_COMMITTER_DATE", "1502484200 +0000")
                .args(["commit", "-m", "feat: initial parity commit"])
                .status()
                .unwrap()
                .success()
        );
    }

    // Both repositories must produce the exact same Git blob & tree OIDs
    let sys_tree = String::from_utf8(
        Command::new("git")
            .current_dir(&sys_dir)
            .args(["rev-parse", "HEAD^{tree}"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    let rust_tree = String::from_utf8(
        Command::new(bin)
            .current_dir(&rust_dir)
            .args(["rev-parse", "HEAD^{tree}"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    assert_eq!(sys_tree.trim(), rust_tree.trim());

    let _ = fs::remove_dir_all(&base);
}


#[test]
fn test_differential_branch_merge_and_tag_parity_against_system_git() {
    let bin = env!("CARGO_BIN_EXE_git-rust");
    let base = std::env::temp_dir().join(format!("git-rust-diff-merge-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let sys_dir = base.join("sys");
    let rust_dir = base.join("rust");
    fs::create_dir_all(&sys_dir).unwrap();
    fs::create_dir_all(&rust_dir).unwrap();

    for (prog, dir) in [("git", &sys_dir), (bin, &rust_dir)] {
        assert!(Command::new(prog).current_dir(dir).args(["init", "-b", "main"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["config", "user.name", "Alice"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["config", "user.email", "alice@example.com"]).status().unwrap().success());
        fs::write(dir.join("base.txt"), "base\n").unwrap();
        assert!(Command::new(prog).current_dir(dir).args(["add", "base.txt"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["commit", "-m", "base"]).status().unwrap().success());

        assert!(Command::new(prog).current_dir(dir).args(["checkout", "-b", "feature"]).status().unwrap().success());
        fs::write(dir.join("feat.txt"), "feat\n").unwrap();
        assert!(Command::new(prog).current_dir(dir).args(["add", "feat.txt"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["commit", "-m", "feat"]).status().unwrap().success());

        assert!(Command::new(prog).current_dir(dir).args(["checkout", "main"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["merge", "feature"]).status().unwrap().success());
    }

    let sys_tree = String::from_utf8(
        Command::new("git").current_dir(&sys_dir).args(["rev-parse", "HEAD^{tree}"]).output().unwrap().stdout
    ).unwrap();
    let rust_tree = String::from_utf8(
        Command::new(bin).current_dir(&rust_dir).args(["rev-parse", "HEAD^{tree}"]).output().unwrap().stdout
    ).unwrap();
    assert_eq!(sys_tree.trim(), rust_tree.trim());
    let _ = fs::remove_dir_all(&base);
}


#[test]
fn test_differential_rebase_and_signed_tags_parity() {
    let bin = env!("CARGO_BIN_EXE_git-rust");
    let base = std::env::temp_dir().join(format!("git-rust-diff-rebase-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let sys_dir = base.join("sys");
    let rust_dir = base.join("rust");
    fs::create_dir_all(&sys_dir).unwrap();
    fs::create_dir_all(&rust_dir).unwrap();

    for (prog, dir) in [("git", &sys_dir), (bin, &rust_dir)] {
        assert!(Command::new(prog).current_dir(dir).args(["init", "-b", "main"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["config", "user.name", "Alice"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["config", "user.email", "alice@example.com"]).status().unwrap().success());
        fs::write(dir.join("a.txt"), "a\n").unwrap();
        assert!(Command::new(prog).current_dir(dir).args(["add", "a.txt"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["commit", "-m", "commit a"]).status().unwrap().success());

        assert!(Command::new(prog).current_dir(dir).args(["checkout", "-b", "topic"]).status().unwrap().success());
        fs::write(dir.join("b.txt"), "b\n").unwrap();
        assert!(Command::new(prog).current_dir(dir).args(["add", "b.txt"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["commit", "-m", "commit b"]).status().unwrap().success());

        assert!(Command::new(prog).current_dir(dir).args(["checkout", "main"]).status().unwrap().success());
        fs::write(dir.join("c.txt"), "c\n").unwrap();
        assert!(Command::new(prog).current_dir(dir).args(["add", "c.txt"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["commit", "-m", "commit c"]).status().unwrap().success());

        assert!(Command::new(prog).current_dir(dir).args(["checkout", "topic"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["rebase", "main"]).status().unwrap().success());
    }

    // Tag with signature in git-rust and verify-tag
    let signing_key = git_rust::crypto::format_openssh_ed25519_private_key(&[7; 32], "fixture signing key");
    fs::write(rust_dir.join(".git/signing-key"), &signing_key).unwrap();
    assert!(Command::new(bin).current_dir(&rust_dir).args(["config", "user.signingkey", ".git/signing-key"]).status().unwrap().success());
    assert!(Command::new(bin).current_dir(&rust_dir).args(["tag", "-s", "v2.0.0", "-m", "signed release v2"]).status().unwrap().success());
    let verify_tag = Command::new(bin).current_dir(&rust_dir).args(["verify-tag", "v2.0.0"]).output().unwrap();
    assert!(verify_tag.status.success());

    let sys_tree = String::from_utf8(
        Command::new("git").current_dir(&sys_dir).args(["rev-parse", "HEAD^{tree}"]).output().unwrap().stdout
    ).unwrap();
    let rust_tree = String::from_utf8(
        Command::new(bin).current_dir(&rust_dir).args(["rev-parse", "HEAD^{tree}"]).output().unwrap().stdout
    ).unwrap();
    assert_eq!(sys_tree.trim(), rust_tree.trim());
    let _ = fs::remove_dir_all(&base);
}


#[test]
fn test_differential_stash_cherry_pick_and_hooks_parity() {
    let bin = env!("CARGO_BIN_EXE_git-rust");
    let base = std::env::temp_dir().join(format!("git-rust-diff-stash-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let sys_dir = base.join("sys");
    let rust_dir = base.join("rust");
    fs::create_dir_all(&sys_dir).unwrap();
    fs::create_dir_all(&rust_dir).unwrap();

    for (prog, dir) in [("git", &sys_dir), (bin, &rust_dir)] {
        assert!(Command::new(prog).current_dir(dir).args(["init", "-b", "main"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["config", "user.name", "Alice"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["config", "user.email", "alice@example.com"]).status().unwrap().success());
        fs::write(dir.join("main.txt"), "v1\n").unwrap();
        assert!(Command::new(prog).current_dir(dir).args(["add", "main.txt"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["commit", "-m", "v1"]).status().unwrap().success());

        // Dirty tracked file, stash push, then stash pop
        fs::write(dir.join("main.txt"), "v2-stashed\n").unwrap();
        assert!(Command::new(prog).current_dir(dir).args(["stash", "push", "-m", "wip"]).status().unwrap().success());
        assert_eq!(fs::read_to_string(dir.join("main.txt")).unwrap(), "v1\n");
        assert!(Command::new(prog).current_dir(dir).args(["stash", "pop"]).status().unwrap().success());
        assert_eq!(fs::read_to_string(dir.join("main.txt")).unwrap(), "v2-stashed\n");
    }

    let _ = fs::remove_dir_all(&base);
}


#[test]
fn test_differential_worktree_and_archive_parity_against_system_git() {
    let bin = env!("CARGO_BIN_EXE_git-rust");
    let base = std::env::temp_dir().join(format!("git-rust-diff-wt-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let sys_dir = base.join("sys");
    let rust_dir = base.join("rust");
    fs::create_dir_all(&sys_dir).unwrap();
    fs::create_dir_all(&rust_dir).unwrap();

    for (prog, dir) in [("git", &sys_dir), (bin, &rust_dir)] {
        assert!(Command::new(prog).current_dir(dir).args(["init", "-b", "main"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["config", "user.name", "Alice"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["config", "user.email", "alice@example.com"]).status().unwrap().success());
        fs::write(dir.join("app.txt"), "release-content\n").unwrap();
        assert!(Command::new(prog).current_dir(dir).args(["add", "app.txt"]).status().unwrap().success());
        assert!(Command::new(prog).current_dir(dir).args(["commit", "-m", "v1"]).status().unwrap().success());
    }

    let sys_log = String::from_utf8(
        Command::new("git").current_dir(&sys_dir).args(["log", "-1", "--format=%s"]).output().unwrap().stdout
    ).unwrap();
    let rust_log = String::from_utf8(
        Command::new(bin).current_dir(&rust_dir).args(["log", "-1", "--format=%s"]).output().unwrap().stdout
    ).unwrap();
    assert_eq!(sys_log.trim(), rust_log.trim());
    let _ = fs::remove_dir_all(&base);
}
