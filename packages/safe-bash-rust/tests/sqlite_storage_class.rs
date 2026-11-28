use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_untyped_columns_preserve_numeric_text() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec_with_options(
        "sqlite3 :memory: 'CREATE TABLE t(v); INSERT INTO t VALUES('\"'\"'0012'\"'\"'),(12); SELECT typeof(v),v FROM t ORDER BY rowid;'",
        ExecOptions {
            cwd: Some("/".into()),
            env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
            ..Default::default()
        },
    ).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "text|0012\ninteger|12\n");
    assert_eq!(result.stderr, "");
}

#[test]
fn sqlite_numeric_text_survives_storage_and_value_expressions() {
    let (mut shell, _) = Shell::with_memory_fs();
    for (sql, expected) in [
        (
            "CREATE TABLE t(v); INSERT INTO t VALUES('0012'),(12),('12'),('1.5'),(1.5); SELECT typeof(v),quote(v) FROM t;",
            "text|'0012'\ninteger|12\ntext|'12'\ntext|'1.5'\nreal|1.5\n",
        ),
        (
            "SELECT typeof(v),quote(v) FROM t;",
            "text|'0012'\ninteger|12\ntext|'12'\ntext|'1.5'\nreal|1.5\n",
        ),
        (
            "SELECT v+1,length(v),substr(v,1,2),typeof(coalesce(v,0)),typeof((v)) FROM t LIMIT 1;",
            "13|4|00|text|text\n",
        ),
        (
            "CREATE TABLE copy(v); INSERT INTO copy SELECT v FROM t; SELECT typeof(v),v FROM copy;",
            "text|0012\ninteger|12\ntext|12\ntext|1.5\nreal|1.5\n",
        ),
        (
            "UPDATE copy SET v='0042'; SELECT DISTINCT typeof(v),v FROM copy;",
            "text|0042\n",
        ),
        (
            "CREATE TABLE defaults(v DEFAULT '0012'); INSERT INTO defaults DEFAULT VALUES; SELECT typeof(v),v FROM defaults;",
            "text|0012\n",
        ),
        (
            "CREATE TABLE affinity(t TEXT,n INTEGER,b BLOB); INSERT INTO affinity VALUES(12,'0012','0012'); SELECT typeof(t),t,typeof(n),n,typeof(b),b FROM affinity;",
            "text|12|integer|12|text|0012\n",
        ),
    ] {
        let result = shell
            .exec(&format!("sqlite3 /types.db <<'SQL'\n{sql}\nSQL"))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{sql}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{sql}");
        assert_eq!(result.stderr, "");
    }
    let result = shell
        .exec("sqlite3 -json /types.db 'SELECT v FROM t LIMIT 3'")
        .unwrap();
    assert_eq!(
        result.stdout,
        "[{\"v\":\"0012\"},\n{\"v\":12},\n{\"v\":\"12\"}]\n"
    );
}

#[test]
fn sqlite_numeric_text_is_decoded_in_output_and_sql_substitution() {
    let (mut shell, _) = Shell::with_memory_fs();
    for (sql, expected) in [
        (
            "CREATE TABLE t(v); INSERT INTO t VALUES('0012') RETURNING v,typeof(v);",
            "0012|text\n",
        ),
        (
            "SELECT json_array(v),json_quote(v),json_object('v',v) FROM t;",
            "[\"0012\"]|\"0012\"|{\"v\":\"0012\"}\n",
        ),
        (
            "CREATE TABLE audit(v); CREATE TRIGGER log AFTER INSERT ON t BEGIN INSERT INTO audit VALUES(NEW.v); END; INSERT INTO t VALUES('0042'); SELECT typeof(v),v FROM audit;",
            "text|0042\n",
        ),
        (
            "SELECT v,(SELECT typeof(t.v)) FROM t;",
            "0012|text\n0042|text\n",
        ),
    ] {
        let result = shell
            .exec(&format!("sqlite3 /output.db <<'SQL'\n{sql}\nSQL"))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{sql}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{sql}");
    }
    for (option, sql, expected) in [
        ("-quote", "SELECT v FROM t", "'0012'\n'0042'\n"),
        ("-csv", "SELECT v FROM t", "0012\n0042\n"),
        (
            "-json",
            "INSERT INTO t VALUES('007') RETURNING v",
            "[{\"v\":\"007\"}]\n",
        ),
    ] {
        let result = shell
            .exec(&format!("sqlite3 {option} /output.db \"{sql}\""))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected);
    }
    let result = shell.exec("sqlite3 /output.db .dump").unwrap();
    assert!(
        result.stdout.contains("VALUES ('0012')"),
        "{}",
        result.stdout
    );
    assert!(!result.stdout.contains('\0'));
}
