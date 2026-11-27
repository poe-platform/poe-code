use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn sqlite_delete_correlated_exists_selects_target_rows() {
    for (predicate, expected) in [
        ("NOT EXISTS (SELECT 1 FROM b WHERE b.id=a.id)", "2\n"),
        ("EXISTS (SELECT 1 FROM b WHERE b.id=a.id)", "1\n"),
        ("NOT EXISTS (SELECT 1 FROM b WHERE id=a.id)", "2\n"),
        (
            "NOT EXISTS (SELECT 1 FROM b WHERE b.id=a.id AND b.id=9)",
            "",
        ),
        ("NOT EXISTS (SELECT 1 FROM b)", "1\n2\n"),
        ("id=1", "2\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("sqlite3 :memory: 'CREATE TABLE a(id); CREATE TABLE b(id); INSERT INTO a VALUES(1),(2); INSERT INTO b VALUES(2); DELETE FROM a WHERE {predicate}; SELECT id FROM a;'"),
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
        assert_eq!(result.exit_code, 0, "{predicate}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{predicate}");
        assert_eq!(result.stderr, "", "{predicate}");
    }
}
