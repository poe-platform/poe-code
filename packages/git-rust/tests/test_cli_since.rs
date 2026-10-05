use git_rust::{MemoryFs, environment::EnvironmentScope, execute_git_cli};
use std::collections::BTreeMap;

fn run(fs: &MemoryFs, args: &[&str]) -> String {
    let result = execute_git_cli(fs, "/repo", args);
    assert_eq!(result.exit_code, 0, "{args:?}: {}", result.stderr);
    result.stdout
}

fn history() -> MemoryFs {
    let fs = MemoryFs::new();
    run(&fs, &["init", "-b", "main"]);
    run(&fs, &["config", "user.name", "Tester"]);
    run(&fs, &["config", "user.email", "test@example.com"]);
    // A newer ancestor behind an old commit exercises traversal cutoff.
    for (name, stamp) in [
        ("ancestor", 1800000300),
        ("old", 1800000000),
        ("boundary", 1800000100),
        ("tip", 1800000200),
    ] {
        let _scope = EnvironmentScope::new(BTreeMap::from([
            ("GIT_COMMITTER_DATE".into(), format!("{stamp} +0000")),
            ("GIT_AUTHOR_DATE".into(), "1000000000 +0000".into()),
        ]));
        fs.write_str("/repo/file", name);
        run(&fs, &["add", "."]);
        run(&fs, &["commit", "-m", name]);
    }
    fs
}

#[test]
fn since_includes_boundary_and_stops_before_old_ancestors() {
    let fs = history();
    for flags in [
        vec!["--since=@1800000100"],
        vec!["--after", "1800000100 +0000"],
        vec!["--since", "2027-01-15T08:01:40Z"],
        vec!["--since=@1800000100", "--first-parent"],
        vec!["--since=@1800000100", "HEAD~3..HEAD"],
        vec!["--since=@1800000100", "--", "file"],
        vec!["--since=@1800000100", "--follow", "--", "file"],
    ] {
        let mut args = vec!["log", "--format=%s"];
        args.extend(flags);
        assert_eq!(run(&fs, &args), "tip\nboundary\n");
    }
    assert_eq!(
        run(
            &fs,
            &[
                "log",
                "--format=%s",
                "--since=@1800000100",
                "--skip=1",
                "-1",
                "--reverse"
            ]
        ),
        "boundary\n"
    );
}

#[test]
fn since_as_filter_visits_ancestors_and_relative_dates_use_request_clock() {
    let fs = history();
    assert_eq!(
        run(
            &fs,
            &["log", "--format=%s", "--since-as-filter=@1800000100"]
        ),
        "tip\nboundary\nancestor\n"
    );
    for refs in ["--all", "--branches"] {
        assert_eq!(
            run(
                &fs,
                &["log", "--format=%s", "--since-as-filter=@1800000100", refs]
            ),
            "tip\nboundary\nancestor\n"
        );
    }
    let _scope = EnvironmentScope::new(BTreeMap::from([(
        "POE_GIT_TIMESTAMP".into(),
        "1800036100".into(),
    )]));
    assert_eq!(
        run(&fs, &["log", "--format=%s", "--since=10 hours ago"]),
        "tip\nboundary\n"
    );
}
