use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellLimits, ShellOptions};
use std::sync::Arc;

fn shell(max_loop_iterations: usize) -> Shell {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            mode: BackendMode::NativeOnly,
        },
    );
    shell.set_limits(ShellLimits {
        max_loop_iterations,
        ..ShellLimits::default()
    });
    shell
}

#[test]
fn jq_loops_complete_past_ten_thousand_iterations() {
    for (filter, expected) in [
        ("0 | until(. == 10002; .+1)", "10002\n"),
        ("[0 | while(. < 10002; .+1)] | length", "10002\n"),
    ] {
        let result = shell(ShellLimits::default().max_loop_iterations)
            .exec_with_options(
                &format!("printf %s 'null\n' | jq -c '{filter}'"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{filter}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{filter}");
        assert_eq!(result.stderr, "", "{filter}");
        assert!(!result.used_typescript_bridge);
    }
}

#[test]
fn jq_loop_budget_allows_the_terminal_condition_after_the_last_update() {
    for (budget, filter, expected) in [
        (3, "0 | until(. == 3; .+1)", "3\n"),
        (3, "[0 | while(. < 3; .+1)]", "[0,1,2]\n"),
        (0, "0 | until(. == 0; error(\"unused\"))", "0\n"),
        (0, "[0 | while(. < 0; error(\"unused\"))]", "[]\n"),
    ] {
        let result = shell(budget)
            .exec_with_options(&format!("jq -nc '{filter}'"), ExecOptions::default())
            .unwrap();
        assert_eq!(result.exit_code, 0, "{filter}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{filter}");
        assert_eq!(result.stderr, "", "{filter}");
    }
}

#[test]
fn jq_loop_budget_exhaustion_fails_and_cannot_be_caught() {
    for filter in [
        "0 | until(. == 4; .+1)",
        "0 | while(. < 4; .+1)",
        "0 | until(false; .)",
        "0 | try until(false; .) catch 42",
        "0 | until(. == 2; .+1) | until(. == 4; .+1)",
        "def step: until(. == 2; .+1); [0,0] | map(step)",
        "0 | until(. == 2; .+1 | until(. == 2; .+1)) | until(. == 4; .+1)",
    ] {
        let result = shell(3)
            .exec_with_options(&format!("jq -nc '{filter}'"), ExecOptions::default())
            .unwrap();
        assert_eq!(result.exit_code, 5, "{filter}: {result:?}");
        assert_eq!(result.stdout, "", "{filter}");
        assert_eq!(
            result.stderr, "jq: maxLoopIterations limit exceeded\n",
            "{filter}"
        );
        assert!(!result.used_typescript_bridge);
    }
}
