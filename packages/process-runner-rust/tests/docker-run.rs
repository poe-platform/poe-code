use process_runner_rust::docker::{self, DockerRun};
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn container_names_match_javascript_codepoint_iteration_and_empty_fallback() {
    for (input, expected) in [
        (u("node"), "poe-run-node-abcdef"),
        (u(""), "poe-run-command-abcdef"),
        (u("a b/😀é\n"), "poe-run-a-b-----abcdef"),
        (vec![0xd800, 46, 0xdfff], "poe-run--.--abcdef"),
    ] {
        assert_eq!(docker::container_name(&input, "abcdef"), u(expected));
    }
}
#[test]
fn interactive_stdio_requires_three_inherited_streams_and_true_tty() {
    for stdin in [None, Some("ignore"), Some("pipe"), Some("inherit")] {
        for stdout in [None, Some("pipe"), Some("inherit")] {
            for stderr in [None, Some("pipe"), Some("inherit")] {
                for tty in [false, true] {
                    let plan = docker::run_plan(stdin, stdout, stderr, tty);
                    assert_eq!(
                        plan.inherit,
                        stdin == Some("inherit")
                            && stdout == Some("inherit")
                            && stderr == Some("inherit")
                            && tty
                    );
                    assert_eq!(plan.interactive, matches!(stdin, Some("pipe" | "inherit")));
                    assert_eq!(
                        plan.modes,
                        [
                            stdin.unwrap_or("ignore"),
                            stdout.unwrap_or("pipe"),
                            stderr.unwrap_or("pipe")
                        ]
                        .map(str::to_owned)
                    );
                }
            }
        }
    }
}
#[test]
fn abort_overrides_zero_exit_but_waits_for_first_settlement_and_controls_container() {
    let mut run = DockerRun::new();
    assert!(run.abort());
    assert!(!run.abort());
    assert_eq!(run.finish(Some(0)), Some(1));
    assert_eq!(run.finish(Some(42)), None);
    assert!(!run.abort());
    let mut run = DockerRun::new();
    assert_eq!(run.finish(Some(42)), Some(42));
    assert!(!run.abort());
    assert_eq!(run.finish(None), None);
    assert_eq!(DockerRun::new().finish(None), Some(1));
    for (signal, expected) in [
        (None, vec![u("stop"), u("name")]),
        (Some(u("SIGTERM")), vec![u("stop"), u("name")]),
        (Some(u("SIGKILL")), vec![u("kill"), u("name")]),
        (
            Some(u("SIGINT")),
            vec![u("kill"), u("--signal=SIGINT"), u("name")],
        ),
    ] {
        assert_eq!(
            docker::control_args(&u("name"), signal.as_deref()),
            expected
        );
    }
    assert_eq!(docker::ABORT_GRACE_MS, 10_000);
    assert_eq!(docker::ABORT_FORCE_GRACE_MS, 5_000);
}
