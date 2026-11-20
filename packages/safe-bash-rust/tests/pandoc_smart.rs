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
fn smart_punctuation_matches_javascript_across_inline_scopes() {
    matches_javascript(include_bytes!("fixtures/pandoc-smart.json"));
}

#[test]
fn crossing_quotes_preserve_formatting_and_balanced_quote_controls() {
    matches_javascript(include_bytes!("fixtures/pandoc-smart-crossings.json"));
}

fn matches_javascript(fixtures: &[u8]) {
    let Value::Array(cases) = json::parse(fixtures, Default::default()).unwrap() else {
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
        if actual.get("blocks") != case.get("blocks") {
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
fn smart_quotes_and_typography_reach_docx_and_pdf() {
    let fs = MemoryVfs::new();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let source = "# \"Heading\"\n\n\"**BOLD** and 'inner'\" -- ...\n\n\"*ITALIC\"* \"**STRONG\"** \"~~STRIKE\"~~";
    for to in ["docx", "pdf"] {
        let output = shell
            .exec_with_options(
                &format!("pandoc -f markdown -t {to} -o /output"),
                ExecOptions {
                    stdin: Some(source.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(output.exit_code, 0, "{to}: {}", output.stderr);
        let bytes = fs.read_file("/output").unwrap();
        if to == "docx" {
            let parts = safe_bash_rust::commands::codecs::parse_zip_archive(&bytes).unwrap();
            let xml = String::from_utf8(
                parts
                    .into_iter()
                    .find(|part| part.name == "word/document.xml")
                    .unwrap()
                    .content,
            )
            .unwrap();
            for token in [
                "“",
                "”",
                "‘",
                "’",
                "–",
                "…",
                "BOLD",
                "<w:b/>",
                "<w:i/>",
                "<w:strike/>",
                "w:name=\"heading\"",
            ] {
                assert!(xml.contains(token), "missing {token}: {xml}");
            }
        } else {
            let output = shell.exec("pdftotext /output -").unwrap();
            assert_eq!(output.exit_code, 0, "{}", output.stderr);
            assert!(output.stdout.contains("“Heading”"), "{}", output.stdout);
            assert!(
                output.stdout.contains("“BOLD and ‘inner’” – …"),
                "{}",
                output.stdout
            );
            assert!(
                output.stdout.contains("“ITALIC” “STRONG” “STRIKE”"),
                "{}",
                output.stdout
            );
        }
    }
}

#[test]
fn smart_extension_is_rejected_for_commonmark_without_overwriting_output() {
    let fs = MemoryVfs::new();
    fs.write_file("/saved", b"KEEP").unwrap();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    for from in ["commonmark+smart", "commonmark-smart"] {
        let output = shell
            .exec_with_options(
                &format!("pandoc -f {from} -t json -o /saved"),
                ExecOptions {
                    stdin: Some("\"quoted\"".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_ne!(output.exit_code, 0);
        assert!(output.stderr.contains("Unsupported extension: smart"));
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
}

#[test]
fn deep_quotes_are_bounded_and_preserve_existing_output() {
    const CHILD: &str = "SAFE_BASH_SMART_QUOTE_DEPTH_CHILD";
    if std::env::var_os(CHILD).is_some() {
        let fs = MemoryVfs::new();
        let mut shell = Shell::new(
            Arc::new(fs.clone()),
            ShellOptions {
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        for count in [63, 50_000] {
            fs.write_file("/saved", b"KEEP").unwrap();
            let source = format!("{}CONTROL{}", "\"a ".repeat(count), " b\"".repeat(count));
            let output = shell
                .exec_with_options(
                    "pandoc -f markdown -t json -o /saved",
                    ExecOptions {
                        stdin: Some(source),
                        ..Default::default()
                    },
                )
                .unwrap();
            if count == 63 {
                assert_eq!(output.exit_code, 0, "{}", output.stderr);
            } else {
                assert_ne!(output.exit_code, 0);
                assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
            }
        }
        let output = shell
            .exec_with_options(
                "pandoc -f markdown -t json",
                ExecOptions {
                    stdin: Some("a\" ".repeat(50_000)),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(output.exit_code, 0, "{}", output.stderr);
        return;
    }
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "deep_quotes_are_bounded_and_preserve_existing_output",
            "--nocapture",
        ])
        .env(CHILD, "1")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let start = std::time::Instant::now();
    let mut timed_out = false;
    while child.try_wait().unwrap().is_none() {
        if start.elapsed() > std::time::Duration::from_secs(10) {
            timed_out = true;
            child.kill().unwrap();
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    let output = child.wait_with_output().unwrap();
    assert!(
        !timed_out && output.status.success(),
        "quote subprocess failed (timeout={timed_out}): {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
