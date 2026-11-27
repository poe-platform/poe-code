use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn csvsort_orders_exact_decimal_keys() {
    for (args, input, expected) in [
        (
            "-c k",
            "k,v\n9007199254740993,a\n9007199254740992,b\n",
            "k,v\n9007199254740992,b\n9007199254740993,a\n",
        ),
        (
            "-c k -r",
            "k\n9007199254740992\n9007199254740993\n",
            "k\n9007199254740993\n9007199254740992\n",
        ),
        (
            "-c k",
            "k\n-9007199254740992\n-9007199254740993\n",
            "k\n-9007199254740993\n-9007199254740992\n",
        ),
        (
            "-c k",
            "k\n1.000000000000000002\n1.000000000000000001\n",
            "k\n1.000000000000000001\n1.000000000000000002\n",
        ),
        (
            "-c k",
            "k\n1e1000\n9e999\n1e-1000\n9e-1001\n",
            "k\n9e-1001\n1e-1000\n9e999\n1e1000\n",
        ),
        (
            "-c k",
            "k,v\n1.0,a\n1e0,b\n01,c\n",
            "k,v\n1.0,a\n1e0,b\n01,c\n",
        ),
        ("-c k,v", "k,v\n1.0,b\n1e0,a\n", "k,v\n1e0,a\n1.0,b\n"),
        (
            "-c k",
            "k\n0\n-0\n0.00\n-0.1\n0.1\n",
            "k\n-0.1\n0\n-0\n0.00\n0.1\n",
        ),
        ("-c k -r", "k,v\n,a\n2,b\n10,c\n", "k,v\n10,c\n2,b\n,a\n"),
        ("-c k -I", "k\n2\n10\n", "k\n10\n2\n"),
        ("-c k -i", "k\nb\nA\n", "k\nA\nb\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("csvsort {args} <<'INPUT'\n{input}INPUT\n"),
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
        assert_eq!(result.exit_code, 0, "{args}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{args}");
        assert_eq!(result.stdout, expected, "{args}: {input}");
    }
}
