use process_runner_rust::host::{self, KillTarget, Plan, RunState, ShellFacts, Stdio};
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn host_stdio_defaults_and_detached_admission_cover_all_stream_combinations() {
    for input in [None, Some("ignore"), Some("pipe"), Some("inherit")] {
        for output in [None, Some("pipe"), Some("inherit")] {
            for error in [None, Some("pipe"), Some("inherit")] {
                for detached in [false, true] {
                    for group in [false, true] {
                        let Plan {
                            stdio,
                            detached: actual,
                            ..
                        } = host::plan(input, output, error, detached, group, false);
                        assert_eq!(actual, detached || group);
                        let modes = [
                            input.unwrap_or("ignore"),
                            output.unwrap_or("pipe"),
                            error.unwrap_or("pipe"),
                        ];
                        assert_eq!(
                            stdio,
                            if modes == ["inherit"; 3] {
                                Stdio::Inherit
                            } else {
                                Stdio::Modes(modes.map(str::to_owned))
                            }
                        );
                    }
                }
            }
        }
    }
    assert!(host::plan(None, None, None, false, false, true).aborted);
}
#[test]
fn run_settlement_is_once_only_and_kill_groups_require_a_known_unix_pid() {
    for detached in [false, true] {
        let mut run = RunState::new(detached);
        assert_eq!(
            run.kill_target(Some(123), false),
            if detached {
                KillTarget::Group(-123)
            } else {
                KillTarget::Child
            }
        );
        assert_eq!(run.kill_target(None, false), KillTarget::Child);
        assert_eq!(run.kill_target(Some(123), true), KillTarget::Child);
        assert_eq!(run.finish(Some(42)), Some(42));
        assert_eq!(run.finish(None), None);
    }
    let mut failed = RunState::new(false);
    assert_eq!(failed.finish(None), Some(1));
    assert_eq!(failed.finish(Some(0)), None);
}
#[test]
fn shell_nullish_defaults_retain_explicit_empty_values_and_foreign_reference_choices() {
    let facts = ShellFacts {
        command: None,
        cwd: None,
        has_args: false,
        has_signal: false,
        own_env: false,
    };
    let plan = host::shell(facts, |fact| -> Result<_, ()> {
        Ok(Some(u(match fact {
            host::ShellFact::EnvShell => "/bin/custom",
            host::ShellFact::SystemShell => "/bin/system",
            host::ShellFact::DefaultCwd => "/repo",
        })))
    })
    .unwrap();
    assert_eq!(plan.command, u("/bin/custom"));
    assert_eq!(plan.cwd, Some(u("/repo")));
    assert!(!plan.own_env);
    let facts = ShellFacts {
        command: Some(vec![]),
        cwd: Some(vec![]),
        has_args: true,
        has_signal: true,
        own_env: true,
    };
    let plan = host::shell(facts, |_| -> Result<Option<Vec<u16>>, ()> {
        panic!("unused fallback read")
    })
    .unwrap();
    assert_eq!(plan.command, vec![]);
    assert_eq!(plan.cwd, Some(vec![]));
    assert!(plan.own_env && plan.has_args && plan.has_signal);
}
