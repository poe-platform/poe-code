use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_window_defaults_use_current_row() {
    for (expression, expected) in [
        ("lag(n,2,k*10) OVER(ORDER BY k)", "1|10\n2|20\n3|3\n4|1\n"),
        ("lead(n,2,k*10) OVER(ORDER BY k)", "1|6\n2|1\n3|30\n4|40\n"),
        ("1+lag(n,2,k*10) OVER(ORDER BY k)", "1|11\n2|21\n3|4\n4|2\n"),
        (
            "1+lead(n,2,k*10) OVER(ORDER BY k)",
            "1|7\n2|2\n3|31\n4|41\n",
        ),
        (
            "lag(n,2,coalesce(NULL,k*10)) OVER(ORDER BY k)",
            "1|10\n2|20\n3|3\n4|1\n",
        ),
        (
            "lag(n,1,tag) OVER(PARTITION BY tag ORDER BY k)",
            "1|a\n2|3\n3|b\n4|6\n",
        ),
        (
            "1+lead(n, 2, coalesce(NULL,k*10)) OVER(ORDER BY k)",
            "1|7\n2|2\n3|31\n4|41\n",
        ),
        ("lag(n,2) OVER(ORDER BY k)", "1|\n2|\n3|3\n4|1\n"),
        (
            "lag(n,2,'fallback') OVER(ORDER BY k)",
            "1|fallback\n2|fallback\n3|3\n4|1\n",
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
