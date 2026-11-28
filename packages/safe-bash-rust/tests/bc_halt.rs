use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn bc_halt_in_function_terminates_the_program() {
    for caller in [
        "r=stop();99",
        "stop();99",
        "1+stop();99",
        "1/stop();99",
        "stop()+1/0;99",
        "print 7,stop(),99",
        "if (stop()) 88 else 99",
        "while (stop()) 88;99",
        "while (1) { r=stop();99; }",
        "for (r=stop();1;r++) 99",
        "for (;stop();) 88;99",
        "for (i=0;i<2;r=stop()) { i++; };99",
        "define outer(){return(stop());1/0;}\nouter();99",
        "define take(x){return(1/0);}\ntake(stop());99",
        "define broken(){halt;1/0;}\nbroken();99",
        "sqrt(stop()-1);99",
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let program = format!("define stop(){{halt;}}\n{caller}\n");
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
        assert_eq!(result.exit_code, 0, "{caller}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{caller}");
        let expected = if caller.starts_with("print") { "7" } else { "" };
        assert_eq!(result.stdout, expected, "{caller}");
    }
}
