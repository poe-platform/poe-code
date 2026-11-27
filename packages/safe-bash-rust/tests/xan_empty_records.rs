use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn xan_agg_counts_quoted_empty_record() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            "xan agg 'count(n),count()' <<'INPUT'\nn\na\n\"\"\nb\nINPUT",
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "count(n),count()\n2,3\n");
    assert_eq!(result.stderr, "");
}

#[test]
fn xan_distinguishes_empty_records_from_blank_lines() {
    for (input, populated, total) in [
        ("n\na\nb\n\"\"", 2, 3),
        ("n\r\na\r\n\"\"\r\nb\r\n", 2, 3),
        ("n\n\n\"\"\n\n\"\"\n", 0, 2),
        ("n\na\n\nb\n", 2, 2),
        ("n\n\n", 0, 0),
        ("n", 0, 0),
        ("n\n\"\"", 0, 1),
    ] {
        for (command, expected) in [
            (
                "xan agg 'count(n),count()'",
                format!("count(n),count()\n{populated},{total}\n"),
            ),
            ("xan count", format!("{total}\n")),
        ] {
            let (mut shell, _) = Shell::with_memory_fs();
            let result = shell
                .exec_with_options(
                    command,
                    ExecOptions {
                        cwd: Some("/".into()),
                        stdin: Some(input.into()),
                        env: BTreeMap::from([
                            ("LC_ALL".into(), "C".into()),
                            ("TZ".into(), "UTC".into()),
                        ]),
                        ..Default::default()
                    },
                )
                .unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            assert_eq!(result.stdout, expected, "{command}, input: {input:?}");
            assert_eq!(result.stderr, "");
        }
    }
}
