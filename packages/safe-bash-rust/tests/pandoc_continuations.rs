use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn block_continuations_match_the_public_javascript_reader() {
    let Value::Array(cases) = json::parse(
        include_bytes!("fixtures/pandoc-continuations.json"),
        Default::default(),
    )
    .unwrap() else {
        panic!()
    };
    let text = |value: &Value, key: &str| {
        let Some(Value::String(text)) = value.get(key) else {
            panic!("{key}")
        };
        String::from_utf16(text).unwrap()
    };
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let mut failures = Vec::new();
    for case in cases {
        let format = text(&case, "from");
        let source = text(&case, "source");
        let result = shell
            .exec_with_options(
                &format!("pandoc -f {format} -t json"),
                ExecOptions {
                    stdin: Some(source.clone()),
                    ..Default::default()
                },
            )
            .unwrap();
        let actual = json::parse(result.stdout.as_bytes(), Default::default());
        if result.exit_code != 0
            || actual.as_ref().ok().and_then(|value| value.get("blocks")) != case.get("blocks")
        {
            failures.push(format!(
                "{} ({format}): {source:?}\n{}{}",
                text(&case, "id"),
                result.stderr,
                result.stdout
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} exact AST mismatches:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
