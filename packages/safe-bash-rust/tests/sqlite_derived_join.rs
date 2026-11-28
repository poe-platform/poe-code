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
        .exec_with_options(&format!("sqlite3 :memory: '{sql}'"), ExecOptions::default())
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    result.stdout
}

#[test]
fn grouped_derived_join_matches_both_group_key_and_minimum() {
    assert_eq!(
        run_sql(
            "CREATE TABLE t(k,n);INSERT INTO t VALUES(1,4),(1,6),(2,4); SELECT t.k,t.n FROM t JOIN (SELECT k,min(n) AS m FROM t GROUP BY k) s ON t.k=s.k AND t.n=s.m ORDER BY t.k,t.n;"
        ),
        "1|4\n2|4\n"
    );
}

#[test]
fn grouped_derived_join_does_not_double_aggregate_contributions() {
    assert_eq!(
        run_sql(
            "CREATE TABLE t(k,n);INSERT INTO t VALUES(1,4),(1,6),(2,4); SELECT sum(t.n) FROM t JOIN (SELECT k,min(n) AS m FROM t GROUP BY k) AS s ON t.k=s.k AND t.n=s.m;"
        ),
        "8\n"
    );
}

#[test]
fn derived_join_keeps_both_qualified_keys_and_unmatched_rows() {
    assert_eq!(
        run_sql(
            "CREATE TABLE t(k,n);INSERT INTO t VALUES(1,4),(1,6),(2,4),(3,NULL); SELECT t.k,t.n,s.k,s.m FROM t LEFT JOIN (SELECT k,min(n) AS m FROM t GROUP BY k) as s ON t.k=s.k AND t.n=s.m ORDER BY t.k,t.n;"
        ),
        "1|4|1|4\n1|6||\n2|4|2|4\n3|||\n"
    );
}

#[test]
fn derived_join_binds_aliases_with_reversed_predicates() {
    for alias in ["S", "AS s", "aS \"s\"", "AS `s`"] {
        assert_eq!(
            run_sql(&format!(
                "CREATE TABLE t(k,n);INSERT INTO t VALUES(1,4),(1,6),(2,4); SELECT x.k,s.k,s.m FROM t AS x JOIN (SELECT k,min(n) AS m FROM t GROUP BY k) {alias} ON x.n=s.m AND x.k=s.k ORDER BY x.k;"
            )),
            "1|1|4\n2|2|4\n",
            "{alias}"
        );
    }
}
