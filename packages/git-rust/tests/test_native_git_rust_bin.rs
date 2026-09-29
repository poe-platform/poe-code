use std::fs;
use std::process::Command;

#[test]
fn test_standalone_git_rust_cli_binary_on_host_fs() {
    let bin = env!("CARGO_BIN_EXE_git-rust");
    let base = std::env::temp_dir().join(format!("git-rust-bin-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let remote = base.join("remote.git");
    let work = base.join("work");
    fs::create_dir_all(&remote).unwrap();
    fs::create_dir_all(&work).unwrap();

    // 1. Initialize remote repo with git-rust
    let st = Command::new(bin)
        .current_dir(&remote)
        .args(["init", "-b", "main"])
        .status()
        .unwrap();
    assert!(st.success());

    // 2. Initialize work repo, configure user, install hook, sign commit & tag
    assert!(
        Command::new(bin)
            .current_dir(&work)
            .args(["init", "-b", "main"])
            .status()
            .unwrap()
            .success()
    );
    assert!(
        Command::new(bin)
            .current_dir(&work)
            .args(["config", "user.name", "Alice"])
            .status()
            .unwrap()
            .success()
    );
    assert!(
        Command::new(bin)
            .current_dir(&work)
            .args(["config", "user.email", "alice@example.com"])
            .status()
            .unwrap()
            .success()
    );

    fs::write(work.join("hello.txt"), "hello from git-rust\n").unwrap();
    fs::write(
        work.join(".git/hooks/pre-commit"),
        "#!/bin/sh\necho \"hook-ok\" > .git/hook-marker\n",
    )
    .unwrap();

    assert!(
        Command::new(bin)
            .current_dir(&work)
            .args(["add", "hello.txt"])
            .status()
            .unwrap()
            .success()
    );
    assert!(
        Command::new(bin)
            .current_dir(&work)
            .args(["commit", "-S", "-m", "feat: signed via git-rust binary"])
            .status()
            .unwrap()
            .success()
    );
    assert_eq!(
        fs::read_to_string(work.join(".git/hook-marker")).unwrap().trim(),
        "hook-ok"
    );

    // 3. Verify commit signature via git-rust verify-commit HEAD
    let verify_out = Command::new(bin)
        .current_dir(&work)
        .args(["verify-commit", "HEAD"])
        .output()
        .unwrap();
    assert!(verify_out.status.success());
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&verify_out.stdout),
        String::from_utf8_lossy(&verify_out.stderr)
    );
    assert!(combined.contains("Good signature"));

    // 4. Add remote and push to host remote directory
    let remote_str = remote.to_string_lossy().to_string();
    assert!(
        Command::new(bin)
            .current_dir(&work)
            .args(["remote", "add", "origin", &remote_str])
            .status()
            .unwrap()
            .success()
    );
    let push_out = Command::new(bin)
        .current_dir(&work)
        .args(["push", "origin", "main"])
        .output()
        .unwrap();
    assert!(
        push_out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&push_out.stderr)
    );

    let _ = fs::remove_dir_all(&base);
}
