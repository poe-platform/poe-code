use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn assigned_record_preserves_its_scalar_truth() {
    for (program, input, expected) in [
        (
            r#"$1 == 0 { print "bug" }
{
    $0 = "0"
    if (!$0) print "another bug"
    $0 = a = "0"
    if (!$0) print "yet another bug"
    if ($1) print "a buggie"
}"#,
            "\n",
            "",
        ),
        (
            r#"{
    print !!$0
    $0 = "0"
    print !!$0, !!$1
    $0 = a = "0"
    print !!$0, !!a, !!$1
    $0 = 0
    print !!$0, !!$1
}"#,
            "0\n0\n",
            "0\n1 0\n1 1 0\n0 0\n0\n1 0\n1 1 0\n0 0\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("awk '{program}' <<'INPUT'\n{input}INPUT\n"),
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
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stderr, "");
        assert_eq!(result.stdout, expected, "{program}");
    }
}
