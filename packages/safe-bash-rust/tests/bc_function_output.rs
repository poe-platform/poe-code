use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_functions_share_the_callers_output_stream() {
    for (program, expected) in [
        (
            "define f(x) { print \"value=\",x,\"\\n\"; return(2*x); }\nf(5)",
            "value=5\n10\n",
        ),
        (
            "define f(x) { x; return(2*x); }\nprint \"before=\",f(5),\";after\\n\"",
            "before=5\n10;after\n",
        ),
        (
            "define g(x) { print \"inner=\",x,\"\\n\"; return(x+1); }\ndefine f(x) { print \"outer\\n\"; return(g(x)); }\ny=f(5);y",
            "outer\ninner=5\n6\n",
        ),
        (
            "define f(x) { if (x) { print x; return(f(x-1)); }; return(7); }\nf(3)",
            "3217\n",
        ),
        ("define f(x) { print x; }\nf(5)", "50\n"),
        ("define f(x) { print x; return(2*x); }\nf(1)+f(2)", "126\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s '{program}\n' | bc"),
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
        assert_eq!(result.exit_code, 0, "{program}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{program}");
        assert_eq!(result.stdout, expected, "{program}");
    }
}
