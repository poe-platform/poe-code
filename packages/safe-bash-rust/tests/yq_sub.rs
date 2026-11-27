use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn yq_sub_replaces_all_matches_and_expands_captures() {
    for (expression, expected) in [
        (r##"sub("[0-9]+"; "#")"##, "a# b#"),
        (r##"sub("([0-9]+)"; "[${1}]")"##, "a[1] b[22]"),
        (r##"sub("(?P<num>[0-9]+)"; "${num}:$num")"##, "a1:1 b22:22"),
        (r##"sub("[0-9]+"; "$$:$0:${missing}")"##, "a$:1: b$:22:"),
        (r##"sub("([0-9]+)"; "$1x:${1}x")"##, "a:1x b:22x"),
        (r##"sub("([0-9]+)(z)?"; "${2}!")"##, "a! b!"),
        (r##"sub("[0-9]+"; .)"##, "aa1 b22 ba1 b22"),
        (r##"sub("z"; "#")"##, "a1 b22"),
        (r##"sub("[0-9]*"; "#")"##, "#a# #b#"),
        (r##"sub("[0-9]+"; "$:${:$$:&")"##, "a$:${:$:& b$:${:$:&"),
        (r##"sub("(?<num>[0-9]+)"; "${num}")"##, "a1 b22"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!(
                    "printf %s 'v: \"a1 b22\"\n' | yq -I 0 -p=yaml -o=json '.v |= {expression}'"
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
        assert_eq!(result.exit_code, 0, "{expression}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{expression}");
        assert_eq!(
            result.stdout,
            format!("{{\"v\":\"{expected}\"}}\n"),
            "{expression}"
        );
    }
}

#[test]
fn jq_sub_keeps_first_match_and_jq_capture_interpolation() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec(r#"printf %s '"a1 b22"' | jq -r 'sub("(?<num>[0-9]+)"; "[\(.num)]")'"#)
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "a[1] b22\n");
}
