use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_window_distributions_match_peers_through_shell() {
    for (query, expected) in [
        (
            "SELECT k,cume_dist() OVER(ORDER BY n) FROM t ORDER BY k",
            "1|0.75\n2|0.5\n3|1.0\n4|0.5\n",
        ),
        (
            "SELECT k,percent_rank() OVER(ORDER BY n) FROM t ORDER BY k",
            "1|0.666666666666667\n2|0.0\n3|1.0\n4|0.0\n",
        ),
        (
            "SELECT k,cume_dist() OVER(PARTITION BY tag ORDER BY n),percent_rank() OVER(PARTITION BY tag ORDER BY n) FROM t ORDER BY k",
            "1|1.0|1.0\n2|0.5|0.0\n3|1.0|1.0\n4|0.5|0.0\n",
        ),
        (
            "SELECT k,cume_dist() OVER(ORDER BY n DESC),percent_rank() OVER(ORDER BY n DESC) FROM t ORDER BY k",
            "1|0.5|0.333333333333333\n2|1.0|0.666666666666667\n3|0.25|0.0\n4|1.0|0.666666666666667\n",
        ),
        (
            "SELECT k,cume_dist() OVER(),percent_rank() OVER() FROM t ORDER BY k",
            "1|1.0|0.0\n2|1.0|0.0\n3|1.0|0.0\n4|1.0|0.0\n",
        ),
        (
            "SELECT k,cume_dist() OVER(PARTITION BY k ORDER BY n),percent_rank() OVER(PARTITION BY k ORDER BY n) FROM t ORDER BY k",
            "1|1.0|0.0\n2|1.0|0.0\n3|1.0|0.0\n4|1.0|0.0\n",
        ),
        (
            "SELECT k,cume_dist() OVER(ORDER BY n ROWS BETWEEN CURRENT ROW AND CURRENT ROW),percent_rank() OVER(ORDER BY n ROWS BETWEEN CURRENT ROW AND CURRENT ROW) FROM t ORDER BY k",
            "1|0.75|0.666666666666667\n2|0.5|0.0\n3|1.0|1.0\n4|0.5|0.0\n",
        ),
        (
            "SELECT k,cume_dist() OVER(ORDER BY n,tag),percent_rank() OVER(ORDER BY n,tag) FROM t ORDER BY k",
            "1|0.75|0.666666666666667\n2|0.25|0.0\n3|1.0|1.0\n4|0.5|0.333333333333333\n",
        ),
        (
            "SELECT k,round(cume_dist() OVER(ORDER BY n),2),round(percent_rank() OVER(ORDER BY n),2) FROM t ORDER BY k",
            "1|0.75|0.67\n2|0.5|0.0\n3|1.0|1.0\n4|0.5|0.0\n",
        ),
        (
            "SELECT k,cume_dist() OVER(ORDER BY n),percent_rank() OVER(ORDER BY n) FROM t WHERE k=99",
            "",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!(
                    "sqlite3 :memory: <<'SQL'\nCREATE TABLE t(k INTEGER PRIMARY KEY,n INT,tag TEXT); INSERT INTO t VALUES(1,3,'a'),(2,1,'a'),(3,6,'b'),(4,1,'b'); {query};\nSQL"
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
        assert_eq!(result.exit_code, 0, "{query}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{query}");
        assert!(!result.used_typescript_bridge, "{query}");
        assert_eq!(result.stdout, expected, "{query}");
    }
}

#[test]
fn sqlite_window_distributions_rank_grouped_rows() {
    for (window, expected) in [
        (
            "ORDER BY SUM(n)",
            "1|0.75|0.666666666666667\n2|0.5|0.0\n3|1.0|1.0\n4|0.5|0.0\n",
        ),
        (
            "ORDER BY SUM(n) DESC",
            "1|0.5|0.333333333333333\n2|1.0|0.666666666666667\n3|0.25|0.0\n4|1.0|0.666666666666667\n",
        ),
        (
            "ORDER BY SUM(n) ROWS BETWEEN CURRENT ROW AND CURRENT ROW",
            "1|0.75|0.666666666666667\n2|0.5|0.0\n3|1.0|1.0\n4|0.5|0.0\n",
        ),
        ("", "1|1.0|0.0\n2|1.0|0.0\n3|1.0|0.0\n4|1.0|0.0\n"),
        (
            "PARTITION BY k ORDER BY SUM(n)",
            "1|1.0|0.0\n2|1.0|0.0\n3|1.0|0.0\n4|1.0|0.0\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!("sqlite3 :memory: 'CREATE TABLE t(k,n); INSERT INTO t VALUES(1,2),(1,1),(2,1),(3,6),(4,1); SELECT k,cume_dist() OVER({window}),percent_rank() OVER({window}) FROM t GROUP BY k ORDER BY k;'")).unwrap();
        assert_eq!(result.exit_code, 0, "{window}: {}", result.stderr);
        assert_eq!(result.stderr, "");
        assert!(!result.used_typescript_bridge);
        assert_eq!(result.stdout, expected, "{window}");
    }
}

#[test]
fn sqlite_window_distributions_treat_nulls_and_equal_numbers_as_peers() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: 'CREATE TABLE t(k,n); INSERT INTO t VALUES(1,NULL),(2,1),(3,1.0),(4,NULL),(5,2); SELECT k,cume_dist() OVER(ORDER BY n),percent_rank() OVER(ORDER BY n) FROM t ORDER BY k;'").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert!(!result.used_typescript_bridge);
    assert_eq!(
        result.stdout,
        "1|0.4|0.0\n2|0.8|0.5\n3|0.8|0.5\n4|0.4|0.0\n5|1.0|1.0\n"
    );
}
