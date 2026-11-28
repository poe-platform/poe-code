use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_nondecimal_output_preserves_fraction_and_input_precision() {
    for (input, expected) in [
        ("scale=4; obase=2; 2.625", "10.1010000000\n"),
        ("scale=0; obase=2; 2.625", "10.1010000000\n"),
        (
            "obase=2; -.625; .1; 2.000; 0.000; 2",
            "-.1010000000\n.0001\n10.0000000000\n0\n10\n",
        ),
        ("obase=3; .1; .01; 2.625", ".002\n.00002\n2.1212121\n"),
        ("obase=8; 2.625; .1", "2.5000\n.06\n"),
        ("obase=16; 2.625; .001; -2.625", "2.A00\n.004\n-2.A00\n"),
        (
            "scale=4; obase=2; 1/8; sqrt(4)",
            ".00100000000000\n10.00000000000000\n",
        ),
        (
            "scale=13; obase=2; 1/8",
            ".00100000000000000000000000000000000000000000\n",
        ),
        (
            "obase=2; x=2.625; print x,\",\",-x,\"\\n\"",
            "10.1010000000,-10.1010000000\n",
        ),
        (
            "scale=13; obase=2; sqrt(4)",
            "10.00000000000000000000000000000000000000000000\n",
        ),
        (
            "obase=2; 9007199254740993.625",
            "100000000000000000000000000000000000000000000000000001.1010000000\n",
        ),
        ("obase=10; 2.625; -.625", "2.625\n-.625\n"),
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
