use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_window_distributions() {
    for (query, expected) in [
        (
            "SELECT k,cume_dist() OVER(ORDER BY n) FROM t ORDER BY k",
            "1|0.75\n2|0.5\n3|1.0\n4|0.5\n",
        ),
        (
            "SELECT k,round(percent_rank() OVER(ORDER BY n),6) FROM t ORDER BY k",
            "1|0.666667\n2|0.0\n3|1.0\n4|0.0\n",
        ),
        (
            "SELECT k,cume_dist() OVER(PARTITION BY tag ORDER BY n),percent_rank() OVER(PARTITION BY tag ORDER BY n) FROM t ORDER BY k",
            "1|1.0|1.0\n2|0.5|0.0\n3|1.0|1.0\n4|0.5|0.0\n",
        ),
        (
            "SELECT k,cume_dist() OVER(),percent_rank() OVER() FROM t ORDER BY k",
            "1|1.0|0.0\n2|1.0|0.0\n3|1.0|0.0\n4|1.0|0.0\n",
        ),
        (
            "SELECT cume_dist() OVER(ORDER BY n),percent_rank() OVER(ORDER BY n) FROM t WHERE k=1",
            "1.0|0.0\n",
        ),
        (
            "SELECT k,cume_dist() OVER(ORDER BY n DESC ROWS BETWEEN CURRENT ROW AND CURRENT ROW) FROM t ORDER BY k",
            "1|0.5\n2|1.0\n3|0.25\n4|1.0\n",
        ),
        (
            "SELECT k,round(cume_dist() OVER(ORDER BY n),2) FROM t ORDER BY k",
            "1|0.75\n2|0.5\n3|1.0\n4|0.5\n",
        ),
        (
            "SELECT n,cume_dist() OVER(ORDER BY n),percent_rank() OVER(ORDER BY n) FROM t WHERE n<>6 GROUP BY n ORDER BY n",
            "1|0.5|0.0\n3|1.0|1.0\n",
        ),
        (
            "SELECT tag,cume_dist() OVER(ORDER BY count(*)),percent_rank() OVER(ORDER BY count(*)) FROM t GROUP BY tag ORDER BY tag",
            "a|1.0|0.0\nb|1.0|0.0\n",
        ),
        (
            "SELECT k,percent_rank() OVER(ORDER BY n ROWS BETWEEN CURRENT ROW AND CURRENT ROW) FROM t WHERE k<>3 ORDER BY k",
            "1|1.0\n2|0.0\n4|0.0\n",
        ),
        (
            "SELECT tag,rank() OVER(ORDER BY count(*)),dense_rank() OVER(ORDER BY count(*)),row_number() OVER(ORDER BY tag) FROM t GROUP BY tag ORDER BY tag",
            "a|1|1|1\nb|1|1|2\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec_with_options(
            &format!("sqlite3 :memory: <<'SQL'\nCREATE TABLE t(k INTEGER PRIMARY KEY,n INT,tag TEXT); INSERT INTO t VALUES(1,3,'a'),(2,1,'a'),(3,6,'b'),(4,1,'b'); {query};\nSQL"),
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        ).unwrap();
        assert_eq!(result.exit_code, 0, "{query}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{query}");
        assert_eq!(result.stderr, "");
    }
}
