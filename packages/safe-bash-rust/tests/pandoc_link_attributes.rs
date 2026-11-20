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
fn link_attributes_match_javascript_across_profiles() {
    let Value::Array(cases) = json::parse(
        include_bytes!("fixtures/pandoc-link-attributes.json"),
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
fn link_and_image_attributes_reach_docx_and_pdf_anchors() {
    let fs = MemoryVfs::new();
    fs.write_file(
        "/pixel.bmp",
        include_bytes!("fixtures/html-images/pixel.bmp"),
    )
    .unwrap();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let source = "[Target](https://example.com){#link} [Jump](#link)\n\nImage: ![pixel](/pixel.bmp){#image width=24px height=12px} [Image jump](#image)";
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
                "w:name=\"link\"",
                "w:name=\"image\"",
                "w:anchor=\"link\"",
                "w:anchor=\"image\"",
                "cx=\"228600\" cy=\"114300\"",
            ] {
                assert!(xml.contains(token), "missing {token}: {xml}");
            }
        } else {
            assert!(bytes.starts_with(b"%PDF-"));
            let pdf = String::from_utf8_lossy(&bytes);
            assert!(pdf.contains("/Subtype /Image"));
            assert_eq!(pdf.matches("/Dest [").count(), 2, "{pdf}");
        }
    }
}

#[test]
fn invalid_image_dimensions_preserve_existing_outputs() {
    let fs = MemoryVfs::new();
    fs.write_file(
        "/pixel.bmp",
        include_bytes!("fixtures/html-images/pixel.bmp"),
    )
    .unwrap();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    for to in ["docx", "pdf"] {
        fs.write_file("/saved", b"KEEP").unwrap();
        let output = shell
            .exec_with_options(
                &format!("pandoc -f markdown -t {to} -o /saved"),
                ExecOptions {
                    stdin: Some("Image: ![pixel](/pixel.bmp){width=invalid}".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_ne!(output.exit_code, 0, "{to}");
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
}
