use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_updates_counters_once_in_compound_expressions() {
    for (input, expected) in [
        ("a=2; b=3; ++a*2+b++; a; b", "9\n3\n4\n"),
        ("a=2; b=3; --a*2+b--; a; b", "5\n1\n2\n"),
        ("a=2; b=3; a++*2+ ++b; a; b", "8\n3\n4\n"),
        ("a=2; b=3; x=++a*2+b++; x; a; b", "9\n3\n4\n"),
        ("a=2; b=3; (++a)*2+(b++); a; b", "9\n3\n4\n"),
        ("a=2; a++; ++a; a--; --a; a", "2\n4\n4\n2\n2\n"),
        ("a=2; a+++a++; a", "5\n4\n"),
        ("a=2; a++^2; a", "4\n3\n"),
        ("i=0; a[0]=2; ++a[i++]*2; a[0]; i", "6\n3\n1\n"),
        ("for (i=0; i<3; i++) i; i", "0\n1\n2\n3\n"),
        ("7; for (i=0; i<2; i++) {}; last; i", "7\n7\n2\n"),
        ("7; i=0; for (++i; i<2; i++) {}; last; i", "7\n7\n2\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}\n' | bc"),
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
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{input}");
        assert_eq!(result.stdout, expected, "{input}");
    }
}
