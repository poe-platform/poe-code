use safe_bash_rust::Shell;

#[test]
fn sqlite_upsert_matches_targets_in_clause_order_after_reopening() {
    for (insert, expected) in [
        (
            "VALUES(4,1,88) ON CONFLICT(id) DO NOTHING ON CONFLICT(k) DO UPDATE SET v=excluded.v",
            "1|1|88\n2|2|20\n3|3|30\n",
        ),
        (
            "VALUES(1,2,88) ON CONFLICT(k) DO UPDATE SET v=excluded.v ON CONFLICT(id) DO NOTHING",
            "1|1|10\n2|2|88\n3|3|30\n",
        ),
        (
            "VALUES(1,2,88) ON CONFLICT(id) DO NOTHING ON CONFLICT(k) DO UPDATE SET v=excluded.v",
            "1|1|10\n2|2|20\n3|3|30\n",
        ),
        (
            "VALUES(4,1,88) ON CONFLICT(id) DO UPDATE SET v=99 ON CONFLICT DO UPDATE SET v=excluded.v",
            "1|1|88\n2|2|20\n3|3|30\n",
        ),
        (
            "VALUES(4,4,88),(5,1,89),(2,5,90) ON CONFLICT(id) DO NOTHING ON CONFLICT(k) DO UPDATE SET v=excluded.v",
            "1|1|89\n2|2|20\n3|3|30\n4|4|88\n",
        ),
        (
            "VALUES(4,1,88) ON CONFLICT(k) DO UPDATE SET v=excluded.v WHERE excluded.v<0 ON CONFLICT DO UPDATE SET v=99",
            "1|1|10\n2|2|20\n3|3|30\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let setup = shell.exec("sqlite3 /ledger.db 'CREATE TABLE t(id INTEGER PRIMARY KEY,k INT UNIQUE,v INT CHECK(v>=0)); INSERT INTO t VALUES(1,1,10),(2,2,20),(3,3,30);'").unwrap();
        assert_eq!(setup.exit_code, 0, "{setup:?}");
        let result = shell
            .exec(&format!("sqlite3 /ledger.db 'INSERT INTO t {insert};'"))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{insert}: {result:?}");
        assert_eq!(result.stderr, "");
        let stored = shell
            .exec("sqlite3 /ledger.db 'SELECT id,k,v FROM t ORDER BY id;'")
            .unwrap();
        assert_eq!(stored.exit_code, 0, "{stored:?}");
        assert_eq!(stored.stdout, expected, "{insert}");
        let schema = shell
            .exec("sqlite3 /ledger.db \"SELECT sql FROM sqlite_master WHERE name='t';\"")
            .unwrap();
        assert_eq!(schema.exit_code, 0, "{schema:?}");
        assert_eq!(
            schema.stdout,
            "CREATE TABLE t(id INTEGER PRIMARY KEY,k INT UNIQUE,v INT CHECK(v>=0))\n"
        );
    }
}

#[test]
fn sqlite_upsert_does_not_handle_an_unmatched_unique_constraint() {
    let (mut shell, _) = Shell::with_memory_fs();
    let setup = shell.exec("sqlite3 /ledger.db 'CREATE TABLE t(id INTEGER PRIMARY KEY,k INT UNIQUE); INSERT INTO t VALUES(1,1);'").unwrap();
    assert_eq!(setup.exit_code, 0, "{setup:?}");
    let result = shell
        .exec("sqlite3 /ledger.db 'INSERT INTO t VALUES(2,2),(3,1) ON CONFLICT(id) DO NOTHING;'")
        .unwrap();
    assert_eq!(result.exit_code, 1, "{result:?}");
    assert!(
        result.stderr.contains("UNIQUE constraint failed: t.k"),
        "{result:?}"
    );
    let stored = shell.exec("sqlite3 /ledger.db 'SELECT * FROM t;'").unwrap();
    assert_eq!(stored.stdout, "1|1\n");
}

#[test]
fn sqlite_upsert_keeps_quoted_keywords_inside_actions_and_returns_changed_rows() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /ledger.db <<'SQL'\nCREATE TABLE t(id INTEGER PRIMARY KEY,k INT UNIQUE,v TEXT); INSERT INTO t VALUES(1,1,'old'); INSERT INTO t VALUES(2,1,'new') ON CONFLICT(id) DO NOTHING ON CONFLICT(k) DO UPDATE SET v='ON CONFLICT DO NOTHING RETURNING ' RETURNING id,k,v;\nSQL").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stdout, "1|1|ON CONFLICT DO NOTHING RETURNING \n");
    let stored = shell.exec("sqlite3 /ledger.db 'SELECT * FROM t;'").unwrap();
    assert_eq!(stored.stdout, result.stdout);
}

#[test]
fn sqlite_upsert_matches_composite_targets_after_reopening() {
    let (mut shell, _) = Shell::with_memory_fs();
    let setup = shell.exec("sqlite3 /ledger.db 'CREATE TABLE t(id INTEGER PRIMARY KEY,a INT,b INT,v INT,UNIQUE(a,b)); INSERT INTO t VALUES(1,2,3,10);'").unwrap();
    assert_eq!(setup.exit_code, 0, "{setup:?}");
    let result = shell.exec("sqlite3 /ledger.db 'INSERT INTO t VALUES(2,2,3,88) ON CONFLICT(id) DO NOTHING ON CONFLICT(b,a) DO UPDATE SET v=excluded.v;'").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    let stored = shell.exec("sqlite3 /ledger.db 'SELECT * FROM t;'").unwrap();
    assert_eq!(stored.stdout, "1|2|3|88\n");
}
