use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_json_mutations_respect_path_existence() {
    for (arguments, inserted, replaced, set) in [
        (
            r#"'{"a":1}','$.a',5,'$.b',2"#,
            r#"{"a":1,"b":2}"#,
            r#"{"a":5}"#,
            r#"{"a":5,"b":2}"#,
        ),
        (
            r#"'{"a":null}','$.a',5,'$.b',2"#,
            r#"{"a":null,"b":2}"#,
            r#"{"a":5}"#,
            r#"{"a":5,"b":2}"#,
        ),
        (
            r#"'{"a":{"b":1}}','$.a.b',5,'$.a.c',2"#,
            r#"{"a":{"b":1,"c":2}}"#,
            r#"{"a":{"b":5}}"#,
            r#"{"a":{"b":5,"c":2}}"#,
        ),
        (
            "'[null,1]','$[0]',5,'$[#]',2",
            "[null,1,2]",
            "[5,1]",
            "[5,1,2]",
        ),
        ("'null','$',5", "null", "5", "5"),
        ("'{}','$.a',1,'$.a',2", r#"{"a":1}"#, "{}", r#"{"a":2}"#),
        ("'[1]','$[#]',2,'$[#]',3", "[1,2,3]", "[1]", "[1,2,3]"),
    ] {
        for (function, expected) in [
            ("json_insert", inserted),
            ("json_replace", replaced),
            ("json_set", set),
        ] {
            let (mut shell, _) = Shell::with_memory_fs();
            let sql = format!("SELECT {function}({arguments});");
            let result = shell
                .exec_with_options(
                    &format!("sqlite3 :memory: <<'SQL'\n{sql}\nSQL"),
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
            assert_eq!(result.stdout, format!("{expected}\n"), "{sql}");
        }
    }
}
