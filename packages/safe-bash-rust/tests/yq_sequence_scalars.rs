use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn yq_preserves_colons_in_sequence_scalars() {
    for (script, expected) in [
        (
            "printf %s '- https://example.org/a:b\n- urn:id:7\n' | yq -I 0 -p=yaml -o=json .",
            "[\"https://example.org/a:b\",\"urn:id:7\"]\n",
        ),
        (
            "printf %s 'endpoints:\n  - https://example.org/a:b\n  - urn:id:7\n' | yq -I 0 -p=yaml -o=json .",
            "{\"endpoints\":[\"https://example.org/a:b\",\"urn:id:7\"]}\n",
        ),
        (
            "printf %s '- 12:34:56\n- a:b\n- \"a: b\"\n' | yq -I 0 -p=yaml -o=json .",
            "[\"12:34:56\",\"a:b\",\"a: b\"]\n",
        ),
        (
            "printf %s '- endpoint: https://example.org/a:b\n- id:\turn:id:7\n- empty:\n- nested:\n    value: urn:id:7\n' | yq -I 0 -p=yaml -o=json .",
            "[{\"endpoint\":\"https://example.org/a:b\"},{\"id\":\"urn:id:7\"},{\"empty\":null},{\"nested\":{\"value\":\"urn:id:7\"}}]\n",
        ),
        (
            "printf %s '- {endpoint: https://example.org/a:b}\n- [https://example.org/a:b, urn:id:7]\n' | yq -I 0 -p=yaml -o=json .",
            "[{\"endpoint\":\"https://example.org/a:b\"},[\"https://example.org/a:b\",\"urn:id:7\"]]\n",
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
            .exec_with_options(script, ExecOptions::default())
            .unwrap();
        assert_eq!(
            (result.exit_code, result.stderr.as_str()),
            (0, ""),
            "{script}"
        );
        assert_eq!(result.stdout, expected, "{script}");
        assert!(!result.used_typescript_bridge);
    }
}
