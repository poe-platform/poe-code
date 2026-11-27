use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn jq_values_preserves_every_non_null_value() {
    for (input, filter, expected) in [
        (r#"[0,false,null,""]"#, "map(values)", "[0,false,\"\"]\n"),
        (
            r#"[false,true,0,1,"","text",[],{},null]"#,
            "map(values)",
            "[false,true,0,1,\"\",\"text\",[],{}]\n",
        ),
        ("false", "values", "false\n"),
        ("null", "values", ""),
        ("[false,null,true]", "path(.[] | values)", "[0]\n[2]\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}' | jq -c '{filter}'"),
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
        assert_eq!(result.exit_code, 0, "{input} | {filter}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{input} | {filter}");
        assert_eq!(result.stderr, "", "{input} | {filter}");
    }
}
