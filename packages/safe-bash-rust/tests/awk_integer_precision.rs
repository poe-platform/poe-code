use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn awk_integer_precision_preserves_fixed_width_fields() {
    for (program, expected) in [
        (
            "BEGIN { printf \"%.10d:%.10x\\n\", 5, 14 }\n",
            "0000000005:000000000e\n",
        ),
        (
            r#"BEGIN { printf "%.5d|%.5i|%.5u|%.5o|%.5x|%.5X\n", -5, 5, 5, 14, 14, 14 }"#,
            "-00005|00005|00005|00016|0000e|0000E\n",
        ),
        (
            r#"BEGIN { printf "[%+8.5d][% 8.5d][%08.5d][%-8.5d]\n", 5, 5, -5, 5 }"#,
            "[  +00005][   00005][  -00005][00005   ]\n",
        ),
        (
            r#"BEGIN { printf "[%#.5x][%#.5X][%#.5o][%#8.5x][%#08.5x]\n", 14, 14, 14, 14, 14 }"#,
            "[0x0000e][0X0000E][000016][ 0x0000e][ 0x0000e]\n",
        ),
        (
            r#"BEGIN { printf "[%.0d][%.0i][%.0u][%.0o][%.0x][%.0X][%#.0o][%#.0x][%+.0d]\n", 0, 0, 0, 0, 0, 0, 0, 0, 0 }"#,
            "[][][][][][][0][0][]\n",
        ),
        (
            r#"BEGIN { printf "[%8.3d][%.3d][%#.1o][%#.5o]\n", 12345, -12345, 14, 0 }"#,
            "[   12345][-12345][016][00000]\n",
        ),
        (
            r#"BEGIN { print sprintf("[%0*.*d][%.*x][%08.*d]", 8, 5, 5, 5, 14, -1, 5) }"#,
            "[   00005][0000e][00000005]\n",
        ),
        (
            r#"BEGIN { printf "[%d][%x][%08d][%08.2f][%.3s]\n", 5, 14, -5, 1.25, "hello" }"#,
            "[5][e][-0000005][00001.25][hel]\n",
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                mode: BackendMode::NativeOnly,
            },
        );
        let result = shell
            .exec_with_options(&format!("awk '{program}'"), ExecOptions::default())
            .unwrap();
        assert_eq!(result.exit_code, 0, "{program}: {result:?}");
        assert_eq!(result.stdout, expected, "{program}");
        assert_eq!(result.stderr, "", "{program}");
        assert!(!result.used_typescript_bridge);
    }
}
