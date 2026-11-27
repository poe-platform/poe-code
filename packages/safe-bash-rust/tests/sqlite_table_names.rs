use safe_bash_rust::{ExecOptions, Shell};

#[test]
fn sqlite_reads_quoted_table_names_containing_spaces() {
    for create in ["CREATE TABLE", "CREATE TABLE IF NOT EXISTS"] {
        for source in ["\"order lines\"", "\"order lines\" AS orders"] {
            let (mut shell, _) = Shell::with_memory_fs();
            let result = shell.exec_with_options(
                &format!("sqlite3 :memory: <<'INPUT'\n{create} \"order lines\"(n); INSERT INTO \"order lines\" VALUES(4); SELECT SUM(n) FROM {source};\nINPUT"),
                ExecOptions {
                    cwd: Some("/".into()),
                    env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                    ..Default::default()
                },
            ).unwrap();
            assert_eq!(result.exit_code, 0, "{result:?}");
            assert_eq!(result.stderr, "");
            assert_eq!(result.stdout, "4\n", "{create}: {source}");
        }
    }
}
