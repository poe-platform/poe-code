use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::collections::BTreeMap;
use std::sync::Arc;

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

#[test]
fn awk_dot_matches_newlines_through_shell() {
    for (script, expected) in [
        (
            "awk 'BEGIN{x=\"a\\nb\";print (x~/a.b/)}' <<'INPUT'\n1 2\n3 4\nINPUT",
            "1\n",
        ),
        (
            r#"awk 'BEGIN{x="a\nb";p="a.b";print (x~p), (x!~p)}'"#,
            "1 0\n",
        ),
        (
            r#"awk 'BEGIN{x="a\nb";print (x~/^(a.b)$/), (x~/^b/), (x~/a$/)}'"#,
            "1 0 0\n",
        ),
        (
            r#"awk 'BEGIN{x="a\nb";print match(x,/a.b/), RSTART, RLENGTH}'"#,
            "1 1 3\n",
        ),
        (
            r#"awk 'BEGIN{x="a\nb";print sub(/a.b/,"ok",x), x}'"#,
            "1 ok\n",
        ),
        (
            r#"awk 'BEGIN{x="a\nba\nb";print gsub(/a.b/,"ok",x), x}'"#,
            "2 okok\n",
        ),
        (
            r#"awk 'BEGIN{print gensub(/a.b/,"ok","g","a\nb")}'"#,
            "ok\n",
        ),
        (
            r#"awk 'BEGIN{print split("lefta\nbright",a,/a.b/), a[1], a[2]}'"#,
            "2 left right\n",
        ),
        (
            r#"awk 'BEGIN{FS="a.b";$0="lefta\nbright";print NF, $1, $2}'"#,
            "2 left right\n",
        ),
        (
            r#"awk 'BEGIN{RS=""} /a.b/ {print "matched"}' <<'INPUT'
a
b
INPUT"#,
            "matched\n",
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                mode: BackendMode::NativeOnly,
            },
        );
        let result = shell
            .exec_with_options(script, ExecOptions::default())
            .unwrap();
        assert_eq!(
            (result.exit_code, result.stderr.as_str()),
            (0, ""),
            "{script}"
        );
        assert_eq!(result.stdout, expected, "{script}");
        assert!(!result.used_typescript_bridge);
    }
}
