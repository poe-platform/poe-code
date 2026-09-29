use git_rust::{MemoryFs, cli::execute_git_cli};

#[test]
fn commit_signing_config_and_overrides_are_invocation_local() {
    let fs = MemoryFs::new();
    execute_git_cli(&fs, "/repo", &["init"]);
    fs.write_str(
        "/repo/key.asc",
        &git_rust::crypto::format_openssh_ed25519_private_key(&[7; 32], "test"),
    );
    execute_git_cli(&fs, "/repo", &["config", "gpg.format", "ssh"]);
    for (key, value) in [
        ("user.signingkey", "/repo/key.asc"),
        ("commit.gpgsign", "true"),
    ] {
        execute_git_cli(&fs, "/repo", &["config", key, value]);
    }
    let original = fs.read("/repo/.git/config");
    for flags in [
        vec![],
        vec!["--no-gpg-sign"],
        vec!["--no-gpg-sign", "-S"],
        vec!["-S", "--no-gpg-sign"],
        vec![],
    ] {
        let signed = flags.last().copied() != Some("--no-gpg-sign");
        let mut args = vec!["commit", "--allow-empty", "-m", "message"];
        args.extend(flags);
        let result = execute_git_cli(&fs, "/repo", &args);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(
            fs.read("/repo/.git/config"),
            original,
            "config changed by {args:?}"
        );
        let verification = execute_git_cli(&fs, "/repo", &["verify-commit", "HEAD"]);
        assert_eq!(
            verification.exit_code == 0,
            signed,
            "{args:?}: {}",
            verification.stderr
        );
    }
}

#[test]
fn configured_tag_signing_and_override() {
    let fs = MemoryFs::new();
    execute_git_cli(&fs, "/repo", &["init"]);
    execute_git_cli(&fs, "/repo", &["commit", "--allow-empty", "-m", "base"]);
    fs.write_str(
        "/repo/key.asc",
        &git_rust::crypto::format_openssh_ed25519_private_key(&[7; 32], "test"),
    );
    execute_git_cli(&fs, "/repo", &["config", "gpg.format", "ssh"]);
    execute_git_cli(
        &fs,
        "/repo",
        &["config", "user.signingkey", "/repo/key.asc"],
    );
    execute_git_cli(&fs, "/repo", &["config", "tag.gpgSign", "true"]);
    let original = fs.read("/repo/.git/config");
    for (name, flags, signed) in [
        ("signed", vec![], true),
        ("unsigned", vec!["--no-sign"], false),
    ] {
        let mut args = vec!["tag", "-a", "-m", "tag message", name];
        args.extend(flags);
        let result = execute_git_cli(&fs, "/repo", &args);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(
            execute_git_cli(&fs, "/repo", &["verify-tag", name]).exit_code == 0,
            signed
        );
        assert_eq!(fs.read("/repo/.git/config"), original);
    }
}
