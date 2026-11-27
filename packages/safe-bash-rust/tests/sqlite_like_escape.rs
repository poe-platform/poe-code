use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite3_like_escape_matches_literal_underscore() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell.exec_with_options(
        "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(k); INSERT INTO t VALUES('a_b'),('acb'); SELECT k FROM t WHERE k LIKE 'a!_b' ESCAPE '!';\nINPUT",
        ExecOptions {
            cwd: Some("/".into()),
            env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
            ..Default::default()
        },
    ).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "a_b\n");
}

#[test]
fn sqlite3_like_escape_preserves_wildcards_and_literal_characters() {
    for (value, pattern, escape, expected) in [
        ("a_b", "a!_b", "!", true),
        ("acb", "a!_b", "!", false),
        ("a%b", "a!%b", "!", true),
        ("acb", "a!%b", "!", false),
        ("a!b", "a!!b", "!", true),
        ("ab", "a!b", "!", true),
        ("a_foo_b", "%!_b", "!", true),
        ("a_foo_b", "a!_%!_b", "!", true),
        ("a_xb", "a!__b", "!", true),
        ("a_b", "a%_b", "%", true),
        ("a_b", "a__b", "_", true),
        ("a_b", "aX_b", "X", true),
        ("ax_b", "ax_b", "X", true),
        ("A_B", "a!_b", "!", true),
        ("a_b", "aé_b", "é", true),
        ("aéb", "a_b", "!", true),
        ("æ", "Æ", "!", false),
        ("abc", "abc!", "!", false),
        ("abc", "%!", "!", false),
        ("", "%", "!", true),
        ("", "!", "!", false),
        ("", "", "!", true),
        ("a ESCAPE b", "a ESCAPE b", "!", true),
    ] {
        for (operator, matches) in [("LIKE", expected), ("NOT LIKE", !expected)] {
            let (mut shell, _) = Shell::with_memory_fs();
            let sql = format!(
                "CREATE TABLE t(k,p,e); INSERT INTO t VALUES('{value}','{pattern}','{escape}'); SELECT count(*) FROM t WHERE k {operator} p ESCAPE e;"
            );
            let result = shell
                .exec(&format!("sqlite3 :memory: <<'INPUT'\n{sql}\nINPUT"))
                .unwrap();
            assert_eq!(result.exit_code, 0, "{sql}: {}", result.stderr);
            assert_eq!(result.stdout, if matches { "1\n" } else { "0\n" }, "{sql}");
        }
    }
}

#[test]
fn sqlite3_like_escape_only_mutates_matching_rows() {
    for (mutation, expected) in [
        (
            "UPDATE t SET k='matched' WHERE k LIKE 'a!_b' ESCAPE '!'",
            "matched\nacb\n",
        ),
        ("DELETE FROM t WHERE k LIKE 'a!_b' ESCAPE '!'", "acb\n"),
        ("DELETE FROM t WHERE k NOT LIKE 'a!_b' ESCAPE '!'", "a_b\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!(
            "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(k); INSERT INTO t VALUES('a_b'),('acb'); {mutation}; SELECT k FROM t;\nINPUT"
        )).unwrap();
        assert_eq!(result.exit_code, 0, "{mutation}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{mutation}");
    }
}

#[test]
fn sqlite3_like_keeps_unescaped_patterns_and_null_filtering() {
    for (predicate, expected) in [
        ("'a_b' LIKE 'a_b'", "1\n"),
        ("'acb' LIKE 'a_b'", "1\n"),
        ("'Abc' LIKE 'a%'", "1\n"),
        ("'abc' NOT LIKE 'a%'", "0\n"),
        ("'a_b' LIKE 'a!_b'", "0\n"),
        ("'a\\b' LIKE 'a\\b'", "1\n"),
        ("'a_b' LIKE 'a!_b' ESCAPE substr('!x',1,1)", "1\n"),
        ("'a ESCAPE b' LIKE 'a ESCAPE b' ESCAPE '!'", "1\n"),
        ("'a_b' LIKE 'a!_b' ESCAPE '!' AND 1=1", "1\n"),
        ("NULL LIKE '%' ESCAPE '!'", "0\n"),
        ("NULL NOT LIKE '%' ESCAPE '!'", "0\n"),
        ("'a' NOT LIKE NULL ESCAPE '!'", "0\n"),
        ("'a' NOT LIKE '%' ESCAPE NULL", "0\n"),
        ("'abc' GLOB 'a[b]?'", "1\n"),
        ("'Abc' GLOB 'a*'", "0\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec(&format!(
            "sqlite3 :memory: <<'INPUT'\nCREATE TABLE t(k); INSERT INTO t VALUES(1); SELECT count(*) FROM t WHERE {predicate};\nINPUT"
        )).unwrap();
        assert_eq!(result.exit_code, 0, "{predicate}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{predicate}");
    }
}
