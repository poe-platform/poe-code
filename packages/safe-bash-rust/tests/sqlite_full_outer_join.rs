use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_full_outer_join_retains_unmatched_rows() {
    for (sql, expected) in [
        (
            "INSERT INTO a VALUES(1),(2); INSERT INTO b VALUES(2),(3); SELECT coalesce(a.k,b.k) FROM a FULL OUTER JOIN b ON a.k=b.k ORDER BY 1;",
            "1\n2\n3\n",
        ),
        (
            "INSERT INTO b VALUES(3),(3); SELECT a.k,b.k FROM a FULL OUTER JOIN b ON a.k=b.k;",
            "|3\n|3\n",
        ),
        (
            "INSERT INTO a VALUES(1),(1); SELECT a.k,b.k FROM a FULL JOIN b ON a.k=b.k;",
            "1|\n1|\n",
        ),
        ("SELECT a.k,b.k FROM a FULL OUTER JOIN b ON a.k=b.k;", ""),
        (
            "INSERT INTO a VALUES(1),(2),(2); INSERT INTO b VALUES(2),(2),(3); SELECT x.k,y.k FROM a AS x FULL JOIN b AS y ON x.k=y.k;",
            "1|\n2|2\n2|2\n2|2\n2|2\n|3\n",
        ),
        (
            "INSERT INTO a VALUES(1); INSERT INTO b VALUES(3); SELECT a.k,b.k FROM a FULL OUTER JOIN b ON a.k=b.k;",
            "1|\n|3\n",
        ),
        (
            "INSERT INTO a VALUES(NULL),(1); INSERT INTO b VALUES(NULL),(1); SELECT a.k,b.k FROM a FULL OUTER JOIN b ON a.k=b.k;",
            "|\n1|1\n|\n",
        ),
        (
            "INSERT INTO a VALUES(1),(2); INSERT INTO b VALUES(2),(3); SELECT a.k,b.k FROM a LEFT JOIN b ON a.k=b.k; SELECT a.k,b.k FROM a INNER JOIN b ON a.k=b.k;",
            "1|\n2|2\n2|2\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!(
                    "sqlite3 :memory: <<'INPUT'\nCREATE TABLE a(k); CREATE TABLE b(k); {sql}\nINPUT"
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
        assert_eq!(result.stdout, expected, "{sql}");
        assert_eq!(result.stderr, "");
    }
}
