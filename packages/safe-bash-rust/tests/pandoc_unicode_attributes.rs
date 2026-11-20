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
fn unicode_attribute_tokens_and_heading_boundaries_match_javascript() {
    let Value::Array(cases) = json::parse(
        include_bytes!("fixtures/pandoc-unicode-attributes.json"),
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
fn encoded_unicode_attribute_targets_reach_docx_and_pdf() {
    let fs = MemoryVfs::new();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    // The NBSP belongs to the ID; treating it as a separator breaks the link.
    let source = "[Jump](#a%C2%A0.b)\n\n[Target]{#a\u{00a0}.b}";
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
            assert!(xml.contains("w:name=\"a\u{00a0}.b\""), "{xml}");
            assert!(xml.contains("w:anchor=\"a\u{00a0}.b\""), "{xml}");
        } else {
            assert!(bytes.starts_with(b"%PDF-"));
            let pdf = String::from_utf8_lossy(&bytes);
            assert_eq!(pdf.matches("/Dest [").count(), 1, "{pdf}");
            assert!(
                !pdf.contains("/URI"),
                "internal target became an external link"
            );
        }
    }
}
