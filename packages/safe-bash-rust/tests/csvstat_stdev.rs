use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn csvstat_sample_stdev_preserves_decimal_differences() {
    for (rows, expected) in [
        ("0\n1\n2", "1"),
        ("9007199254740992\n9007199254740993\n9007199254740994", "1"),
        ("9007199254740994\n9007199254740992\n9007199254740993", "1"),
        (
            "-9007199254740992\n-9007199254740993\n-9007199254740994",
            "1",
        ),
        (
            "9007199254740992.1\n9007199254740992.2\n9007199254740992.3",
            "0.1",
        ),
        (
            "9007199254740992.00\n9007199254740992.5\n9007199254740993",
            "0.5",
        ),
        (
            "9.007199254740992e15\n9.007199254740993e15\n9.007199254740994e15",
            "1",
        ),
        (
            "1000000000000000000000000000\n1000000000000000000000000001\n1000000000000000000000000002",
            "1",
        ),
        (
            "9007199254740992\nNULL\n9007199254740993\n9007199254740994",
            "1",
        ),
        ("9007199254740993\n9007199254740993", "0"),
        ("9007199254740993", "None"),
        ("9007199254740992\n9007199254740993", "0.707"),
        (
            "9007199254740992\n9007199254740993\n9007199254740996",
            "2.082",
        ),
        ("-1\n0\n1", "1"),
        ("-1e308\n1e308", "Infinity"),
        ("Infinity\n2", "NaN"),
        ("2\nNaN", "NaN"),
        ("1e-100\n1\n2", "1"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s 'amount\n{rows}\n' > a.csv\ncsvstat --stdev -c amount a.csv"),
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
        assert_eq!(result.exit_code, 0, "{rows}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{rows}");
        assert_eq!(result.stdout, format!("{expected}\n"), "{rows}");
    }
}

#[test]
fn csvstat_reports_decimal_stdev_in_all_output_modes() {
    for (options, expected) in [
        ("", "\tStDev:                 1\n"),
        ("--csv", "stdev\n1\n"),
        ("--json", "\"stdev\": 1.0"),
        ("--stdev --decimal-format %.6f -G", "1\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let pipe = if options == "--csv" {
            " | csvcut -c stdev"
        } else {
            ""
        };
        let result = shell
            .exec(&format!(
                "csvstat {options} <<'CSV'{pipe}\namount\n9007199254740992\n9007199254740993\n9007199254740994\nCSV\n"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{options}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{options}");
        assert!(
            result.stdout.contains(expected),
            "{options}: {}",
            result.stdout
        );
    }
}
