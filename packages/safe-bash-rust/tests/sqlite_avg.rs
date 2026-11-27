use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_avg_coerces_non_null_text() {
    for (values, expression, expected) in [
        ("('none'),(8)", "avg(n)", "4.0\n"),
        ("('none'),(''),(NULL)", "avg(n)", "0.0\n"),
        ("(NULL),(NULL)", "avg(n)", "\n"),
        ("('none'),(8),(NULL)", "avg(n)", "4.0\n"),
        ("('none'),('none'),(8)", "avg(DISTINCT n)", "4.0\n"),
        ("(' 12tail'),('4e1tail')", "avg(n)", "26.0\n"),
        ("('2e+tail'),('-.5tail')", "avg(n)", "0.75\n"),
        ("('NaN'),('Infinity'),(9)", "avg(n)", "3.0\n"),
        ("(2),(8)", "avg(n)", "5.0\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!(
                    "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(n); INSERT INTO t VALUES{values}; SELECT {expression} FROM t;\nINPUT"
                ),
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
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected, "{expression} over {values}");
        assert_eq!(result.stderr, "");
    }
}
