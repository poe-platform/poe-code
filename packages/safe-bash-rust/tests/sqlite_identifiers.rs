use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::collections::BTreeMap;
use std::sync::Arc;

#[test]
fn sqlite_table_identifiers_ignore_ascii_case() {
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
            "sqlite3 :memory: <<'INPUT'\nCREATE TABLE Orders(k); INSERT INTO orders VALUES(8); SELECT k FROM ORDERS;\nINPUT\n",
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "8\n");
    assert!(!result.used_typescript_bridge);
}

#[test]
fn sqlite_table_identifiers_preserve_names_and_values() {
    for (script, expected) in [
        (
            "sqlite3 :memory: <<'INPUT'\nCREATE TABLE Orders(k); CREATE TABLE IF NOT EXISTS orders(other); INSERT INTO orders VALUES('MiXeD'); SELECT k FROM ORDERS; SELECT name FROM sqlite_schema;\nINPUT\n",
            "MiXeD\nOrders\n",
        ),
        (
            "sqlite3 :memory: <<'INPUT'\nCREATE TABLE Orders(k); INSERT INTO ORDERS VALUES(8); UPDATE orders SET k=9; SELECT k FROM oRdErS; DELETE FROM orders; SELECT count(*) FROM ORDERS;\nINPUT\n",
            "9\n0\n",
        ),
        (
            "sqlite3 :memory: <<'INPUT'\nCREATE TABLE \"Orders\"(k); INSERT INTO \"orders\" VALUES(8); SELECT k FROM \"ORDERS\";\nINPUT\n",
            "8\n",
        ),
        (
            "sqlite3 /orders.db 'CREATE TABLE Orders(k); INSERT INTO orders VALUES(8);'\nsqlite3 /orders.db 'SELECT k FROM ORDERS; SELECT name FROM sqlite_schema;'",
            "8\nOrders\n",
        ),
        (
            "sqlite3 :memory: <<'INPUT'\nCREATE TABLE Orders(k); INSERT INTO orders VALUES(8); ALTER TABLE ORDERS ADD COLUMN v DEFAULT 9; ALTER TABLE orders RENAME TO Purchases; SELECT k,v FROM PURCHASES;\nINPUT\n",
            "8|9\n",
        ),
        (
            "printf '8\\n' > /rows.csv\nsqlite3 :memory: <<'INPUT'\nCREATE TABLE Orders(k);\n.import /rows.csv orders\nSELECT k FROM ORDERS;\nINPUT\n",
            "8\n",
        ),
        (
            "printf 'k\\n8\\n' > /rows.csv\nsqlite3 /orders.db 'CREATE TABLE Orders(k);'\ncsvsql --db sqlite:////orders.db --insert --no-create --tables orders /rows.csv\nsqlite3 /orders.db 'SELECT k FROM ORDERS; SELECT name FROM sqlite_schema;'",
            "8\nOrders\n",
        ),
        (
            "sqlite3 :memory: <<'INPUT'\nPRAGMA foreign_keys=ON; CREATE TABLE Orders(k PRIMARY KEY); CREATE TABLE Items(k REFERENCES ORDERS(k)); INSERT INTO orders VALUES(8); INSERT INTO items VALUES(8); SELECT k FROM ITEMS;\nINPUT\n",
            "8\n",
        ),
        (
            "sqlite3 :memory: <<'INPUT'\nCREATE TABLE Orders(k); CREATE UNIQUE INDEX unique_k ON orders(k); INSERT INTO ORDERS VALUES(8); INSERT OR IGNORE INTO orders VALUES(8); SELECT count(*) FROM ORDERS;\nINPUT\n",
            "1\n",
        ),
        (
            "sqlite3 :memory: <<'INPUT'\nCREATE TABLE Ä(k); CREATE TABLE ä(k); INSERT INTO Ä VALUES('UPPER'); INSERT INTO ä VALUES('lower'); SELECT k FROM Ä; SELECT k FROM ä;\nINPUT\n",
            "UPPER\nlower\n",
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                cwd: Some("/".into()),
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        let result = shell.exec(script).unwrap();
        assert_eq!(result.exit_code, 0, "{script}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{script}");
        assert_eq!(result.stdout, expected, "{script}");
        assert!(!result.used_typescript_bridge);
    }
}
