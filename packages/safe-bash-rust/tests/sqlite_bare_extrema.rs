use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_bare_columns_follow_extremum_row() {
    for (sql, expected) in [
        (
            "CREATE TABLE t(k,n); INSERT INTO t VALUES('low',1),('high',9); SELECT k,max(n) FROM t;",
            "high|9\n",
        ),
        (
            "CREATE TABLE t(k,n); INSERT INTO t VALUES('high',9),('low',1); SELECT min(n),k FROM t;",
            "1|low\n",
        ),
        (
            "CREATE TABLE t(g,k,n); INSERT INTO t VALUES('a','low',1),('a','high',9),('b','other',3),('b','best',7); SELECT g,k,max(n),group_concat(k) FROM t GROUP BY g HAVING n>5 ORDER BY k;",
            "b|best|7|other,best\na|high|9|low,high\n",
        ),
        (
            "CREATE TABLE t(k,n); INSERT INTO t VALUES('null',NULL),('low',1),('high',9); SELECT k || '!',max(n),count(*) FROM t WHERE n<9;",
            "low!|1|1\n",
        ),
        (
            "CREATE TABLE t(k,n); INSERT INTO t VALUES('low','a'),('high','z'); SELECT k,max(n) AS largest FROM t;",
            "high|z\n",
        ),
        ("CREATE TABLE t(k,n); SELECT k,max(n) FROM t;", "|\n"),
        (
            "CREATE TABLE t(k,n); INSERT INTO t VALUES('first',1),('last',9); SELECT k,sum(n),group_concat(k) FROM t;",
            "first|10|first,last\n",
        ),
        (
            "CREATE TABLE t(k,n); INSERT INTO t VALUES('null',NULL),('low',1),('high',9),('tie',9); SELECT k,max(n),group_concat(k) FROM t;",
            "high|9|null,low,high,tie\n",
        ),
        (
            "CREATE TABLE t(g,k,n); INSERT INTO t VALUES('a','z',1),('a','b',9),('b','a',3),('b','c',7); SELECT g,max(n) FROM t GROUP BY g ORDER BY k;",
            "a|9\nb|7\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("sqlite3 :memory: <<'INPUT'\n{sql}\nINPUT"),
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
