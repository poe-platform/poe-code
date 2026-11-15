use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn markdown_entities_public_command() {
    let Value::Array(cases) = json::parse(
        include_bytes!("../../safe-bash-command-pandoc/conformance/markdown-entities.json"),
        Default::default(),
    )
    .unwrap() else {
        panic!()
    };
    let field = |case: &Value, key: &str| {
        let Some(Value::String(value)) = case.get(key) else {
            panic!("{key}")
        };
        String::from_utf16(value).unwrap()
    };
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    for case in cases {
        for target in ["json", "plain", "html"] {
            let result = shell
                .exec_with_options(
                    &format!("pandoc -f markdown -t {target}"),
                    ExecOptions {
                        stdin: Some(field(&case, "input")),
                        ..Default::default()
                    },
                )
                .unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            if target == "json" {
                let actual = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
                assert_eq!(
                    actual.get("blocks"),
                    case.get("blocks"),
                    "{}",
                    field(&case, "name")
                );
            } else {
                assert_eq!(
                    result.stdout,
                    field(&case, target),
                    "{} {target}",
                    field(&case, "name")
                );
            }
        }
    }
}
