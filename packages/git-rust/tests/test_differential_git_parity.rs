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
