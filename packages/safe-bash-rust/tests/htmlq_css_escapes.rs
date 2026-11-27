use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn htmlq_matches_escaped_id_and_class_punctuation() {
    for (input, selector, expected) in [
        (r#"<p id="build.v2">done</p>"#, r"#build\.v2", "done\n"),
        (
            r#"<p class="build.v2 other">done</p>"#,
            r".build\.v2",
            "done\n",
        ),
        (
            r#"<p id="build" class="v2">wrong</p><p id="build.v2">done</p>"#,
            r"#build\.v2",
            "done\n",
        ),
        (
            r#"<p id="build" class="v2">done</p><p id="build.v2">wrong</p>"#,
            "#build.v2",
            "done\n",
        ),
        (r#"<p id="build:v2">done</p>"#, r"#build\:v2", "done\n"),
        (r#"<p class="build#v2">done</p>"#, r".build\#v2", "done\n"),
        (r#"<p id="build[v2]">done</p>"#, r"#build\[v2\]", "done\n"),
        (
            r#"<p id="build,v2">done</p><i>other</i>"#,
            r"#build\,v2, i",
            "done\nother\n",
        ),
        (r#"<p class="build>v2">done</p>"#, r".build\>v2", "done\n"),
        (r#"<p id="build+v2">done</p>"#, r"#build\+v2", "done\n"),
        (r#"<p id="build~v2">done</p>"#, r"#build\~v2", "done\n"),
        (r#"<p id="build(v2)">done</p>"#, r"#build\(v2\)", "done\n"),
        (r#"<p id="build\v2">done</p>"#, r"#build\\v2", "done\n"),
        (r#"<p id="build v2">done</p>"#, r"#build\ v2", "done\n"),
        (r#"<p id="build ">done</p>"#, r"#build\ ", "done\n"),
        (
            r#"<p id="build.v2" class="ready">done</p>"#,
            r"p#build\.v2.ready",
            "done\n",
        ),
        (
            r#"<div class="build.v2"><p>done</p></div>"#,
            r".build\.v2 > p",
            "done\n",
        ),
        (
            r#"<p id="build.v2">wrong</p><p>done</p>"#,
            r"p:not(#build\.v2)",
            "done\n",
        ),
        (
            r#"<p id="build)v2">wrong</p><p>done</p>"#,
            r"p:not(#build\)v2)",
            "done\n",
        ),
        (
            r#"<p id="build ">wrong</p><p>done</p>"#,
            r"p:not(#build\ )",
            "done\n",
        ),
        (
            r#"<p id="build.v2">wrong</p><p>done</p>"#,
            r"p:not( #build\.v2 )",
            "done\n",
        ),
        (r#"<p id="build&amp;v2">done</p>"#, r"#build\&v2", "done\n"),
        (
            r#"<p id="build&quot;v2">done</p>"#,
            r###"#build\"v2"###,
            "done\n",
        ),
        (
            r#"<div id="build.v2"><p>done</p></div>"#,
            r"#build\.v2 p",
            "done\n",
        ),
        (
            r#"<div id="build.v2"></div><p>done</p><p>later</p>"#,
            r"#build\.v2 + p",
            "done\n",
        ),
        (
            r#"<div id="build.v2"></div><i></i><p>done</p>"#,
            r"#build\.v2 ~ p",
            "done\n",
        ),
        (
            r#"<p data-build="v1,v2">done</p><i>other</i>"#,
            r#"p[data-build="v1,v2"], i"#,
            "done\nother\n",
        ),
        (r#"<p id="build.v2">done</p>"#, r"#build\2e v2", "done\n"),
        (
            r#"<p class="build.v2">done</p>"#,
            r".build\00002ev2",
            "done\n",
        ),
        (r#"<p id="café.v2">done</p>"#, r"#caf\e9 \.v2", "done\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}' | htmlq -t '{selector}'"),
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
        assert_eq!(result.exit_code, 0, "{selector}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{selector}");
        assert_eq!(result.stderr, "", "{selector}");
    }
}

#[test]
fn htmlq_removes_nodes_by_escaped_identifiers() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            r#"printf %s '<div><p id="build.v2">old</p><p>done</p></div>' | htmlq -t -r '#build\.v2' div"#,
            ExecOptions {
                cwd: Some("/".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "done\n");
    assert_eq!(result.stderr, "");
}
