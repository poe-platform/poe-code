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
fn sqlite_natural_join_matches_all_shared_columns() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(x,y); CREATE TABLE b(x,y); INSERT INTO a VALUES(1,1),(1,2); INSERT INTO b VALUES(1,2); SELECT count(*) FROM a NATURAL JOIN b;"
        ),
        "1\n"
    );
}

#[test]
fn sqlite_natural_join_keys_aliases_nulls_and_cross_product() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(x,y); CREATE TABLE b(Y,X); CREATE TABLE c(z); INSERT INTO a VALUES(1,1),(1,2),(1,NULL); INSERT INTO b VALUES(2,1),(NULL,1); INSERT INTO c VALUES(3),(4); SELECT * FROM a AS l NATURAL JOIN b AS r; SELECT l.x,l.y,r.Y FROM a AS l NATURAL LEFT JOIN b AS r; SELECT count(*) FROM a NATURAL JOIN c;"
        ),
        "1|2\n1|1|\n1|2|2\n1||\n6\n"
    );
}

#[test]
fn sqlite_join_using_suppresses_duplicate_key() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(k,v); CREATE TABLE b(k,w); INSERT INTO a VALUES(1,'one'); INSERT INTO b VALUES(1,'two'); SELECT * FROM a JOIN b USING(k);"
        ),
        "1|one|two\n"
    );
}

#[test]
fn sqlite_join_using_preserves_explicit_keys_and_on_columns() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(k,v); CREATE TABLE b(k,w); INSERT INTO a VALUES(1,'one'),(2,'other'); INSERT INTO b VALUES(1,'two'); SELECT a.k,b.k,v,w FROM a LEFT JOIN b USING(k); SELECT * FROM a JOIN b ON a.k=b.k;"
        ),
        "1|1|one|two\n2||other|\n1|one|1|two\n"
    );
}

#[test]
fn sqlite_join_using_multiple_keys_and_chained_joins() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(k,n,v); CREATE TABLE b(k,n,w); CREATE TABLE c(k,z); INSERT INTO a VALUES(1,2,'one'); INSERT INTO b VALUES(1,3,'wrong'),(1,2,'two'); INSERT INTO c VALUES(1,'three'); SELECT * FROM a AS x JOIN b AS y USING(k,n) JOIN c USING(k);"
        ),
        "1|2|one|two|three\n"
    );
}

#[test]
fn sqlite_join_using_left_join_headers_and_view() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(k,v); CREATE TABLE b(k,w); INSERT INTO a VALUES(1,'one'),(2,'other'); INSERT INTO b VALUES(1,'two'); CREATE VIEW joined AS SELECT * FROM a LEFT JOIN b USING(k); SELECT * FROM joined;"
        ),
        "1|one|two\n2|other|\n"
    );
}
