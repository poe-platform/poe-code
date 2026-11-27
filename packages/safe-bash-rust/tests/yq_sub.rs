use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

fn check(script: &str, expected: &str) {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            script,
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{script}: {}", result.stderr);
    assert_eq!(result.stderr, "", "{script}");
    assert_eq!(result.stdout, expected, "{script}");
}

#[test]
fn yq_sub_replaces_every_match_through_shell() {
    check(
        "printf %s 'v: \"a1 b22\"\n' | yq -I 0 -p=yaml -o=json '.v |= sub(\"[0-9]+\"; \"#\")'",
        "{\"v\":\"a# b#\"}\n",
    );
}

#[test]
fn yq_sub_expands_numbered_and_named_captures() {
    for (pattern, replacement, expected) in [
        ("([a-z])([0-9]+)", "${2}-$1", "1-a 22-b"),
        (
            "(?P<letter>[a-z])(?P<digits>[0-9]+)",
            "${digits}-$letter",
            "1-a 22-b",
        ),
        (
            "([a-z])([0-9]+)",
            "$0/$$/${1}x/$1x/$missing/$9",
            "a1/$/ax/// b22/$/bx///",
        ),
        ("([a-z])([0-9]+)", "${1}/${2}", "a/1 b/22"),
        ("([a-z])([0-9]+)", "$01/${01}/$00", "// //"),
        ("([a-z])([0-9]+)", "$é/$1é", "/ /"),
    ] {
        check(
            &format!(
                "printf %s 'v: \"a1 b22\"\n' | yq -I 0 -p=yaml -o=json '.v |= sub(\"{pattern}\"; \"{replacement}\")'"
            ),
            &format!("{{\"v\":\"{expected}\"}}\n"),
        );
    }
}

#[test]
fn yq_sub_handles_no_matches_empty_matches_and_unicode() {
    for (input, pattern, replacement, expected) in [
        ("abc", "[0-9]+", "#", "abc"),
        ("ab ab", "a|ab", "#", "#b #b"),
        ("aA", "(?i)a", "#", "##"),
        ("ab ab", "(?<letter>a)b", "${letter}", "a a"),
        ("a1 b22", "[0-9]+", "", "a b"),
        ("é🦀", "", "#", "#é#🦀#"),
        ("a1 b22", "[0-9]*", "#", "#a# #b#"),
        ("ab b", "(a)?b", "<$1>", "<a> <>"),
        ("é1 🦀22", "(.)([0-9]+)", "${2}${1}", "1é 22🦀"),
        (
            "a1 b22",
            "[0-9]+",
            "$/${oops/$!",
            "a$/${oops/$! b$/${oops/$!",
        ),
    ] {
        check(
            &format!(
                "printf %s 'v: \"{input}\"\n' | yq -I 0 -p=yaml -o=json '.v |= sub(\"{pattern}\"; \"{replacement}\")'"
            ),
            &format!("{{\"v\":\"{expected}\"}}\n"),
        );
    }
}

#[test]
fn jq_sub_keeps_first_match_and_jq_capture_interpolation() {
    check(
        r##"printf %s '"a1 b22"' | jq -c 'sub("[0-9]+"; "#")'"##,
        "\"a# b22\"\n",
    );
    check(
        r##"printf %s '"a1 b22"' | jq -c 'gsub("(?<digits>[0-9]+)"; "[\(.digits)]")'"##,
        "\"a[1] b[22]\"\n",
    );
}

#[test]
fn yq_sub_evaluates_replacement_against_input() {
    check(
        r#"printf %s 'v: "abc"' | yq -I 0 -p=yaml -o=json '.v |= sub("a"; .)'"#,
        "{\"v\":\"abcbc\"}\n",
    );
}

#[test]
fn yq_sub_rejects_invalid_patterns() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec(r#"printf %s 'v: abc' | yq -I 0 -p=yaml -o=json '.v |= sub("["; "x")'"#)
        .unwrap();
    assert_ne!(result.exit_code, 0);
    assert_eq!(result.stdout, "");
    assert!(!result.stderr.is_empty());
}

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
fn jq_sub_preserves_named_capture_in_raw_output() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec(r#"printf %s '"a1 b22"' | jq -r 'sub("(?<num>[0-9]+)"; "[\(.num)]")'"#)
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "a[1] b22\n");
}
