use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn awk_string_field_selectors() {
    for (program, expected) in [
        (
            r#"{ print $"2" }
"#,
            "b\n",
        ),
        (r#"{ print $ "2" }"#, "b\n"),
        (r#"{ print "[" $"2" "]" }"#, "[b]\n"),
        (r#"{ print $"2" "3" }"#, "b3\n"),
        (r#"{ print $"0", $"2.9", $"4" }"#, "a b c b \n"),
        (
            r#"{ $"2" = "changed"; print $0, $"2" }"#,
            "a changed c changed\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("awk '{program}' <<'INPUT'\na b c\nINPUT\n"),
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
        assert_eq!(result.exit_code, 0, "{program}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{program}");
        assert_eq!(result.stdout, expected, "{program}");
    }
}

#[test]
fn awk_negative_string_field_selector_rejects_invalid_output() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec("awk '{ print $\"-1\" }' <<'INPUT'\na b c\nINPUT\n")
        .unwrap();
    assert_eq!(result.exit_code, 2);
    assert_eq!(result.stdout, "");
    assert_eq!(result.stderr, "awk: invalid or excessive field index\n");
}
