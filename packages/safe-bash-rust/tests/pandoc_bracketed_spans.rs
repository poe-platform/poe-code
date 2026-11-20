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
fn bracketed_spans_match_javascript_attributes_scopes_and_profiles() {
    let Value::Array(cases) = json::parse(
        include_bytes!("fixtures/pandoc-bracketed-spans.json"),
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
fn deep_bracketed_spans_and_malformed_attributes_preserve_output() {
    const CHILD: &str = "SAFE_BASH_BRACKETED_SPAN_DEPTH_CHILD";
    if std::env::var_os(CHILD).is_some() {
        let fs = MemoryVfs::new();
        fs.write_file("/output", b"unchanged").unwrap();
        let mut shell = Shell::new(
            Arc::new(fs.clone()),
            ShellOptions {
                cwd: Some("/".into()),
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        let control = format!("{}CONTROL{}", "[".repeat(63), "]{.c}".repeat(63));
        for from in ["markdown", "gfm+bracketed_spans"] {
            let output = shell
                .exec_with_options(
                    &format!("pandoc -f {from} -t json"),
                    ExecOptions {
                        stdin: Some(control.clone()),
                        ..Default::default()
                    },
                )
                .unwrap();
            assert_eq!(output.exit_code, 0, "{from}: {}", output.stderr);
            assert!(output.stdout.contains("CONTROL"));
        }
        for source in [
            format!("{}x{}", "[**".repeat(50_000), "**]{.c}".repeat(50_000)),
            "[x]{title='".repeat(50_000),
            format!("[x]{{{}}}", ".smallcaps ".repeat(1_000)),
        ] {
            for from in ["markdown", "gfm+bracketed_spans"] {
                let output = shell
                    .exec_with_options(
                        &format!("pandoc -f {from} -t json -o /output"),
                        ExecOptions {
                            stdin: Some(source.clone()),
                            ..Default::default()
                        },
                    )
                    .unwrap();
                assert_ne!(output.exit_code, 0, "{from}");
                assert!(output.stderr.contains("nesting limit"), "{}", output.stderr);
                assert_eq!(fs.read_file("/output").unwrap(), b"unchanged");
            }
        }
        for from in ["markdown-bracketed_spans", "gfm+link_attributes"] {
            let output = shell
                .exec_with_options(
                    &format!("pandoc -f {from} -t json -o /output"),
                    ExecOptions {
                        stdin: Some("[x](url){title='".repeat(50_000)),
                        ..Default::default()
                    },
                )
                .unwrap();
            assert_ne!(output.exit_code, 0, "{from}");
            assert_eq!(fs.read_file("/output").unwrap(), b"unchanged");
        }
        return;
    }
    // An overflowing destructor aborts the process rather than unwinding. Keep
    // this regression isolated, with a deadline that also catches slow rejection.
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "deep_bracketed_spans_and_malformed_attributes_preserve_output",
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
        "deep span subprocess failed ({}, timeout={timed_out}): {}{}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn bracketed_span_style_and_anchor_reach_binary_writers() {
    let fs = MemoryVfs::new();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    for to in ["docx", "pdf"] {
        let output = shell
            .exec_with_options(
                &format!("pandoc -f markdown -t {to} -o /output"),
                ExecOptions {
                    stdin: Some(
                        "[Red]{#anchor style=\"color:#ff0000;font-weight:bold\"} [Jump](#anchor)"
                            .into(),
                    ),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(output.exit_code, 0, "{}", output.stderr);
        let bytes = fs.read_file("/output").unwrap();
        if to == "docx" {
            let entry = safe_bash_rust::commands::codecs::parse_zip_archive(&bytes)
                .unwrap()
                .into_iter()
                .find(|entry| entry.name == "word/document.xml")
                .unwrap();
            let xml = String::from_utf8(entry.content).unwrap();
            assert!(
                xml.contains("w:bookmarkStart") && xml.contains("w:anchor="),
                "{xml}"
            );
            assert!(
                xml.contains("w:val=\"FF0000\"") && xml.contains("<w:b/>"),
                "{xml}"
            );
        } else {
            assert!(bytes.starts_with(b"%PDF-"));
            let pdf = String::from_utf8_lossy(&bytes);
            assert!(pdf.contains("/Subtype /Link") && pdf.contains("/Dest ["));
        }
    }
}

#[test]
fn smallcaps_unsupported_writers_preserve_existing_output() {
    let fs = MemoryVfs::new();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    for to in ["docx", "pdf", "markdown", "gfm", "rst"] {
        fs.write_file("/saved", b"KEEP").unwrap();
        let output = shell
            .exec_with_options(
                &format!("pandoc -f markdown -t {to} -o /saved"),
                ExecOptions {
                    stdin: Some("[*x*]{.smallcaps}".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_ne!(output.exit_code, 0, "{to}");
        assert!(
            output.stderr.contains("SmallCaps"),
            "{to}: {}",
            output.stderr
        );
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
}
