use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sort_nul_records_selects_numeric_fields_without_changing_bytes() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            r"printf 'A\nn 12\0C 2\0B 1\0' | sort -z -k2,2n | xxd -p",
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "410a6e203132004220310043203200\n");
}

#[test]
fn sort_blank_handling_matches_gnu_without_treating_all_whitespace_as_fields() {
    for (script, expected) in [
        (
            r"printf 'A\rn 12\0C 2\0B 1\0' | sort -z -k2,2n",
            "B 1\0C 2\0A\rn 12\0",
        ),
        (
            r"printf 'A\vn 12\0C 2\0B 1\0' | sort -z -k2,2n",
            "B 1\0C 2\0A\x0bn 12\0",
        ),
        (
            r"printf 'A\fn 12\0C 2\0B 1\0' | sort -z -k2,2n",
            "B 1\0C 2\0A\x0cn 12\0",
        ),
        (
            r"printf 'A\tn 12\0C 2\0B 1\0' | sort -z -k2,2n",
            "A\tn 12\0B 1\0C 2\0",
        ),
        (
            r"printf 'A n 12\0C 2\0B 1\0' | sort -z -k2,2n",
            "A n 12\0B 1\0C 2\0",
        ),
        (
            r"printf 'A\nn:12\0C:2\0B:1\0' | sort -z -t : -k2,2n",
            "B:1\0C:2\0A\nn:12\0",
        ),
        (r"printf '\n12\0 2\0\t1\0' | sort -zn", "\t1\0 2\0\n12\0"),
        (r"printf '\nz\0 b\0\ta\0' | sort -zb", "\ta\0 b\0\nz\0"),
        (
            r"printf 'A\nz\0B b\0C\ta\0' | sort -z -k2b,2",
            "C\ta\0B b\0A\nz\0",
        ),
        (r"printf 'az\0a\nz\0' | sort -zds", "a\nz\0az\0"),
        (
            r"printf '\n12K\0 2K\0\t1K\0' | sort -zh",
            "\t1K\0 2K\0\n12K\0",
        ),
        (
            r"printf '\nMar\0 Feb\0\tJan\0' | sort -zM",
            "\tJan\0 Feb\0\nMar\0",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                script,
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
        assert_eq!(result.exit_code, 0, "{script}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{script}");
        assert_eq!(result.stdout, expected, "{script}");
    }
}
