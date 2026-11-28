use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::Arc;

fn python_sqlite(script: &str, input: &[u8]) -> Vec<u8> {
    let mut child = Command::new("python3")
        .args(["-c", script])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Python with sqlite3 is required for independent database verification");
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
fn sqlite_primary_key_desc_survives_unrelated_write_in_independent_reader() {
    let bytes = python_sqlite(
        r#"
import sqlite3, sys
connection = sqlite3.connect(':memory:')
connection.executescript("""
CREATE TABLE t(a TEXT,k INTEGER PRIMARY KEY DESC);
INSERT INTO t VALUES('one',20),('two',10);
CREATE TABLE sparse(a TEXT,k INTEGER PRIMARY KEY DESC);
INSERT INTO sparse(rowid,a,k) VALUES(-7,'negative',30),(42,'null',NULL),(99,'last',NULL);
""")
sys.stdout.buffer.write(connection.serialize())
"#,
        &[],
    );
    let vfs = Arc::new(MemoryVfs::new());
    vfs.write_file("/records.db", &bytes).unwrap();
    let mut shell = Shell::new(
        vfs.clone(),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
        },
    );
    let result = shell
        .exec("sqlite3 /records.db 'CREATE TABLE separate(note TEXT); INSERT INTO separate VALUES(7);'")
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "");
    let rows = python_sqlite(
        r#"
import sqlite3, sys
connection = sqlite3.connect(':memory:')
connection.deserialize(sys.stdin.buffer.read())
for table in ('t', 'sparse'):
    for row in connection.execute(f'SELECT rowid,k,a FROM {table} ORDER BY rowid'):
        print('|'.join('' if value is None else str(value) for value in row))
print(connection.execute('SELECT note FROM separate').fetchone()[0])
"#,
        &vfs.read_file("/records.db").unwrap(),
    );
    assert_eq!(
        String::from_utf8(rows).unwrap(),
        "1|20|one\n2|10|two\n-7|30|negative\n42||null\n99||last\n7\n"
    );
}

#[test]
fn sqlite_inline_primary_key_sort_order_controls_rowid_aliasing() {
    for (definition, expected) in [
        ("INTEGER PRIMARY KEY DESC", "1|20|one\n2|10|two\n"),
        (
            "integer constraint pk primary key\n\tDeSc",
            "1|20|one\n2|10|two\n",
        ),
        ("INTEGER PRIMARY KEY", "10|10|two\n20|20|one\n"),
        ("INTEGER PRIMARY KEY ASC", "10|10|two\n20|20|one\n"),
        (
            "INTEGER PRIMARY KEY DEFAULT 'DESC'",
            "10|10|two\n20|20|one\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                "sqlite3 /records.db",
                ExecOptions {
                    stdin: Some(format!(
                        "CREATE TABLE t(a TEXT,k {definition}); INSERT INTO t VALUES('one',20),('two',10); SELECT rowid,k,a FROM t ORDER BY rowid;"
                    )),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{definition}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{definition}");
        let result = shell
            .exec("sqlite3 /records.db 'SELECT rowid,k,a FROM t ORDER BY rowid;'")
            .unwrap();
        assert_eq!(result.exit_code, 0, "{definition}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{definition}");
    }
}
