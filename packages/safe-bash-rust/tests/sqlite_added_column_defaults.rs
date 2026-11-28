use safe_bash_rust::{SafeBashFs, Shell};
use std::io::Write;
use std::process::{Command, Stdio};

#[test]
fn sqlite_rewrite_preserves_added_column_defaults_and_explicit_nulls() {
    // Python 3.11+ provides an independent SQLite reader/writer entirely in memory.
    let fixture = Command::new("python3")
        .args([
            "-c",
            r#"
import sqlite3, sys
db = sqlite3.connect(':memory:')
db.executescript('''
CREATE TABLE t(id INTEGER PRIMARY KEY);
INSERT INTO t VALUES(10);
ALTER TABLE t ADD COLUMN note TEXT DEFAULT 'pending';
ALTER TABLE t ADD COLUMN count INTEGER DEFAULT 7;
ALTER TABLE t ADD COLUMN optional TEXT;
ALTER TABLE t ADD COLUMN empty TEXT DEFAULT NULL;
INSERT INTO t VALUES(11,NULL,NULL,NULL,NULL);
''')
sys.stdout.buffer.write(db.serialize())
"#,
        ])
        .output()
        .unwrap();
    assert!(
        fixture.status.success(),
        "{}",
        String::from_utf8_lossy(&fixture.stderr)
    );

    let (mut shell, fs) = Shell::with_memory_fs();
    fs.write_file("/records.db", &fixture.stdout).unwrap();
    let result = shell.exec("sqlite3 /records.db 'CREATE TABLE separate(note TEXT); INSERT INTO separate VALUES(7);'").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stdout, "");
    assert_eq!(result.stderr, "");
    assert!(!result.used_typescript_bridge);

    let mut reader = Command::new("python3")
        .args([
            "-c",
            r#"
import sqlite3, sys
db = sqlite3.connect(':memory:')
db.deserialize(sys.stdin.buffer.read())
rows = db.execute('SELECT * FROM t ORDER BY id').fetchall()
assert rows == [(10, 'pending', 7, None, None), (11, None, None, None, None)], rows
assert db.execute('SELECT * FROM separate').fetchall() == [('7',)]
assert db.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
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
    let checked = reader.wait_with_output().unwrap();
    assert!(
        checked.status.success(),
        "{}",
        String::from_utf8_lossy(&checked.stderr)
    );
}
