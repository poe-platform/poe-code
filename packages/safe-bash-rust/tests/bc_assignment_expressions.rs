use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_assignment_expressions_update_bindings_and_yield_values() {
    for (program, expected) in [
        ("x=3; (x=8); x", "8\n8\n"),
        ("x=3; ((x=8)); x", "8\n8\n"),
        ("x=3; 2*(x=8)+1; x", "17\n8\n"),
        ("x=y=8; x; y", "8\n8\n"),
        ("(x=(y=8)+2); x; y", "10\n10\n8\n"),
        ("i=0; (a[i++]=8); i; a[0]", "8\n1\n8\n"),
        ("x=3; (x+=5); x", "8\n8\n"),
        ("x=1; (x+=2)*3; x", "9\n3\n"),
        ("x=2; (x^=3); x", "8\n8\n"),
        ("(scale=2); 1/2", "2\n.50\n"),
        ("(ibase=16); 10", "16\n16\n"),
        ("(obase=16); 15", "10\nF\n"),
        (
            "(x=.12345678901234567890); x",
            ".12345678901234567890\n.12345678901234567890\n",
        ),
        (
            "scale=30; (x=1/3); x",
            ".333333333333333333333333333333\n.333333333333333333333333333333\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s '{program}\n' | bc"),
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
