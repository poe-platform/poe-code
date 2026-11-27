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
fn natural_join_matches_every_shared_column() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(x,y); CREATE TABLE b(x,y); INSERT INTO a VALUES(1,1),(1,2); INSERT INTO b VALUES(1,2); SELECT count(*) FROM a NATURAL JOIN b;"
        ),
        "1\n"
    );
}

#[test]
fn natural_join_matches_names_regardless_of_column_order_and_case() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(x,y,v); CREATE TABLE b(Y,X,w); INSERT INTO a VALUES(1,2,'left'); INSERT INTO b VALUES(2,1,'right'),(3,1,'wrong'); SELECT * FROM a AS l NATURAL INNER JOIN b AS r; SELECT l.x,r.X FROM a AS l NATURAL JOIN b AS r;"
        ),
        "1|2|left|right\n1|1\n"
    );
}

#[test]
fn natural_join_without_shared_columns_is_a_cross_join() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(x); CREATE TABLE b(y); INSERT INTO a VALUES(1),(2); INSERT INTO b VALUES(3),(4); SELECT count(*) FROM a NATURAL JOIN b;"
        ),
        "4\n"
    );
}

#[test]
fn natural_join_does_not_match_null_keys() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(x,y); CREATE TABLE b(x,y); INSERT INTO a VALUES(1,NULL),(NULL,2),(1,2); INSERT INTO b VALUES(1,NULL),(NULL,2),(1,2); SELECT count(*) FROM a NATURAL JOIN b;"
        ),
        "1\n"
    );
}

#[test]
fn natural_left_join_preserves_unmatched_rows() {
    for join in ["NATURAL LEFT JOIN", "NATURAL LEFT OUTER JOIN"] {
        assert_eq!(
            run_sql(&format!(
                "CREATE TABLE a(x,y); CREATE TABLE b(x,y,w); INSERT INTO a VALUES(1,1),(1,2); INSERT INTO b VALUES(1,2,'match'); SELECT * FROM a {join} b ORDER BY a.y;"
            )),
            "1|1|\n1|2|match\n",
            "{join}"
        );
    }
}

#[test]
fn natural_join_recomputes_shared_columns_for_each_join() {
    assert_eq!(
        run_sql(
            "CREATE TABLE a(x,y); CREATE TABLE b(x,y,z); CREATE TABLE c(z,y); INSERT INTO a VALUES(1,2); INSERT INTO b VALUES(1,2,3); INSERT INTO c VALUES(3,2),(3,4); SELECT * FROM a NATURAL JOIN b NATURAL CROSS JOIN c;"
        ),
        "1|2|3\n"
    );
}
