use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn csvjson_infers_one_type_per_column_through_the_shell() {
    for (options, input, expected) in [
        (
            "",
            "id,code\nA,42\nB,AB\nC,001\n",
            r#"[{"id": "A", "code": "42"}, {"id": "B", "code": "AB"}, {"id": "C", "code": "001"}]"#,
        ),
        (
            "--stream",
            "id,code\nA,42\nB,AB\nC,001\n",
            "{\"id\": \"A\", \"code\": \"42\"}\n{\"id\": \"B\", \"code\": \"AB\"}\n{\"id\": \"C\", \"code\": \"001\"}\n",
        ),
        (
            "--key id",
            "id,code\nA,42\nB,AB\nC,001\n",
            r#"{"A": {"id": "A", "code": "42"}, "B": {"id": "B", "code": "AB"}, "C": {"id": "C", "code": "001"}}"#,
        ),
        (
            "",
            "flag,number,text\n0,0,true\n1,1,hello\n0,2,false\n",
            r#"[{"flag": false, "number": 0.0, "text": "true"}, {"flag": true, "number": 1.0, "text": "hello"}, {"flag": false, "number": 2.0, "text": "false"}]"#,
        ),
        (
            "--no-inference",
            "flag,number\n0,42\n1,001\n",
            r#"[{"flag": "0", "number": "42"}, {"flag": "1", "number": "001"}]"#,
        ),
        (
            "--null-value missing",
            "flag,number,text\n0,42,001\n1,12,hello\nmissing,missing,missing\n",
            r#"[{"flag": false, "number": 42.0, "text": "001"}, {"flag": true, "number": 12.0, "text": "hello"}, {"flag": null, "number": null, "text": null}]"#,
        ),
        (
            "--blanks",
            "id,flag\nA,0\nB,1\nC,\n",
            r#"[{"id": "A", "flag": "0"}, {"id": "B", "flag": "1"}, {"id": "C", "flag": ""}]"#,
        ),
        (
            "",
            "id,flag\nA,0\nB,1\nC,\n",
            r#"[{"id": "A", "flag": false}, {"id": "B", "flag": true}, {"id": "C", "flag": null}]"#,
        ),
        (
            "--blanks",
            "id,flag\nA,0\nB,1\nC\n",
            r#"[{"id": "A", "flag": false}, {"id": "B", "flag": true}, {"id": "C", "flag": null}]"#,
        ),
        (
            "--no-leading-zeroes",
            "code\n42\n001\n",
            r#"[{"code": "42"}, {"code": "001"}]"#,
        ),
        ("", "code\n42\n001\n", r#"[{"code": 42.0}, {"code": 1.0}]"#),
        (
            "-H",
            "0,42\n1,AB\n",
            r#"[{"a": false, "b": "42"}, {"a": true, "b": "AB"}]"#,
        ),
        (
            "--lat lat --lon lon --key code --no-bbox",
            "code,lat,lon\n42,2,3\nAB,4,5\n001,6,7\n",
            r#"{"type": "FeatureCollection", "features": [{"type": "Feature", "id": "42", "properties": {"code": "42", "lat": 2.0, "lon": 3.0}, "geometry": {"type": "Point", "coordinates": [3, 2]}}, {"type": "Feature", "id": "AB", "properties": {"code": "AB", "lat": 4.0, "lon": 5.0}, "geometry": {"type": "Point", "coordinates": [5, 4]}}, {"type": "Feature", "id": "001", "properties": {"code": "001", "lat": 6.0, "lon": 7.0}, "geometry": {"type": "Point", "coordinates": [7, 6]}}]}"#,
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("cat > a.csv <<'INPUT'\n{input}INPUT\ncsvjson {options} a.csv"),
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
        assert_eq!(result.exit_code, 0, "{options}: {result:?}");
        assert_eq!(result.stderr, "", "{options}");
        assert_eq!(result.stdout, expected, "{options}: {input}");
    }
}
