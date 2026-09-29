use git_rust::{MemoryFs, cli::execute_git_cli};

#[test]
fn successful_exit_inside_if_stops_hook() {
    let fs = MemoryFs::new();
    execute_git_cli(&fs, "/repo", &["init"]);
    fs.write_str(
        "/repo/.git/hooks/pre-commit",
        "if [ 1 = 1 ]; then\n exit 0\nfi\nexit 1\n",
    );
    let result = execute_git_cli(&fs, "/repo", &["commit", "--allow-empty", "-m", "base"]);
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
}

#[test]
fn hook_quotes_preserve_semicolons_and_literal_variables() {
    let fs = MemoryFs::new();
    execute_git_cli(&fs, "/repo", &["init"]);
    fs.write_str("/repo/.git/hooks/prepare-commit-msg", "echo 'literal;$1;${GIT_DIR}' >> \"$1\"; echo \"double;quoted\" >> \"$1\"\necho escaped\\;semicolon >> \"$1\"\n");
    let result = execute_git_cli(&fs, "/repo", &["commit", "--allow-empty", "-m", "base"]);
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let log = execute_git_cli(&fs, "/repo", &["log", "-1"]).stdout;
    assert!(log.contains("literal;$1;${GIT_DIR}"), "{log}");
    assert!(log.contains("double;quoted"), "{log}");
    assert!(log.contains("escaped;semicolon"), "{log}");
}

#[test]
fn hook_single_quotes_disable_expansion() {
    let fs = MemoryFs::new();
    execute_git_cli(&fs, "/repo", &["init"]);
    fs.write_str(
        "/repo/.git/hooks/prepare-commit-msg",
        "echo '$1 ${GIT_DIR} $?' >> \"$1\"\n",
    );
    let result = execute_git_cli(&fs, "/repo", &["commit", "--allow-empty", "-m", "base"]);
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let log = execute_git_cli(&fs, "/repo", &["log", "-1"]).stdout;
    assert!(log.contains("$1 ${GIT_DIR} $?"), "{log}");
}
