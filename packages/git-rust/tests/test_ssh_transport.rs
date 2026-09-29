use git_rust::cli::execute_git_cli;
use git_rust::crypto::{
    ed25519_public_key, format_openssh_ed25519_private_key, format_openssh_ed25519_public_key,
    sha256,
};
use git_rust::ssh::{parse_ssh_url, resolve_ssh_config};
use git_rust::MemoryFs;

#[test]
fn test_ssh_url_parsing_and_ssh_config_resolution() {
    let scp = parse_ssh_url("git@github.com:poe-platform/poe-code.git").unwrap();
    assert_eq!(scp.user, "git");
    assert_eq!(scp.host, "github.com");
    assert_eq!(scp.port, 22);
    assert_eq!(scp.path, "poe-platform/poe-code.git");
    assert!(!scp.is_local_path);

    let scheme = parse_ssh_url("ssh://deploy@gitlab.example.com:2222/team/service.git").unwrap();
    assert_eq!(scheme.user, "deploy");
    assert_eq!(scheme.host, "gitlab.example.com");
    assert_eq!(scheme.port, 2222);
    assert_eq!(scheme.path, "team/service.git");

    let fs = MemoryFs::new();
    fs.write_str(
        "/home/user/.ssh/config",
        "Host gh-work\n  HostName github.com\n  User git\n  Port 2222\n  IdentityFile ~/.ssh/id_work\n  StrictHostKeyChecking yes\n",
    );
    let alias_ep = parse_ssh_url("git@gh-work:org/app.git").unwrap();
    let cfg = resolve_ssh_config(&fs, None, None, &alias_ep);
    assert_eq!(cfg.host_name, "github.com");
    assert_eq!(cfg.user, "git");
    assert_eq!(cfg.port, 2222);
    assert_eq!(cfg.identity_file.as_deref(), Some("/home/user/.ssh/id_work"));
    assert_eq!(cfg.strict_host_key_checking, "yes");
}

#[test]
fn test_ssh_clone_fetch_pull_push_auth_known_hosts_and_receive_hooks() {
    let fs = MemoryFs::new();

    // 1. Initialize remote repository at /remotes/github.com/org/repo.git
    let remote_dir = "/remotes/github.com/org/repo.git";
    assert_eq!(execute_git_cli(&fs, remote_dir, &["init", "-b", "main"]).exit_code, 0);
    execute_git_cli(&fs, remote_dir, &["config", "user.name", "RemoteUser"]);
    execute_git_cli(&fs, remote_dir, &["config", "user.email", "remote@example.com"]);
    fs.write_str(&format!("{remote_dir}/README.md"), "# Initial SSH Repo\n");
    execute_git_cli(&fs, remote_dir, &["add", "README.md"]);
    execute_git_cli(&fs, remote_dir, &["commit", "-m", "initial commit"]);

    // 2. Configure server host key & authorized_keys
    let host_seed = sha256(b"github-host-ed25519-seed");
    let host_pub = ed25519_public_key(&host_seed);
    let host_pub_line = format_openssh_ed25519_public_key(&host_pub, "github.com");
    fs.write_str("/remotes/github.com/host_key.pub", &format!("{host_pub_line}\n"));

    let client_seed = sha256(b"alice-ssh-client-seed");
    let client_pub = ed25519_public_key(&client_seed);
    let client_priv_pem = format_openssh_ed25519_private_key(&client_seed, "alice@workstation");
    let client_pub_line = format_openssh_ed25519_public_key(&client_pub, "alice@workstation");
    fs.write_str("/remotes/github.com/authorized_keys", &format!("{client_pub_line}\n"));

    // Without client private key, clone over SSH fails with Permission denied (publickey)
    let unauth_clone = execute_git_cli(
        &fs,
        "/work",
        &["clone", "git@github.com:org/repo.git", "/work/client"],
    );
    assert_ne!(unauth_clone.exit_code, 0);
    assert!(unauth_clone.stderr.contains("Permission denied (publickey)"));

    // Install Alice's private key in /home/user/.ssh/id_ed25519
    fs.write_str("/home/user/.ssh/id_ed25519", &client_priv_pem);

    // 3. Clone over SCP-style SSH URL succeeds and records host key via accept-new
    let clone_res = execute_git_cli(
        &fs,
        "/work",
        &["clone", "git@github.com:org/repo.git", "/work/client"],
    );
    assert_eq!(clone_res.exit_code, 0, "stderr: {}", clone_res.stderr);
    assert_eq!(
        fs.read_str("/work/client/README.md").as_deref(),
        Some("# Initial SSH Repo\n")
    );
    let known_hosts = fs.read_str("/home/user/.ssh/known_hosts").unwrap_or_default();
    assert!(known_hosts.contains("github.com ssh-ed25519"));

    // 4. ls-remote over SSH works
    let ls_res = execute_git_cli(&fs, "/work/client", &["ls-remote", "origin"]);
    assert_eq!(ls_res.exit_code, 0);
    assert!(ls_res.stdout.contains("refs/heads/main"));

    // 5. Configure server-side pre-receive, update, and post-receive hooks on remote
    fs.write_str(
        &format!("{remote_dir}/.git/hooks/pre-receive"),
        "#!/bin/sh\nwhile read old_sha new_sha refname; do\n  echo \"pre-receive:$refname\" > .git/pre-receive.log\ndone\n",
    );
    fs.write_str(
        &format!("{remote_dir}/.git/hooks/update"),
        "#!/bin/sh\necho \"update:$1:$2->$3\" > .git/update.log\n",
    );
    fs.write_str(
        &format!("{remote_dir}/.git/hooks/post-receive"),
        "#!/bin/sh\nwhile read old_sha new_sha refname; do\n  echo \"post-receive:$new_sha\" > .git/post-receive.log\ndone\n",
    );

    // 6. Commit in /work/client and git push over SSH
    execute_git_cli(&fs, "/work/client", &["config", "user.name", "Alice"]);
    execute_git_cli(&fs, "/work/client", &["config", "user.email", "alice@example.com"]);
    fs.write_str("/work/client/feature.ts", "export const ssh = true;\n");
    execute_git_cli(&fs, "/work/client", &["add", "feature.ts"]);
    execute_git_cli(&fs, "/work/client", &["commit", "-m", "feat: push over ssh"]);
    let pushed_oid = execute_git_cli(&fs, "/work/client", &["rev-parse", "HEAD"])
        .stdout
        .trim()
        .to_string();

    let push_res = execute_git_cli(&fs, "/work/client", &["push", "origin", "main"]);
    assert_eq!(push_res.exit_code, 0, "stderr: {}", push_res.stderr);

    // Remote main ref updated and server-side receive hooks executed!
    let remote_head = execute_git_cli(&fs, remote_dir, &["rev-parse", "refs/heads/main"])
        .stdout
        .trim()
        .to_string();
    assert_eq!(remote_head, pushed_oid);
    assert_eq!(
        fs.read_str(&format!("{remote_dir}/.git/pre-receive.log")).as_deref(),
        Some("pre-receive:refs/heads/main\n")
    );
    assert_eq!(
        fs.read_str(&format!("{remote_dir}/.git/post-receive.log")).as_deref(),
        Some(format!("post-receive:{pushed_oid}\n").as_str())
    );
}
