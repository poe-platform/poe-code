use git_rust::portable::execute_portable;
use mcp_protocol_rust::json::{self, Value};
fn run(entries: &mut Value, cwd: &str, args: &[&str], env: &str) -> Value {
    let args = args
        .iter()
        .map(|s| format!("\"{s}\""))
        .collect::<Vec<_>>()
        .join(",");
    let input = format!(
        r#"{{"cwd":"{cwd}","args":[{args}],"entries":{},"env":{env}}}"#,
        json::stringify(entries)
    );
    let output = execute_portable(input.as_bytes()).unwrap();
    let result = json::parse(&output, json::Limits::default()).unwrap();
    assert_eq!(
        result.get("exitCode"),
        Some(&Value::Number(0.0)),
        "{}",
        json::stringify(&result)
    );
    *entries = result.get("entries").unwrap().clone();
    result
}
fn stdout(result: &Value) -> String {
    if let Value::String(s) = result.get("stdout").unwrap() {
        String::from_utf16(s).unwrap()
    } else {
        panic!()
    }
}
#[test]
fn quiet_init_and_commit() {
    for flag in ["-q", "--quiet"] {
        let mut entries = Value::Array(vec![]);
        assert_eq!(
            stdout(&run(&mut entries, "/repo", &["init", flag], "{}")),
            ""
        );
        assert_eq!(
            stdout(&run(
                &mut entries,
                "/repo",
                &["commit", flag, "--allow-empty", "-m", "first"],
                "{}"
            )),
            ""
        );
    }
}
#[test]
fn environment_identity_dates_and_repository_location_are_request_scoped() {
    let mut entries = Value::Array(vec![]);
    run(&mut entries, "/repo", &["init"], "{}");
    let env = r#"{"GIT_DIR":"/repo/.git","GIT_WORK_TREE":"/repo","GIT_AUTHOR_NAME":"Override Author","GIT_AUTHOR_EMAIL":"author@example.com","GIT_AUTHOR_DATE":"1700000000 +0530","GIT_COMMITTER_NAME":"Override Committer","GIT_COMMITTER_EMAIL":"committer@example.com","GIT_COMMITTER_DATE":"1700000100 -0400"}"#;
    assert_eq!(
        stdout(&run(
            &mut entries,
            "/",
            &["rev-parse", "--show-toplevel"],
            env
        )),
        "/repo\n"
    );
    run(
        &mut entries,
        "/",
        &["commit", "--allow-empty", "-m", "first"],
        env,
    );
    let object = stdout(&run(
        &mut entries,
        "/repo",
        &["cat-file", "-p", "HEAD"],
        "{}",
    ));
    assert!(
        object.contains("author Override Author <author@example.com> 1700000000 +0530"),
        "{object}"
    );
    assert!(
        object.contains("committer Override Committer <committer@example.com> 1700000100 -0400"),
        "{object}"
    );
    run(
        &mut entries,
        "/repo",
        &["commit", "--allow-empty", "-m", "second"],
        "{}",
    );
    let object = stdout(&run(
        &mut entries,
        "/repo",
        &["cat-file", "-p", "HEAD"],
        "{}",
    ));
    assert!(!object.contains("Override"), "{object}");
}

#[test]
fn iso_environment_dates() {
    let mut entries = Value::Array(vec![]);
    run(&mut entries, "/repo", &["init"], "{}");
    run(
        &mut entries,
        "/repo",
        &["commit", "--allow-empty", "-m", "first"],
        r#"{"GIT_AUTHOR_DATE":"2023-11-15T03:43:20+05:30","GIT_COMMITTER_DATE":"2023-11-14T18:15:00-04:00"}"#,
    );
    let object = stdout(&run(
        &mut entries,
        "/repo",
        &["cat-file", "-p", "HEAD"],
        "{}",
    ));
    assert!(object.contains("1700000000 +0530"), "{object}");
    assert!(object.contains("1700000100 -0400"), "{object}");
}

#[test]
fn environment_work_tree_remains_root_after_chdir_and_flags_override_environment() {
    let mut entries = Value::Array(vec![]);
    run(&mut entries, "/repo", &["init"], "{}");
    let env = r#"{"GIT_DIR":"/repo/.git","GIT_WORK_TREE":"/repo"}"#;
    assert_eq!(
        stdout(&run(
            &mut entries,
            "/",
            &["-C", "/repo/nested", "rev-parse", "--show-toplevel"],
            env
        )),
        "/repo\n"
    );
    assert_eq!(
        stdout(&run(
            &mut entries,
            "/",
            &["--work-tree=/override", "rev-parse", "--show-toplevel"],
            env
        )),
        "/override\n"
    );
}

#[test]
fn quiet_tokens_used_as_messages_do_not_suppress_output() {
    let mut entries = Value::Array(vec![]);
    run(&mut entries, "/repo", &["init"], "{}");
    assert!(
        !stdout(&run(
            &mut entries,
            "/repo",
            &["commit", "--allow-empty", "-m", "--quiet"],
            "{}"
        ))
        .is_empty()
    );
}
