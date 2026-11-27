use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn yq_literal_blocks_preserve_body_and_chomping_through_shell() {
    for (input, expected) in [
        (
            "notes: |+\n  hi\n\n    world\n\nnext: 2\n",
            "{\"notes\":\"hi\\n\\n  world\\n\\n\",\"next\":2}\n",
        ),
        (
            "notes: |\n  hi\n\n    world\n\nnext: 2\n",
            "{\"notes\":\"hi\\n\\n  world\\n\",\"next\":2}\n",
        ),
        (
            "notes: |-\n  hi\n\n    world\n\nnext: 2\n",
            "{\"notes\":\"hi\\n\\n  world\",\"next\":2}\n",
        ),
        (
            "notes: |+ # keep\n\n  # body  \n  ---\n\n",
            "{\"notes\":\"\\n# body  \\n---\\n\\n\"}\n",
        ),
        ("notes: |2+\n    hi\n\n", "{\"notes\":\"  hi\\n\\n\"}\n"),
        ("notes: |+2\n    hi\n\n", "{\"notes\":\"  hi\\n\\n\"}\n"),
        ("notes: |+\n  hi", "{\"notes\":\"hi\"}\n"),
        ("notes: |\nnext: 2\n", "{\"notes\":\"\",\"next\":2}\n"),
        ("- |+\n  hi\n\n- end\n", "[\"hi\\n\\n\",\"end\"]\n"),
        (
            "outer:\n  notes: |-\n    hi\n\n  next: 2\n",
            "{\"outer\":{\"notes\":\"hi\",\"next\":2}}\n",
        ),
        (
            "- notes: |2+\n    hi\n\n  next: 2\n",
            "[{\"notes\":\"hi\\n\\n\",\"next\":2}]\n",
        ),
        (
            "- notes:\n  - hi\n  next: 2\n",
            "[{\"notes\":[\"hi\"],\"next\":2}]\n",
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                mode: BackendMode::NativeOnly,
            },
        );
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}' | yq -I 0 -p=yaml -o=json ."),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{input}");
        assert_eq!(result.stderr, "");
        assert!(!result.used_typescript_bridge);
    }
}
