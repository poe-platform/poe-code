use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn recursive_values_anchor_produces_only_its_actual_rows() {
    for (anchor, expected) in [
        ("VALUES(1,10)", "1|10\n2|20\n3|30\n"),
        ("VALUES(1,10),(4,40)", "1|10\n2|20\n3|30\n4|40\n"),
        ("SELECT 1,10", "1|10\n2|20\n3|30\n"),
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
            .exec_with_options(
                &format!("sqlite3 :memory: 'WITH RECURSIVE r(a,b) AS ({anchor} UNION ALL SELECT a+1,b+10 FROM r WHERE a<3) SELECT a,b FROM r ORDER BY a;'"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(
            (result.exit_code, result.stderr.as_str()),
            (0, ""),
            "{anchor}"
        );
        assert_eq!(result.stdout, expected, "{anchor}");
        assert!(!result.used_typescript_bridge);
    }
}
