use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn awk_record_numbers_continue_from_assigned_values() {
    for (command, expected) in [
        ("awk '{if(NR==1) NR=7;print NR,FNR}'", "7 1\n8 2\n"),
        ("awk '{if(NR==1) FNR=7;print NR,FNR}'", "1 7\n2 8\n"),
        ("awk 'BEGIN{NR=6} {print NR,FNR}'", "7 1\n8 2\n"),
        ("awk -v NR=6 '{print NR,FNR}'", "7 1\n8 2\n"),
        ("awk '{NR+=2;FNR++;print NR,FNR}'", "3 2\n6 4\n"),
        (
            "awk 'NR==1{NR=7.5;FNR=-2.5} {print NR,FNR}'",
            "7 -2\n8 -1\n",
        ),
        (
            "awk 'BEGIN{NR=6;getline;print NR,FNR} {print NR,FNR}'",
            "7 1\n8 2\n",
        ),
        ("awk '{if(NR==1) NR=7} END{print NR,FNR}'", "8 2\n"),
        (
            "printf 'a\\nb\\n' > /first; printf 'c\\n' > /second; awk 'NR==1{NR=7;FNR=4} {print NR,FNR}' /first /second",
            "7 4\n8 5\n9 1\n",
        ),
        ("awk '{print NR,FNR}' NR=6", "7 1\n8 2\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("{command} <<'INPUT'\n1 2\n3 4\nINPUT"),
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
        assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{command}");
        assert_eq!(result.stdout, expected, "{command}");
    }
}
