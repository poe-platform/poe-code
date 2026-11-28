use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_untyped_column_preserves_numeric_looking_text() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            "sqlite3 :memory: <<'SQL'\nCREATE TABLE t(v); INSERT INTO t VALUES('0012'),(12); SELECT typeof(v),v FROM t ORDER BY rowid;\nSQL",
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "text|0012\ninteger|12\n");
}

#[test]
fn sqlite_text_storage_survives_queries_updates_and_reopens() {
    let (mut shell, _) = Shell::with_memory_fs();
    for (sql, expected) in [
        (
            "CREATE TABLE t(id INTEGER PRIMARY KEY,v); INSERT INTO t VALUES(1,'0012'),(2,'12'),(3,12),(4,'1.5'),(5,1.5),(6,NULL),(7,''); SELECT typeof(v),v,quote(v) FROM t ORDER BY rowid;",
            "text|0012|'0012'\ntext|12|'12'\ninteger|12|12\ntext|1.5|'1.5'\nreal|1.5|1.5\nnull||NULL\ntext||''\n",
        ),
        (
            "SELECT typeof(v),v,quote(v) FROM t ORDER BY rowid;",
            "text|0012|'0012'\ntext|12|'12'\ninteger|12|12\ntext|1.5|'1.5'\nreal|1.5|1.5\nnull||NULL\ntext||''\n",
        ),
        (
            "SELECT v,length(v),v+1,typeof(coalesce(v,0)) FROM t WHERE typeof(v)='text' ORDER BY rowid;",
            "0012|4|13|text\n12|2|13|text\n1.5|3|2.5|text\n|0|1|text\n",
        ),
        (
            "CREATE TABLE copies(v); INSERT INTO copies SELECT v FROM t; SELECT typeof(v),v FROM copies ORDER BY rowid;",
            "text|0012\ntext|12\ninteger|12\ntext|1.5\nreal|1.5\nnull|\ntext|\n",
        ),
        (
            "UPDATE t SET v='0034' WHERE id=3; SELECT typeof(v),v FROM t WHERE id=3;",
            "text|0034\n",
        ),
        (
            "SELECT typeof(v),v FROM t WHERE id=3; UPDATE t SET v=34 WHERE id=3; SELECT typeof(v),v FROM t WHERE id=3;",
            "text|0034\ninteger|34\n",
        ),
    ] {
        let result = shell
            .exec_with_options(
                "sqlite3 /text.db",
                ExecOptions {
                    stdin: Some(sql.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{sql}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{sql}");
        assert_eq!(result.stdout, expected, "{sql}");
    }
}

#[test]
fn sqlite_text_storage_respects_column_affinity() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: <<'SQL'\nCREATE TABLE t(none, blob BLOB, text TEXT, num NUMERIC); INSERT INTO t VALUES('0012','0012',12,'0012'); SELECT typeof(none),none,typeof(blob),blob,typeof(text),text,typeof(num),num FROM t;\nSQL").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "text|0012|text|0012|text|12|integer|12\n");
}

#[test]
fn sqlite_text_storage_is_formatted_without_internal_tags() {
    for (mode, expected) in [
        ("list", "12\n12\n"),
        ("csv", "12\n12\n"),
        ("json", "[{\"v\":\"12\"},\n{\"v\":12}]\n"),
        ("quote", "'12'\n12\n"),
        (
            "insert copy",
            "INSERT INTO copy VALUES('12');\nINSERT INTO copy VALUES(12);\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec_with_options("sqlite3 :memory:", ExecOptions {
            stdin: Some(format!("CREATE TABLE t(v); INSERT INTO t VALUES('12'),(12);\n.mode {mode}\nSELECT v FROM t ORDER BY rowid;")),
            ..Default::default()
        }).unwrap();
        assert_eq!(result.exit_code, 0, "{mode}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{mode}");
    }
}

#[test]
fn sqlite_text_storage_keeps_foreign_key_matches_and_cascades() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: <<'SQL'\nPRAGMA foreign_keys=ON; CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id TEXT REFERENCES parent(id) ON UPDATE CASCADE ON DELETE CASCADE); INSERT INTO parent VALUES(12); INSERT INTO child VALUES('12'); UPDATE parent SET id=34; SELECT typeof(id),id FROM child; DELETE FROM parent; SELECT count(*) FROM child;\nSQL").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "text|34\n0\n");
}

#[test]
fn sqlite_text_storage_survives_defaults_triggers_and_derived_tables() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 :memory: <<'SQL'\nCREATE TABLE t(v DEFAULT '0012'); CREATE TABLE audit(v); CREATE TRIGGER copy AFTER INSERT ON t BEGIN INSERT INTO audit VALUES(NEW.v); END; INSERT INTO t DEFAULT VALUES; INSERT INTO t VALUES(CAST(12 AS TEXT)); SELECT typeof(v),v FROM audit; CREATE TABLE copies AS SELECT v FROM t; SELECT typeof(v),v FROM copies; SELECT typeof(v),v FROM (SELECT v FROM t);\nSQL").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(
        result.stdout,
        "text|0012\ntext|12\ntext|0012\ntext|12\ntext|0012\ntext|12\n"
    );
}
