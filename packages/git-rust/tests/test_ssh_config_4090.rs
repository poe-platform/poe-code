use git_rust::ssh::{parse_ssh_url, resolve_ssh_config};
use git_rust::{MemoryFs, cli::execute_git_cli};

fn git(fs: &MemoryFs, dir: &str, args: &[&str]) -> String {
    let result = execute_git_cli(fs, dir, args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout.trim().to_string()
}

#[test]
fn command_flags_override_host_config() {
    let fs = MemoryFs::new();
    git(&fs, "/client", &["init"]);
    git(
        &fs,
        "/client",
        &[
            "config",
            "core.sshCommand",
            "ssh -i /cli-key -p 2222 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/cli-hosts",
        ],
    );
    fs.write_str("/client/.ssh/config", "Host example.com\n IdentityFile /config-key\n Port 3333\n StrictHostKeyChecking yes\n UserKnownHostsFile /config-hosts\n HostName server.example.com\n");
    let endpoint = parse_ssh_url("git@example.com:repo.git").unwrap();
    let config = resolve_ssh_config(&fs, Some("/client"), Some("/client/.git"), &endpoint);
    assert_eq!(config.port, 2222);
    assert_eq!(config.identity_file.as_deref(), Some("/cli-key"));
    assert_eq!(config.strict_host_key_checking, "no");
    assert_eq!(config.user_known_hosts_file, "/cli-hosts");
    assert_eq!(config.host_name, "server.example.com");
}
