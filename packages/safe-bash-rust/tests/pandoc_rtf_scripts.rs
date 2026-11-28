use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn rtf_preserves_script_nodes_and_restores_baseline() {
    for (script, expected) in [
        (
            r#"printf %s '{\rtf1\ansi H{\sub 2}O X{\super 2}}' | pandoc -f rtf -t json | jq -c '[..|objects|select(.t?=="Subscript" or .t?=="Superscript")|.t]'"#,
            "[\"Subscript\",\"Superscript\"]\n",
        ),
        (
            r"printf %s '{\rtf1\ansi H{\sub 2}O X{\super 2}}' | pandoc -f rtf -t html",
            "<p>H<sub>2</sub>O X<sup>2</sup></p>\n",
        ),
        (
            r"printf %s '{\rtf1\ansi \sub a\super b\nosupersub c\sub d\plain e}' | pandoc -f rtf -t html",
            "<p><sub>a</sub><sup>b</sup>c<sub>d</sub>e</p>\n",
        ),
        (
            r"printf %s '{\rtf1\ansi {\sub a{\super b}c}d}' | pandoc -f rtf -t html",
            "<p><sub>a</sub><sup>b</sup><sub>c</sub>d</p>\n",
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                mode: BackendMode::NativeOnly,
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            },
        );
        let result = shell
            .exec_with_options(script, ExecOptions::default())
            .unwrap();
        assert_eq!(result.exit_code, 0, "{script}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{script}");
        assert_eq!(result.stdout, expected, "{script}");
    }
}
