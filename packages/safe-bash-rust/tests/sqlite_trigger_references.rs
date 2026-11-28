use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

fn assert_trigger_output(sql: &str, expected: &str) {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let output = shell
        .exec_with_options(
            &format!("sqlite3 :memory: <<'INPUT'\n{sql}\nINPUT\n"),
            ExecOptions {
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(output.exit_code, 0, "{output:?}");
    assert_eq!(output.stderr, "");
    assert_eq!(output.stdout, expected, "{sql}");
}

#[test]
fn sqlite_trigger_new_columns_with_overlapping_names() {
    assert_trigger_output(
        "CREATE TABLE t(id,id2); CREATE TABLE log(v); CREATE TRIGGER tr AFTER INSERT ON t BEGIN INSERT INTO log VALUES(NEW.id2); END; INSERT INTO t VALUES(1,9); SELECT v FROM log;",
        "9\n",
    );
    for columns in ["id,id2,id20,id_2,id$2,idé", "idé,id$2,id_2,id20,id2,id"] {
        assert_trigger_output(
            &format!(
                "CREATE TABLE t({columns}); CREATE TABLE log(v);
                 CREATE TRIGGER tr AFTER INSERT ON t BEGIN
                   INSERT INTO log VALUES(NEW.id || ':' || new.id2 || ':' || New.ID20 || ':' || NEW.id_2 || ':' || NEW.id$2 || ':' || NEW.idé);
                 END;
                 INSERT INTO t(id,id2,id20,id_2,id$2,idé) VALUES(1,9,20,2,3,4);
                 SELECT v FROM log;"
            ),
            "1:9:20:2:3:4\n",
        );
    }
}

#[test]
fn sqlite_trigger_old_and_new_columns_with_overlapping_names() {
    assert_trigger_output(
        "CREATE TABLE t(id,id2); CREATE TABLE log(v);
         INSERT INTO t VALUES(1,9);
         CREATE TRIGGER tr_update AFTER UPDATE ON t BEGIN
           INSERT INTO log VALUES(OLD.id || ':' || OLD.id2 || ':' || NEW.id || ':' || NEW.id2);
         END;
         CREATE TRIGGER tr_delete AFTER DELETE ON t BEGIN
           INSERT INTO log VALUES(old.id || ':' || Old.ID2);
         END;
         UPDATE t SET id=2,id2=8;
         DELETE FROM t;
         SELECT v FROM log;",
        "1:9:2:8\n2:8\n",
    );
}

#[test]
fn sqlite_trigger_preserves_literals_and_does_not_rescan_values() {
    assert_trigger_output(
        "CREATE TABLE t(id,id2); CREATE TABLE log(v);
         CREATE TRIGGER tr AFTER INSERT ON t BEGIN
           INSERT INTO log VALUES('NEW.id2');
           INSERT INTO log VALUES('it''s NEW.id');
           INSERT INTO log VALUES(NEW.id);
         END;
         INSERT INTO t VALUES('NEW.id2',9);
         SELECT v FROM log;",
        "NEW.id2\nit's NEW.id\nNEW.id2\n",
    );
}

#[test]
fn sqlite_trigger_preserves_semicolons_in_string_literals() {
    assert_trigger_output(
        "CREATE TABLE t(n); CREATE TABLE log(s); CREATE TRIGGER tr AFTER INSERT ON t BEGIN INSERT INTO log VALUES('one;two'); END; INSERT INTO t VALUES(3); SELECT s FROM log;",
        "one;two\n",
    );
    assert_trigger_output(
        "CREATE TABLE t(n); CREATE TABLE log(s);
         CREATE TRIGGER tr AFTER INSERT ON t BEGIN
           INSERT INTO log VALUES('one;two');
           INSERT INTO log VALUES('it''s;quoted');
           INSERT INTO log VALUES(';END;BEGIN;');
           INSERT INTO log VALUES('last');
         END;
         INSERT INTO t VALUES(3);
         SELECT s FROM log;",
        "one;two\nit's;quoted\n;END;BEGIN;\nlast\n",
    );
}

#[test]
fn sqlite_trigger_preserves_semicolons_in_row_values() {
    assert_trigger_output(
        "CREATE TABLE t(n); CREATE TABLE log(s);
         CREATE TRIGGER ins AFTER INSERT ON t BEGIN
           INSERT INTO log VALUES(NEW.n);
         END;
         CREATE TRIGGER upd AFTER UPDATE ON t BEGIN
           INSERT INTO log VALUES(OLD.n);
           INSERT INTO log VALUES(NEW.n);
         END;
         INSERT INTO t VALUES('one;two');
         UPDATE t SET n='it''s;updated';
         SELECT s FROM log;",
        "one;two\none;two\nit's;updated\n",
    );
}
