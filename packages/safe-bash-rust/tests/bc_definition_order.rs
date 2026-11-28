use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_calls_use_definitions_read_so_far() {
    for (program, expected) in [
        (
            "define f(){return(1);}\nf()\ndefine f(){return(2);}\nf()\n",
            "1\n2\n",
        ),
        (
            "define f(){return(1);}\ndefine g(){return(f());}\ng()\ndefine f(){return(2);}\ng()\n",
            "1\n2\n",
        ),
        (
            "define f(){\nif (1) {return(1);}\n}\nf(); define f(){return(2);} f()\n",
            "1\n2\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s '{program}' | bc"),
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
