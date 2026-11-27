use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_json_set_appends_to_arrays() {
    for (sql, expected) in [
        ("SELECT json_set('[1,2]','$[#]',3);", "[1,2,3]\n"),
        ("SELECT json_set('[]','$[#]',3);", "[3]\n"),
        ("SELECT json_set('null','$[#]',3);", "null\n"),
        ("SELECT json_set('{}','$.items[#]',3);", "{}\n"),
        ("SELECT json_set('[1]','$[#].a',2);", "[1,{\"a\":2}]\n"),
        ("SELECT json_extract('[1,2]','$[#]');", "\n"),
        ("SELECT json_remove('[1,2]','$[#]');", "[1,2]\n"),
        ("SELECT json_set('[1,2]','$[0]',3);", "[3,2]\n"),
        ("SELECT json_set('[1,2]','$',3);", "3\n"),
        ("SELECT json_set('[1]','$[#]',2,'$[#]',3);", "[1,2,3]\n"),
        (
            "SELECT json_set('{\"items\":[1]}','$.items[#]',2);",
            "{\"items\":[1,2]}\n",
        ),
        (
            "SELECT json_set('[[1],[2,3]]','$[1][#]',4);",
            "[[1],[2,3,4]]\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("sqlite3 :memory: <<'INPUT'\n{sql}\nINPUT"),
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
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected, "{sql}");
        assert_eq!(result.stderr, "");
    }
}
