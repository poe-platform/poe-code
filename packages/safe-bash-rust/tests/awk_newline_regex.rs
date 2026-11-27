use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn awk_dot_matches_newlines_in_strings() {
    for (program, expected) in [
        (r#"BEGIN{x="a\nb";print (x~/a.b/)}"#, "1\n"),
        (
            r#"BEGIN{x="a\nb";p="a.b";print (x~p), (x!~/a.b/), match(x,/a.b/), RSTART, RLENGTH}"#,
            "1 0 1 1 3\n",
        ),
        (r#"BEGIN{x="a\nb";print sub(/a.b/,"yes",x), x}"#, "1 yes\n"),
        (
            r#"BEGIN{print split("lefta\nbright",a,/a.b/), a[1], a[2]}"#,
            "2 left right\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("awk '{program}' <<'INPUT'\n1 2\n3 4\nINPUT\n"),
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
