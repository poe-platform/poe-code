use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_window_filter_keeps_rows_and_filters_frame_contributions() {
    for (expression, expected) in [
        (
            "sum(n) FILTER(WHERE tag='a') OVER(ORDER BY k)",
            "1|3\n2|4\n3|4\n4|4\n",
        ),
        (
            "sum(n) FILTER(WHERE tag='b') OVER(ORDER BY k)",
            "1|\n2|\n3|6\n4|7\n",
        ),
        (
            "count(*) FILTER(WHERE tag='b') OVER(ORDER BY k)",
            "1|0\n2|0\n3|1\n4|2\n",
        ),
        (
            "sum(n) FILTER(WHERE n>1) OVER(PARTITION BY tag ORDER BY k)",
            "1|3\n2|3\n3|6\n4|6\n",
        ),
        (
            "sum(n) FILTER(WHERE tag='a') OVER(ORDER BY k ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)",
            "1|3\n2|4\n3|1\n4|\n",
        ),
        (
            "sum(n) FILTER(WHERE tag='a') OVER()",
            "1|4\n2|4\n3|4\n4|4\n",
        ),
        (
            "1+sum(n) FILTER(WHERE tag='a') OVER(ORDER BY k)",
            "1|4\n2|5\n3|5\n4|5\n",
        ),
        (
            "avg(n) FILTER(WHERE tag='a') OVER(ORDER BY k)",
            "1|3.0\n2|2.0\n3|2.0\n4|2.0\n",
        ),
        (
            "min(n) FILTER(WHERE tag='a') OVER(ORDER BY k)",
            "1|3\n2|1\n3|1\n4|1\n",
        ),
        (
            "max(n) FILTER(WHERE tag='a') OVER(ORDER BY k)",
            "1|3\n2|3\n3|3\n4|3\n",
        ),
        (
            "sum(n) filter(where coalesce(tag,'')='a') over(order by k) AS total",
            "1|3\n2|4\n3|4\n4|4\n",
        ),
        ("sum(n) FILTER(WHERE tag='a')", "1|4\n"),
        (
            "count(NULL) FILTER(WHERE tag='a') OVER(ORDER BY k)",
            "1|0\n2|0\n3|0\n4|0\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec_with_options(
            &format!("sqlite3 :memory: \"CREATE TABLE t(k INTEGER PRIMARY KEY,n INT,tag TEXT); INSERT INTO t VALUES(1,3,'a'),(2,1,'a'),(3,6,'b'),(4,1,'b'); SELECT k,{expression} FROM t ORDER BY k;\""),
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        ).unwrap();
        assert_eq!(result.exit_code, 0, "{expression}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{expression}");
        assert_eq!(result.stdout, expected, "{expression}");
    }
}
