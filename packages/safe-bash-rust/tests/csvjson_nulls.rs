use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn csvjson_no_inference_still_handles_null_tokens() {
    for flag in ["-I", "--no-inference"] {
        for (options, expected) in [
            (
                "",
                r#"[{"id": "ID1", "text": null}, {"id": "ID2", "text": "hello"}, {"id": "ID3", "text": null}, {"id": "ID4", "text": null}, {"id": "ID5", "text": null}, {"id": "ID6", "text": "42"}, {"id": "ID7", "text": "true"}, {"id": "ID8", "text": null}]"#,
            ),
            (
                "--blanks",
                r#"[{"id": "ID1", "text": "NA"}, {"id": "ID2", "text": "hello"}, {"id": "ID3", "text": "NULL"}, {"id": "ID4", "text": "n/A"}, {"id": "ID5", "text": "None"}, {"id": "ID6", "text": "42"}, {"id": "ID7", "text": "true"}, {"id": "ID8", "text": ""}]"#,
            ),
            (
                "--blanks --null-value hello",
                r#"[{"id": "ID1", "text": "NA"}, {"id": "ID2", "text": null}, {"id": "ID3", "text": "NULL"}, {"id": "ID4", "text": "n/A"}, {"id": "ID5", "text": "None"}, {"id": "ID6", "text": "42"}, {"id": "ID7", "text": "true"}, {"id": "ID8", "text": ""}]"#,
            ),
        ] {
            let (mut shell, _) = Shell::with_memory_fs();
            let result = shell
                .exec_with_options(
                    &format!(
                        "printf %s 'id,text\nID1,NA\nID2,hello\nID3,NULL\nID4,n/A\nID5,None\nID6,42\nID7,true\nID8,\n' > a.csv\ncsvjson {flag} {options} a.csv"
                    ),
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
            assert_eq!(result.exit_code, 0, "{flag} {options}: {result:?}");
            assert_eq!(result.stderr, "", "{flag} {options}");
            assert_eq!(result.stdout, expected, "{flag} {options}");
        }
    }
}
