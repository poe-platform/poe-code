use git_rust::{MemoryFs, environment::EnvironmentScope, execute_git_cli};
use std::collections::BTreeMap;
fn ok(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}
fn repo() -> MemoryFs {
    let fs = MemoryFs::new();
    ok(&fs, &["init", "-b", "main"]);
    ok(&fs, &["config", "user.name", "Configured"]);
    ok(&fs, &["config", "user.email", "configured@example.com"]);
    save(&fs, "file", "base\n", "base");
    fs
}
fn save(fs: &MemoryFs, path: &str, text: &str, message: &str) -> String {
    fs.write_str(&format!("/repo/{path}"), text);
    ok(fs, &["add", path]);
    ok(fs, &["commit", "-m", message]);
    ok(fs, &["rev-parse", "HEAD"]).trim().into()
}
#[test]
fn merge_and_cherry_pick_honor_request_identity() {
    let fs = repo();
    ok(&fs, &["checkout", "-b", "topic"]);
    let topic = save(&fs, "topic", "topic\n", "topic");
    ok(&fs, &["checkout", "main"]);
    save(&fs, "main", "main\n", "main");
    let _env = EnvironmentScope::new(BTreeMap::from([
        ("GIT_AUTHOR_NAME".into(), "Author".into()),
        ("GIT_AUTHOR_EMAIL".into(), "author@example.com".into()),
        ("GIT_AUTHOR_DATE".into(), "1800000000 +0200".into()),
        ("GIT_COMMITTER_NAME".into(), "Committer".into()),
        ("GIT_COMMITTER_EMAIL".into(), "committer@example.com".into()),
        ("GIT_COMMITTER_DATE".into(), "1800000100 -0300".into()),
    ]));
    ok(&fs, &["merge", "topic"]);
    let merged = git_rust::read_commit(&fs, "/repo/.git", ok(&fs, &["rev-parse", "HEAD"]).trim())
        .unwrap()
        .commit;
    assert_eq!(merged.author.name, "Author");
    assert_eq!(merged.author.timestamp, 1800000000);
    assert_eq!(merged.committer.name, "Committer");
    assert_eq!(merged.committer.timestamp, 1800000100);
    ok(&fs, &["reset", "--hard", "HEAD~1"]);
    ok(&fs, &["cherry-pick", &topic]);
    let picked = git_rust::read_commit(&fs, "/repo/.git", ok(&fs, &["rev-parse", "HEAD"]).trim())
        .unwrap()
        .commit;
    assert_eq!(picked.author.name, "Configured");
    assert_eq!(picked.committer.name, "Committer");
    assert_eq!(picked.committer.timestamp, 1800000100);
}
#[test]
fn pull_merge_uses_configured_and_environment_identity() {
    let remote = repo();
    let server = git_rust::MockHttpServer::new();
    server.register_repo("project", remote.clone(), "/repo/.git");
    let fs = MemoryFs::new();
    let cloned = git_rust::execute_git_cli_with_http(
        &fs,
        "/",
        &["clone", "http://localhost:8888/project.git", "/repo"],
        &server,
    );
    assert_eq!(cloned.exit_code, 0, "{}", cloned.stderr);
    ok(&fs, &["config", "user.name", "Puller"]);
    ok(&fs, &["config", "user.email", "puller@example.com"]);
    save(&fs, "local", "local\n", "local");
    save(&remote, "remote", "remote\n", "remote");
    let _env = EnvironmentScope::new(BTreeMap::from([
        ("GIT_AUTHOR_NAME".into(), "Pull Author".into()),
        ("GIT_AUTHOR_DATE".into(), "1800000000 +0200".into()),
        ("GIT_COMMITTER_NAME".into(), "Pull Committer".into()),
        ("GIT_COMMITTER_DATE".into(), "1800000100 -0300".into()),
    ]));
    let result =
        git_rust::execute_git_cli_with_http(&fs, "/repo", &["pull", "origin", "main"], &server);
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let head = ok(&fs, &["rev-parse", "HEAD"]);
    let merged = git_rust::read_commit(&fs, "/repo/.git", head.trim())
        .unwrap()
        .commit;
    assert_eq!(merged.parent.len(), 2);
    assert_eq!(merged.author.name, "Pull Author");
    assert_eq!(merged.author.email, "puller@example.com");
    assert_eq!(merged.author.timestamp, 1800000000);
    assert_eq!(merged.committer.name, "Pull Committer");
    assert_eq!(merged.committer.timestamp, 1800000100);
}
