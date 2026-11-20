use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn text(value: &Value) -> String {
    let Value::String(units) = value else {
        panic!("string")
    };
    String::from_utf16(units).unwrap()
}

#[test]
fn markdown_line_endings_nul_and_bom_match_javascript() {
    let Value::Array(cases) = json::parse(
        include_bytes!("fixtures/pandoc-input-normalization.json"),
        Default::default(),
    )
    .unwrap() else {
        panic!("fixtures")
    };
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let mut differences = Vec::new();
    for case in cases {
        let source = text(case.get("source").unwrap());
        let from = text(case.get("from").unwrap());
        let output = shell
            .exec_with_options(
                &format!("pandoc -f {from} -t json"),
                ExecOptions {
                    stdin: Some(source.clone()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(output.exit_code, 0, "{from}: {source:?}: {}", output.stderr);
        let actual = json::parse(output.stdout.as_bytes(), Default::default()).unwrap();
        if actual.get("blocks") != case.get("blocks") || actual.get("meta") != case.get("meta") {
            differences.push(format!("{from}: {source:?}: {}", output.stdout));
        }
    }
    assert!(
        differences.is_empty(),
        "{} differences:\n{}",
        differences.len(),
        differences.join("\n")
    );
}

#[test]
fn nul_expansion_is_bounded_and_preserves_existing_output() {
    let fs = MemoryVfs::new();
    fs.write_file("/saved", b"KEEP").unwrap();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    shell.set_limits(safe_bash_rust::ShellLimits {
        max_memory_bytes: 1024,
        ..Default::default()
    });
    let output = shell
        .exec_with_options(
            "pandoc -f gfm -t docx -o /saved",
            ExecOptions {
                stdin: Some("\0".repeat(400)),
                ..Default::default()
            },
        )
        .unwrap();
    assert_ne!(output.exit_code, 0);
    assert!(
        output
            .stderr
            .contains("Markdown normalization exceeds memory limit"),
        "{}",
        output.stderr
    );
    assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
}

#[test]
fn typed_json_strings_are_not_markdown_normalized() {
    let source = r#"{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[{"t":"Para","c":[{"t":"Str","c":"a\rb\u0000c\ufeffd"}]}]}"#;
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let output = shell
        .exec_with_options(
            "pandoc -f json -t json",
            ExecOptions {
                stdin: Some(source.into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(output.exit_code, 0, "{}", output.stderr);
    let actual = json::parse(output.stdout.as_bytes(), Default::default()).unwrap();
    let expected = json::parse(source.as_bytes(), Default::default()).unwrap();
    assert_eq!(actual.get("blocks"), expected.get("blocks"));
}
