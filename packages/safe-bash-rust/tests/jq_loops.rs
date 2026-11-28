use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn loops_visit_every_update_branch_in_depth_first_order() {
    for (filter, expected) in [
        ("[1|until(.>=3;.+1,.+2)]", "[3,4,3]\n"),
        ("[1|while(.<3;.+1,.+2)]", "[1,2]\n"),
        ("[0|while(.<3;.+1,.+2)]", "[0,1,2,2]\n"),
        ("[1|until(.>=3;empty)]", "[]\n"),
        ("[1|while(.<3;empty)]", "[1]\n"),
        ("[3|until(.>=3;error(\"unused\"))]", "[3]\n"),
        ("[3|while(.<3;error(\"unused\"))]", "[]\n"),
        ("[1|until(.>=3;.+1)]", "[3]\n"),
        ("[1|while(.<3;.+1)]", "[1,2]\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s 'null\n' | jq -c '{filter}'"),
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
        assert_eq!(result.exit_code, 0, "{filter}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{filter}");
        assert_eq!(result.stderr, "", "{filter}");
    }
}
