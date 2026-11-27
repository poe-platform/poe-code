use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn xan_numeric_sort_preserves_adjacent_large_integer_keys() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            "xan sort -N -s n <<'INPUT'\nk,n\na,9007199254740993\nb,9007199254740992\na,3\nINPUT",
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(
        result.stdout,
        "k,n\na,3\nb,9007199254740992\na,9007199254740993\n"
    );
}

#[test]
fn xan_numeric_sort_preserves_signed_integer_order_and_secondary_keys() {
    for (command, input, expected) in [
        (
            "xan sort -N -s n",
            "n\n-9007199254740992\n-9007199254740993\n9223372036854775807\n9223372036854775806\n-9223372036854775807\n-9223372036854775808\n",
            "n\n-9223372036854775808\n-9223372036854775807\n-9007199254740993\n-9007199254740992\n9223372036854775806\n9223372036854775807\n",
        ),
        (
            "xan sort -N -R -s n",
            "n\n9007199254740992\n9007199254740993\n3\n",
            "n\n9007199254740993\n9007199254740992\n3\n",
        ),
        (
            "xan sort -N -s n,k",
            "n,k\n9007199254740993,0\n9007199254740992,2\n9007199254740992,1\n",
            "n,k\n9007199254740992,1\n9007199254740992,2\n9007199254740993,0\n",
        ),
        (
            "xan sort -N -u -s n",
            "n\n9007199254740993\n9007199254740992\n9007199254740993\n",
            "n\n9007199254740992\n9007199254740993\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                command,
                ExecOptions {
                    stdin: Some(input.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{command}");
        assert_eq!(result.stdout, expected, "{command}");
    }
}

#[test]
fn xan_numeric_sort_keeps_float_fallback_and_lexical_sort() {
    for (command, input, expected) in [
        (
            "xan sort -N -s n",
            "n\n10\n2.5\n-3\n1e2\n",
            "n\n-3\n2.5\n10\n1e2\n",
        ),
        (
            "xan sort -N -s n",
            "n\n9223372036854775808\n3\n1e20\n",
            "n\n3\n9223372036854775808\n1e20\n",
        ),
        ("xan sort -s n", "n\n2\n10\n", "n\n10\n2\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                command,
                ExecOptions {
                    stdin: Some(input.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{command}");
        assert_eq!(result.stdout, expected, "{command}");
    }
}
