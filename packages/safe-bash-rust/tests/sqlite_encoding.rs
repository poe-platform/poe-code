use safe_bash_rust::{SafeBashFs, Shell};

// Created by SQLite: PRAGMA encoding='<encoding>'; CREATE TABLE t(n TEXT);
// INSERT INTO t VALUES('café漢字😀'); CREATE VIEW original AS SELECT n FROM t;
const DATABASES: &[&[u8]] = &[
    include_bytes!("fixtures/sqlite-utf-8.db"),
    include_bytes!("fixtures/sqlite-utf-16le.db"),
    include_bytes!("fixtures/sqlite-utf-16be.db"),
];

#[test]
fn sqlite_reads_and_preserves_encoded_schema_and_rows() {
    for bytes in DATABASES {
        let (mut shell, fs) = Shell::with_memory_fs();
        fs.write_file("/records.db", bytes).unwrap();
        let read = shell
            .exec("sqlite3 /records.db 'SELECT n FROM t;'")
            .unwrap();
        assert_eq!(read.exit_code, 0, "{read:?}");
        assert_eq!(read.stdout, "café漢字😀\n");
        assert_eq!(fs.read_file("/records.db").unwrap(), *bytes);
        let write = shell.exec("sqlite3 /records.db 'CREATE TABLE separate(note TEXT); INSERT INTO separate VALUES(7);'").unwrap();
        assert_eq!(write.exit_code, 0, "{write:?}");
        let read = shell
            .exec("sqlite3 /records.db 'SELECT n FROM original; SELECT note FROM separate;'")
            .unwrap();
        assert_eq!(read.exit_code, 0, "{read:?}");
        assert_eq!(read.stdout, "café漢字😀\n7\n");
    }
}

/// Run with --ignored using Python 3.11+ with SQLite serialization support.
#[test]
#[ignore = "requires Python sqlite3.Connection.deserialize"]
fn independent_sqlite_reads_original_data_after_write() {
    use std::io::Write;
    use std::process::{Command, Stdio};

    for bytes in DATABASES {
        let (mut shell, fs) = Shell::with_memory_fs();
        fs.write_file("/records.db", bytes).unwrap();
        let write = shell.exec("sqlite3 /records.db 'CREATE TABLE separate(note TEXT); INSERT INTO separate VALUES(7);'").unwrap();
        assert_eq!(write.exit_code, 0, "{write:?}");
        let mut reader = Command::new("python3")
            .args([
                "-c",
                r#"
import sqlite3, sys
db = sqlite3.connect(':memory:')
db.deserialize(sys.stdin.buffer.read())
assert db.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
assert db.execute('SELECT n FROM t').fetchall() == [('café漢字😀',)]
assert db.execute('SELECT n FROM original').fetchall() == [('café漢字😀',)]
assert db.execute('SELECT note FROM separate').fetchall() == [('7',)]
"#,
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        reader
            .stdin
            .take()
            .unwrap()
            .write_all(&fs.read_file("/records.db").unwrap())
            .unwrap();
        let output = reader.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
