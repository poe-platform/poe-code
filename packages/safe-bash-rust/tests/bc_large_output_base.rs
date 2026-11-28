use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_large_output_bases_use_fixed_width_decimal_groups() {
    for (input, expected) in [
        ("obase=100; 10507", " 01 05 07\n"),
        (
            "obase=100; -10507; 1; 99; 100; 0; -0",
            "- 01 05 07\n 01\n 99\n 01 00\n0\n0\n",
        ),
        ("obase=17; 16; 17; 288", " 16\n 01 00\n 16 16\n"),
        (
            "obase=101; 100; 101; 10202",
            " 100\n 001 000\n 001 000 001\n",
        ),
        ("obase=1000; 1005007", " 001 005 007\n"),
        (
            "obase=100; .123; 1.234; -1.234; 100.00",
            ".12 30\n 01.23 40\n- 01.23 40\n 01 00.00\n",
        ),
        ("obase=17; .1; 1.23", ".01\n 01.03 15\n"),
        (
            "obase=100; print 10507,\",\",-10507,\"\\n\"",
            " 01 05 07,- 01 05 07\n",
        ),
        (
            "obase=16; 254; obase=10; 10507; obase=2; 7",
            "FE\n10507\n111\n",
        ),
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
