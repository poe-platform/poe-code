use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::collections::BTreeMap;
use std::sync::Arc;

#[test]
fn sqlite_json_type_distinguishes_null_from_missing() {
    for (sql, expected) in [
        (
            r#"SELECT coalesce(json_type('{"a":null}','$.a'),'missing'),coalesce(json_type('{}','$.a'),'missing');"#,
            "null|missing\n",
        ),
        (
            r#"SELECT json_type('null'),json_type('null','$'),coalesce(json_type(NULL),'missing'),json_type('[null]','$[0]'),coalesce(json_type('[null]','$[1]'),'missing'),json_type('[null]','$[#-1]'),coalesce(json_type('[null]','$[#-2]'),'missing');"#,
            "null|null|missing|null|missing|null|missing\n",
        ),
        (
            r#"SELECT json_type('{"a":{"b":null}}','$.a.b'),coalesce(json_type('{"a":null}','$.a.b'),'missing'),coalesce(json_type('{"a":1}','$.a.b'),'missing');"#,
            "null|missing|missing\n",
        ),
        (
            r#"CREATE TABLE docs(body TEXT); INSERT INTO docs VALUES('{"a":null}'),('{}'); SELECT coalesce(json_type(body,'$.a'),'missing') FROM docs; SELECT json_type(body,'$.a'),count(*) FROM docs GROUP BY body ORDER BY body;"#,
            "null\nmissing\nnull|1\n|1\n",
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                mode: BackendMode::NativeOnly,
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
            },
        );
        let result = shell
            .exec_with_options(
                &format!("sqlite3 :memory: '{}'", sql.replace('\'', "'\"'\"'")),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{sql}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{sql}");
        assert_eq!(result.stdout, expected, "{sql}");
    }
}
