use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn csvjoin_compares_inferred_datetimes_as_instants() {
    for (options, left, right, expected) in [
        (
            "",
            "2024-01-01T00:00:00Z,one\n",
            "2023-12-31T19:00:00-05:00,matched\n",
            "2024-01-01T00:00:00+00:00,one,matched\n",
        ),
        (
            "",
            "2024-01-01T00:00:00.123456Z,one\n",
            "2024-01-01T05:30:00.123456+05:30,matched\n",
            "2024-01-01T00:00:00.123456+00:00,one,matched\n",
        ),
        (
            "",
            "2024-01-01T00:00:00Z,one\n",
            "2024-01-01T00:00:00-05:00,other\n",
            "",
        ),
        (
            "",
            "2024-01-01T00:00:00Z,one\n",
            "2024-01-01T00:00:00,naive\n",
            "",
        ),
        (
            "-I",
            "2024-01-01T00:00:00Z,one\n",
            "2023-12-31T19:00:00-05:00,matched\n",
            "",
        ),
        (
            "--no-inference",
            "2024-01-01T00:00:00Z,one\n",
            "2024-01-01T00:00:00Z,matched\n",
            "2024-01-01T00:00:00Z,one,matched\n",
        ),
        (
            "--left",
            "2024-01-01T00:00:00Z,one\n2024-01-02T00:00:00Z,two\n",
            "2023-12-31T19:00:00-05:00,matched\n",
            "2024-01-01T00:00:00+00:00,one,matched\n2024-01-02T00:00:00+00:00,two,\n",
        ),
        (
            "",
            "2024-01-01T00:00:00.123456Z,one\n",
            "2023-12-31T19:00:00.123457-05:00,other\n",
            "",
        ),
        ("", "2024-01-01,one\n", "2024-01-01T00:00:00,other\n", ""),
        (
            "",
            "2024-01-01T00:00:00Z,one\ntext,two\n",
            "2023-12-31T19:00:00-05:00,matched\ntext,three\n",
            "text,two,three\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec_with_options(
            &format!("printf %s 'id,left\n{left}' > a.csv\nprintf %s 'id,right\n{right}' > b.csv\ncsvjoin {options} -c id a.csv b.csv"),
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        ).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stderr, "");
        assert_eq!(
            result.stdout,
            format!("id,left,right\n{expected}"),
            "{options}: {left} / {right}"
        );
    }
}
