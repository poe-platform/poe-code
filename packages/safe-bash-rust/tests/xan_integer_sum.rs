use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn xan_sum_preserves_integer_precision() {
    for (command, input, expected) in [
        (
            "agg 'sum(n)'",
            "n\n9007199254740993\n2\n",
            "sum(n)\n9007199254740995\n",
        ),
        (
            "agg 'sum(n)'",
            "n\n-9007199254740993\n-2\n",
            "sum(n)\n-9007199254740995\n",
        ),
        (
            "agg 'sum(n)'",
            "n\n9223372036854775806\n1\n",
            "sum(n)\n9223372036854775807\n",
        ),
        (
            "agg 'sum(n)'",
            "n\n9223372036854775807\n1\n-1\n",
            "sum(n)\n9223372036854775807\n",
        ),
        (
            "groupby key 'sum(n)'",
            "key,n\na,9007199254740993\na,2\nb,3\n",
            "key,sum(n)\na,9007199254740995\nb,3\n",
        ),
        ("agg 'sum(n)'", "n\n1.5\n2\n", "sum(n)\n3.5\n"),
        ("agg 'sum(n)'", "n\n2\n1.5\n", "sum(n)\n3.5\n"),
        ("agg 'sum(n)'", "n\n", "sum(n)\n0\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("xan {command} <<'INPUT'\n{input}INPUT\n"),
                ExecOptions {
                    cwd: Some("/".into()),
                    env: BTreeMap::from([
                        ("LC_ALL".into(), "C".into()),
                        ("TZ".into(), "UTC".into()),
                    ]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{command}");
        assert_eq!(result.stdout, expected, "{command}: {input}");
    }
}
