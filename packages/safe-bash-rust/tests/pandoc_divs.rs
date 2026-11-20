use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn native_divs_match_public_javascript_structure_attributes_and_profiles() {
    let Value::Array(cases) = json::parse(
        include_bytes!("fixtures/pandoc-divs.json"),
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

#[test]
fn native_container_writers_keep_content_attributes_and_raw_policy() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let source = "<div id=\"box\" class=\"note\">\n<span id=\"part\" title=\"a &amp; b\">*content*</span>\n</div>\n";
    for (target, expected) in [
        (
            "html",
            "<div id=\"box\" class=\"note\"><p><span id=\"part\" title=\"a &amp; b\"><em>content</em></span></p>\n</div>\n",
        ),
        ("plain", "content\n"),
    ] {
        let output = shell
            .exec_with_options(
                &format!("pandoc -f markdown -t {target}"),
                ExecOptions {
                    stdin: Some(source.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(output.exit_code, 0, "{}", output.stderr);
        assert_eq!(output.stdout, expected);
    }
    let output = shell
        .exec_with_options(
            "pandoc -f markdown -t markdown",
            ExecOptions {
                stdin: Some("<span id=\"part\" title=\"a &amp; b\">*content*</span>".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(output.exit_code, 0, "{}", output.stderr);
    assert_eq!(output.stdout, "[*content*]{#part title=\"a & b\"}\n");
    for target in ["markdown", "rtf", "latex"] {
        let output = shell
            .exec_with_options(
                &format!("pandoc -f markdown -t {target}"),
                ExecOptions {
                    stdin: Some(source.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_ne!(
            output.exit_code, 0,
            "attributed {target} container must not silently lose attributes"
        );
    }
    let output = shell
        .exec_with_options(
            "pandoc -f markdown -t html --raw-content=reject",
            ExecOptions {
                stdin: Some("<div>\n<span>x</span><!--raw-->\n</div>".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_ne!(output.exit_code, 0);
    assert!(output.stderr.contains("Raw"), "{}", output.stderr);
}

#[test]
fn native_div_profiles_and_limits_fail_before_overwriting_output() {
    use safe_bash_rust::SafeBashFs;
    let fs = MemoryVfs::new();
    fs.write_file("/output", b"unchanged").unwrap();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    for from in ["commonmark+native_divs", "commonmark-native_divs"] {
        let output = shell
            .exec_with_options(
                &format!("pandoc -f {from} -t json -o /output"),
                ExecOptions {
                    stdin: Some("<div>x</div>".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_ne!(output.exit_code, 0);
        assert!(
            output.stderr.contains("Unsupported extension"),
            "{}",
            output.stderr
        );
        assert_eq!(fs.read_file("/output").unwrap(), b"unchanged");
    }
    let source = format!("{}text\n{}", "<div>\n".repeat(70), "</div>\n".repeat(70));
    for from in ["markdown", "gfm+native_divs"] {
        let output = shell
            .exec_with_options(
                &format!("pandoc -f {from} -t json -o /output"),
                ExecOptions {
                    stdin: Some(source.clone()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_ne!(output.exit_code, 0);
        assert_eq!(fs.read_file("/output").unwrap(), b"unchanged");
    }
}

#[test]
fn malformed_native_div_keeps_source_and_rejects_binary_data_loss() {
    use safe_bash_rust::SafeBashFs;
    let fs = MemoryVfs::new();
    fs.write_file("/output", b"unchanged").unwrap();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let source = "<div title=\"broken>\na\n</div>\n";
    for target in ["docx", "pdf"] {
        let output = shell
            .exec_with_options(
                &format!("pandoc -f markdown -t {target} -o /output"),
                ExecOptions {
                    stdin: Some(source.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_ne!(
            output.exit_code, 0,
            "malformed source silently disappeared from {target}"
        );
        assert_eq!(fs.read_file("/output").unwrap(), b"unchanged");
    }
}
