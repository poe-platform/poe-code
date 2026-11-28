use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::{collections::BTreeMap, sync::Arc};

fn run_sql(sql: &str) -> String {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
        },
    );
    let result = shell
        .exec_with_options(
            &format!("sqlite3 :memory: <<'INPUT'\n{sql}\nINPUT"),
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    result.stdout
}

#[test]
fn scalar_subquery_binds_the_current_outer_row() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(k); CREATE TABLE b(k,v); INSERT INTO a VALUES(1),(2); INSERT INTO b VALUES(2,9); SELECT k,(SELECT sum(v) FROM b WHERE b.k=a.k) FROM a ORDER BY k;"
        ),
        "1|\n2|9\n"
    );
}

#[test]
fn scalar_subquery_keeps_inner_columns_and_binds_aliases_case_insensitively() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(k,v); CREATE TABLE b(k,v); INSERT INTO a VALUES(1,100),(2,200); INSERT INTO b VALUES(2,9); SELECT k,(SELECT sum(v) FROM b WHERE b.k=OUTER_ROW.k) FROM a AS outer_row ORDER BY k;"
        ),
        "1|\n2|9\n"
    );
}

#[test]
fn scalar_subquery_does_not_replace_literals_or_identifier_prefixes() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(k); CREATE TABLE b(k,key,v); INSERT INTO a VALUES(1),(2); INSERT INTO b VALUES(2,2,'a.k'); SELECT k,(SELECT v FROM b WHERE b.key=a.k AND v='a.k') FROM a ORDER BY k; SELECT k,(SELECT v FROM b AS aa WHERE aa.key=2) FROM a ORDER BY k;"
        ),
        "1|\n2|a.k\n1|a.k\n2|a.k\n"
    );
}

#[test]
fn scalar_subquery_preserves_inner_table_shadowing() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(k); INSERT INTO a VALUES(1),(2); SELECT k,(SELECT sum(a.k) FROM a) FROM a ORDER BY k;"
        ),
        "1|3\n2|3\n"
    );
}

#[test]
fn scalar_subquery_binds_unqualified_outer_columns_when_missing_locally() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(outer_key); CREATE TABLE b(k,v); INSERT INTO a VALUES(1),(2); INSERT INTO b VALUES(2,9); SELECT outer_key,(SELECT sum(v) FROM b WHERE b.k=outer_key) FROM a ORDER BY outer_key;"
        ),
        "1|\n2|9\n"
    );
}

#[test]
fn scalar_subquery_binds_quoted_identifiers_and_escaped_text_values() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(k); CREATE TABLE b(k,v); INSERT INTO a VALUES('missing'),('O''Brien'); INSERT INTO b VALUES('O''Brien',9); SELECT k,(SELECT sum(v) FROM b WHERE b.k=\"outer_row\".\"k\") FROM a AS outer_row ORDER BY k;"
        ),
        "O'Brien|9\nmissing|\n"
    );
}

#[test]
fn correlated_exists_and_in_share_outer_row_binding() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(k); CREATE TABLE b(k); INSERT INTO a VALUES(1),(2); INSERT INTO b VALUES(2); SELECT k FROM a WHERE EXISTS (SELECT k FROM b WHERE b.k=a.k); SELECT k FROM a WHERE k IN (SELECT k FROM b WHERE b.k=a.k);"
        ),
        "2\n2\n"
    );
}

#[test]
fn nested_scalar_subquery_respects_its_own_table_scope() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(k); CREATE TABLE b(k); INSERT INTO a VALUES(1),(2); INSERT INTO b VALUES(0); SELECT k,(SELECT (SELECT sum(a.k) FROM a) FROM b) FROM a ORDER BY k;"
        ),
        "1|3\n2|3\n"
    );
}

#[test]
fn qualified_row_context_preserves_returning_column_names() {
    assert_eq!(
        run_sql(
            ".mode json\nCREATE TABLE a(k); INSERT INTO a VALUES(1),(2); DELETE FROM a WHERE k=1 RETURNING *; UPDATE a SET k=3 RETURNING *;"
        ),
        "[{\"k\":1}]\n[{\"k\":3}]\n"
    );
}

#[test]
fn empty_scalar_subquery_is_null_inside_functions() {
    assert_eq!(
        run_sql("CREATE TABLE t(n); SELECT coalesce((SELECT n FROM t),27),coalesce(NULL,27);"),
        "27|27\n"
    );
}

#[test]
fn scalar_subquery_distinguishes_null_empty_text_and_values() {
    assert_eq!(
        run_sql(
            "CREATE TABLE t(n); INSERT INTO t VALUES(NULL),(''),('  text  '),(9); SELECT coalesce((SELECT n FROM t LIMIT 1),27),ifnull((SELECT n FROM t WHERE n=99),27); SELECT coalesce((SELECT n FROM t WHERE n=''),27); SELECT coalesce((SELECT n FROM t WHERE n='  text  '),27); SELECT coalesce((SELECT n FROM t WHERE n=9),27);"
        ),
        "27|27\n\n  text  \n9\n"
    );
}

#[test]
fn correlated_empty_scalar_subquery_uses_fallback_per_row() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(k); CREATE TABLE b(k,v); INSERT INTO a VALUES(1),(2); INSERT INTO b VALUES(2,9); SELECT k,coalesce((SELECT v FROM b WHERE b.k=a.k),27) FROM a ORDER BY k;"
        ),
        "1|27\n2|9\n"
    );
}
