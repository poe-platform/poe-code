use safe_bash_rust::{ExecOptions, Shell};

#[test]
fn xan_dedup_retains_every_duplicate_payload() {
    for (options, input, expected) in [
        (
            "--keep-duplicates -s k",
            "k,v\nx,1\nx,2\ny,3\n",
            "k,v\nx,1\nx,2\n",
        ),
        (
            "--keep-duplicates -s k",
            "k,v\nx,1\nx,2\nx,4\ny,3\n",
            "k,v\nx,1\nx,2\nx,4\n",
        ),
        ("--keep-duplicates -s k", "k,v\nx,1\ny,3\n", "k,v\n"),
        (
            "--keep-duplicates",
            "k,v\nx,1\nx,1\nx,2\n",
            "k,v\nx,1\nx,1\n",
        ),
        (
            "--keep-duplicates -s k",
            "k,v\nx,1\ny,2\nz,3\ny,4\nx,5\n",
            "k,v\nx,1\ny,2\ny,4\nx,5\n",
        ),
        ("-s k", "k,v\nx,1\nx,2\ny,3\n", "k,v\nx,1\ny,3\n"),
        (
            "--keep-last -s k",
            "k,v\nx,1\nx,2\ny,3\n",
            "k,v\nx,2\ny,3\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("xan dedup {options} <<'INPUT'\n{input}INPUT\n"),
                ExecOptions {
                    cwd: Some("/".into()),
                    env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{options}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{options}");
        assert_eq!(result.stdout, expected, "{options}: {input}");
        assert!(!result.used_typescript_bridge);
    }
}
