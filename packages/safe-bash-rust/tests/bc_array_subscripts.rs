use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_array_subscripts_apply_increment_and_decrement_side_effects_once() {
    for (input, expected) in [
        ("i=0;a[i++]=5;a[i++]=7;i;a[0];a[1]", "2\n5\n7\n"),
        ("i=0;a[++i]=5;a[++i]=7;i;a[0];a[1];a[2]", "2\n0\n5\n7\n"),
        ("i=2;a[i--]=5;a[--i]=7;i;a[0];a[1];a[2]", "0\n7\n0\n5\n"),
        ("i=0;a[i++]+=5;a[i++]+=7;i;a[0];a[1]", "2\n5\n7\n"),
        ("i=0;a[i++]=i;i;a[0];a[1]", "1\n1\n0\n"),
        ("i=0;a[i++]+=i;i;a[0];a[1]", "1\n1\n0\n"),
        ("i=0;a[i++ + 1]=5;a[2*++i]=7;i;a[1];a[4]", "2\n5\n7\n"),
        ("i=0;a[i+++1]=5;a[i++-1]=7;i;a[0];a[1]", "2\n7\n5\n"),
        ("i=0;a[0]=5;a[1]=7;a[i++];a[++i-1];i", "5\n7\n2\n"),
        ("i=0;j[0]=1;a[j[i++]++]=5;i;j[0];a[1];a[2]", "1\n2\n5\n0\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("bc <<'INPUT'\n{input}\nINPUT"),
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
        assert_eq!(result.stdout, expected, "{input}");
        assert_eq!(result.stderr, "", "{input}");
    }
}
