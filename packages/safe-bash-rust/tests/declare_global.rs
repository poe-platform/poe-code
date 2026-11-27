use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn global_declarations_preserve_shadowing_locals() {
    for (script, expected) in [
        (
            r#"x=orig; f(){ local x=local; declare -g x=new; echo "$x"; }; f; echo "$x""#,
            "local\nnew\n",
        ),
        (
            r#"f(){ local x=local; declare -g x=new; echo "$x"; }; f; echo "$x""#,
            "local\nnew\n",
        ),
        (
            r#"x=orig; inner(){ local x=inner; declare -g x+=new; echo "$x"; }; outer(){ local x=outer; inner; echo "$x"; }; outer; echo "$x""#,
            "inner\nouter\norignew\n",
        ),
        (
            r#"x=orig; inner(){ typeset -g x=new; echo "$x"; }; outer(){ local x=outer; inner; echo "$x"; }; outer; echo "$x""#,
            "outer\nouter\nnew\n",
        ),
        (
            r#"declare -i x=2; f(){ local -u x=local; declare -g x+=3; declare -p x; }; f; declare -p x"#,
            "declare -u x=\"LOCAL\"\ndeclare -i x=\"5\"\n",
        ),
        (
            r#"x=orig; f(){ local -r x=local; declare -g x=new; echo "$x"; }; f; echo "$x""#,
            "local\nnew\n",
        ),
        (
            r#"x=(orig tail); f(){ local x=local; declare -ga x=(new); echo "$x"; }; f; declare -p x"#,
            "local\ndeclare -a x=([0]=\"new\")\n",
        ),
        (
            r#"x=orig; f(){ local x=local; declare -gr x=new; echo "$x"; }; f; declare -p x"#,
            "local\ndeclare -r x=\"new\"\n",
        ),
        (
            r#"x=orig; f(){ local x=local; declare -gp x; }; f"#,
            "declare -- x=\"local\"\n",
        ),
        (
            r#"x=orig; f(){ local x=local; declare -g x=first x+=second y=new; echo "$x:$y"; }; f; echo "$x:$y""#,
            "local:new\nfirstsecond:new\n",
        ),
        (
            r#"x=orig; f(){ local x=local; declare -g x="$x"; echo "$x"; }; f; echo "$x""#,
            "local\nlocal\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                script,
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
        assert_eq!(result.exit_code, 0, "{script}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{script}");
        assert_eq!(result.stderr, "", "{script}");
    }
}

#[test]
fn failed_global_declarations_restore_local_bindings() {
    for (script, expected, error) in [
        (
            r#"declare -A x=([k]=orig); f(){ local x=local; declare -ga x=(new); local rc=$?; echo "$x"; return "$rc"; }; f; rc=$?; echo "${x[k]}"; exit "$rc""#,
            "local\norig\n",
            "cannot convert associative to indexed array",
        ),
        (
            r#"x=orig; f(){ local x=local; declare -gi x=1/0; }; f"#,
            "",
            "division by 0",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                script,
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
        assert_eq!(result.exit_code, 1, "{script}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{script}");
        assert!(result.stderr.contains(error), "{script}: {}", result.stderr);
    }
}
