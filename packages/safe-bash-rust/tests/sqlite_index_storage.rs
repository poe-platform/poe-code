use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::Arc;

fn python(script: &str, input: &[u8]) -> Vec<u8> {
    let mut child = Command::new("python3")
        .args(["-c", script])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(input).unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

#[test]
fn unrelated_write_preserves_explicit_index_for_independent_sqlite_reader() {
    let pristine = python(
        "import sqlite3,sys\nc=sqlite3.connect(':memory:')\nc.executescript(\"CREATE TABLE t(id INTEGER PRIMARY KEY,tag TEXT); CREATE INDEX idx ON t(tag); INSERT INTO t VALUES(1,'red'),(2,'blue'),(3,'red');\")\nsys.stdout.buffer.write(c.serialize())",
        &[],
    );
    let vfs = Arc::new(MemoryVfs::new());
    vfs.write_file("/records.db", &pristine).unwrap();
    let mut shell = Shell::new(
        vfs.clone(),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            cwd: Some("/".into()),
            ..ShellOptions::default()
        },
    );
    let result = shell.exec("sqlite3 /records.db 'CREATE TABLE separate(note TEXT); INSERT INTO separate VALUES(7);'").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let bytes = vfs.read_file("/records.db").unwrap();
    python(
        "import sqlite3,sys\nc=sqlite3.connect(':memory:')\nc.deserialize(sys.stdin.buffer.read())\nassert c.execute(\"SELECT id FROM t INDEXED BY idx WHERE tag='red' ORDER BY id\").fetchall()==[(1,),(3,)]\nassert c.execute('PRAGMA integrity_check').fetchall()==[('ok',)]",
        &bytes,
    );
}

#[test]
fn index_pages_preserve_order_overflow_and_changes_after_reopening() {
    let pristine = python(
        r#"
import sqlite3,sys
c=sqlite3.connect(':memory:')
c.executescript('''
CREATE TABLE t(id INTEGER PRIMARY KEY, tag TEXT COLLATE NOCASE, n, data BLOB);
CREATE INDEX tags ON t(tag DESC, n);
CREATE UNIQUE INDEX ids ON t(id DESC);
CREATE INDEX partial ON t(lower(tag)) WHERE id > 4;
CREATE INDEX blobs ON t(data);
CREATE INDEX numbers ON t(n);
CREATE TABLE empty(value TEXT);
CREATE INDEX empty_index ON empty(value);
''')
c.executemany('INSERT INTO t VALUES(?,?,?,?)', [(i*3, ('Red' if i%2 else 'blue')+str(i%30), i%9, bytes([i%256])) for i in range(1,1201)])
c.execute('INSERT INTO t VALUES(?,?,?,?)',(-7,'z'*10000,None,b'\x00'*8000))
c.execute('INSERT INTO t VALUES(?,?,?,?)',(9000,None,'3',b''))
c.commit()
sys.stdout.buffer.write(c.serialize())
"#,
        &[],
    );
    let vfs = Arc::new(MemoryVfs::new());
    vfs.write_file("/records.db", &pristine).unwrap();
    let mut shell = Shell::new(
        vfs.clone(),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            cwd: Some("/".into()),
            ..ShellOptions::default()
        },
    );
    for sql in [
        "CREATE TABLE separate(note TEXT)",
        "UPDATE t SET tag='changed',n=6 WHERE id=3; DELETE FROM t WHERE id=6; INSERT INTO t VALUES(9999,'NEW',7,x'ff')",
    ] {
        let result = shell
            .exec(&format!("sqlite3 /records.db <<'SQL'\n{sql};\nSQL"))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stderr, "");
    }
    python(
        r#"
import sqlite3,sys
c=sqlite3.connect(':memory:')
c.deserialize(sys.stdin.buffer.read())
check=c.execute('PRAGMA integrity_check').fetchall()
assert check==[('ok',)], check
for index,where,order in [('tags','1','tag DESC,n,id'),('ids','1','id DESC'),('partial','id>4','lower(tag),id'),('blobs','1','data,id'),('numbers','1','n,id')]:
    indexed=c.execute(f'SELECT id FROM t INDEXED BY {index} WHERE {where} ORDER BY {order}').fetchall()
    scanned=c.execute(f'SELECT id FROM t NOT INDEXED WHERE {where} ORDER BY {order}').fetchall()
    assert indexed==scanned, index
assert c.execute("SELECT id FROM t INDEXED BY tags WHERE tag='CHANGED'").fetchall()==[(3,)]
assert c.execute('SELECT * FROM empty INDEXED BY empty_index').fetchall()==[]
"#,
        &vfs.read_file("/records.db").unwrap(),
    );
}

#[test]
fn newly_created_indexes_are_readable_by_sqlite() {
    let (mut shell, fs) = Shell::with_memory_fs();
    let result = shell.exec("sqlite3 /records.db <<'SQL'\nCREATE TABLE t(tag TEXT,n); INSERT INTO t VALUES('red',1),('blue',2),('red',3); CREATE INDEX idx ON t(tag,n DESC); CREATE UNIQUE INDEX nums ON t(n);\nSQL").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    python(
        r#"
import sqlite3,sys
c=sqlite3.connect(':memory:')
c.deserialize(sys.stdin.buffer.read())
assert c.execute("SELECT rowid FROM t INDEXED BY idx WHERE tag='red' ORDER BY n DESC").fetchall()==[(3,),(1,)]
assert c.execute('SELECT n FROM t INDEXED BY nums ORDER BY n').fetchall()==[(1,),(2,),(3,)]
assert c.execute('PRAGMA integrity_check').fetchall()==[('ok',)]
"#,
        &fs.read_file("/records.db").unwrap(),
    );
}
