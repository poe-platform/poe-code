use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_foreign_key_check_reports_stored_orphans() {
    for (sql, expected) in [
        (
            "CREATE TABLE p(id INT PRIMARY KEY);CREATE TABLE c(id INTEGER PRIMARY KEY,x REFERENCES p(id));INSERT INTO c VALUES(42,39);PRAGMA foreign_key_check;",
            "c|42|p|0\n",
        ),
        (
            "CREATE TABLE p(id INT PRIMARY KEY);CREATE TABLE c(id INT PRIMARY KEY,x REFERENCES p(id)) WITHOUT ROWID;INSERT INTO c VALUES(42,39);PRAGMA foreign_key_check;",
            "c||p|0\n",
        ),
        (
            "CREATE TABLE p(id INT PRIMARY KEY); CREATE TABLE c(x REFERENCES p(id));INSERT INTO c VALUES(39);PRAGMA foreign_key_check;",
            "c|1|p|0\n",
        ),
        (
            "CREATE TABLE p(id INT PRIMARY KEY);CREATE TABLE c(x REFERENCES p(id));INSERT INTO p VALUES(1);INSERT INTO c VALUES(1),(NULL),(39),(40);DELETE FROM c WHERE x=39;PRAGMA foreign_key_check;",
            "c|4|p|0\n",
        ),
        (
            "CREATE TABLE p(id INT PRIMARY KEY);CREATE TABLE q(id INT PRIMARY KEY);CREATE TABLE c(x REFERENCES p(id),y REFERENCES q(id));INSERT INTO c VALUES(1,2);PRAGMA foreign_key_check;",
            "c|1|q|0\nc|1|p|1\n",
        ),
        (
            "CREATE TABLE p(a,b,PRIMARY KEY(a,b));CREATE TABLE c(x,y,FOREIGN KEY(x,y) REFERENCES p(a,b));INSERT INTO p VALUES(1,2),(4,3);INSERT INTO c VALUES(1,2),(NULL,3),(1,3);PRAGMA foreign_key_check;",
            "c|3|p|0\n",
        ),
        (
            "CREATE TABLE p(id INT PRIMARY KEY);CREATE TABLE c(x REFERENCES p(id));INSERT INTO p VALUES(1);INSERT INTO c VALUES(1),(NULL);PRAGMA foreign_key_check;",
            "",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("sqlite3 :memory: '{sql}'"),
                ExecOptions {
                    cwd: Some("/".into()),
                    env: BTreeMap::from([
                        ("LC_ALL".into(), "C".into()),
                        ("TZ".into(), "UTC".into()),
                    ]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{sql}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{sql}");
        assert_eq!(result.stdout, expected, "{sql}");
    }
}
