use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn yq_toml_multiline_arrays_through_shell() {
    for (input, expected) in [
        ("ports=[\n  80,\n  443,\n]\n", "{\"ports\":[80,443]}\n"),
        ("ports=[80,443,]\n", "{\"ports\":[80,443]}\n"),
        ("ports=[\n# empty\n]\n", "{\"ports\":[]}\n"),
        (
            "ports=[ # ]\n  80, # ]\n\n  443,\n] # done\nnext=true\n",
            "{\"ports\":[80,443],\"next\":true}\n",
        ),
        (
            "[server]\nports=[\r\n[80,\r\n443,],\r\n[8080],\r\n]\r\nenabled=true",
            "{\"server\":{\"ports\":[[80,443],[8080]],\"enabled\":true}}\n",
        ),
        (
            "values=[\n\"],#\",\n'[,#',\n{ports=[80,443]},\n]",
            "{\"values\":[\"],#\",\"[,#\",{\"ports\":[80,443]}]}\n",
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
        let quoted = input.replace('\'', "'\\''");
        let result = shell
            .exec_with_options(
                &format!("printf %s '{quoted}' | yq -I 0 -p=toml -o=json ."),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{input}");
        assert_eq!(result.stderr, "");
        assert!(!result.used_typescript_bridge);
    }
}

#[test]
fn yq_rejects_unterminated_toml_array_through_shell() {
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
            "printf %s 'ports=[\n80,\n443,\n' | yq -I 0 -p=toml -o=json .",
            ExecOptions::default(),
        )
        .unwrap();
    assert_ne!(result.exit_code, 0);
    assert_eq!(result.stdout, "");
    assert!(result.stderr.contains("unterminated TOML array"));
    assert!(!result.used_typescript_bridge);
}
