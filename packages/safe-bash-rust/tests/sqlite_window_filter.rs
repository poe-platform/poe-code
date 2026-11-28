use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_window_filter_keeps_rows_and_filters_frame_contributions() {
    for (query, expected) in [
        (
            "SELECT k,sum(n) FILTER(WHERE tag='a') OVER(ORDER BY k) FROM t ORDER BY k",
            "1|3\n2|4\n3|4\n4|4\n",
        ),
        (
            "SELECT k,round(sum(n) FILTER (WHERE tag='a') OVER(ORDER BY k),1) FROM t ORDER BY k",
            "1|3.0\n2|4.0\n3|4.0\n4|4.0\n",
        ),
        (
            "SELECT k,sum(n+1) filter(where(tag='a')) over(order by k) FROM t ORDER BY k",
            "1|4\n2|6\n3|6\n4|6\n",
        ),
        (
            "SELECT k,sum(n) FILTER (WHERE tag='b') OVER (ORDER BY k) FROM t ORDER BY k",
            "1|\n2|\n3|6\n4|7\n",
        ),
        (
            "SELECT k,sum(n) FILTER(WHERE tag='a') OVER(PARTITION BY tag ORDER BY k) FROM t ORDER BY k",
            "1|3\n2|4\n3|\n4|\n",
        ),
        (
            "SELECT k,sum(n) FILTER(WHERE tag='a') OVER(ORDER BY n) FROM t ORDER BY k",
            "1|4\n2|1\n3|4\n4|1\n",
        ),
        (
            "SELECT k,sum(n) FILTER(WHERE tag='a') OVER(ORDER BY k ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) FROM t ORDER BY k",
            "1|3\n2|4\n3|1\n4|\n",
        ),
        (
            "SELECT k,sum(n) FILTER(WHERE tag='a') OVER(),count(*) FILTER(WHERE tag='b') OVER(),avg(n) FILTER(WHERE tag='a') OVER(),min(n) FILTER(WHERE tag='b') OVER(),max(n) FILTER(WHERE tag='b') OVER() FROM t ORDER BY k",
            "1|4|2|2.0|1|6\n2|4|2|2.0|1|6\n3|4|2|2.0|1|6\n4|4|2|2.0|1|6\n",
        ),
        (
            "SELECT k,sum(n) FILTER(WHERE tag != ')') OVER(ORDER BY k) FROM t ORDER BY k",
            "1|3\n2|4\n3|10\n4|11\n",
        ),
        (
            "SELECT sum(n) FILTER(WHERE (tag='a')),count(*) FILTER(WHERE tag='b') FROM t",
            "4|2\n",
        ),
        (
            "SELECT k,count(*) FILTER(WHERE NULL) OVER(ORDER BY k),sum(n) FILTER(WHERE 0) OVER(ORDER BY k) FROM t ORDER BY k",
            "1|0|\n2|0|\n3|0|\n4|0|\n",
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
        assert_eq!(result.stderr, "", "{query}");
        assert!(!result.used_typescript_bridge, "{query}");
        assert_eq!(result.stdout, expected, "{query}");
    }
}

#[test]
fn sqlite_filtered_windows_propagate_integer_overflow() {
    for expression in [
        "sum(n) FILTER(WHERE n>0) OVER()",
        "round(sum(n) FILTER(WHERE n>0) OVER(),1)",
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec(&format!(
                "sqlite3 :memory: 'CREATE TABLE t(n); INSERT INTO t VALUES(9223372036854775807),(1); SELECT {expression} FROM t;'"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 1, "{expression}: {}", result.stderr);
        assert!(
            result.stderr.contains("integer overflow"),
            "{expression}: {}",
            result.stderr
        );
        assert_eq!(result.stdout, "", "{expression}");
        assert!(!result.used_typescript_bridge);
    }
}

#[test]
fn sqlite_window_filter_preserves_aggregate_controls() {
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
