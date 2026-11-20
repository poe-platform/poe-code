use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{
    BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions,
    commands::codecs::parse_zip_archive,
};
use std::sync::Arc;

fn shell() -> (Shell, MemoryVfs) {
    let fs = MemoryVfs::new();
    let shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    (shell, fs)
}
fn convert(
    shell: &mut Shell,
    source: &str,
    from: &str,
    target: &str,
) -> safe_bash_rust::ExecOutput {
    shell
        .exec_with_options(
            &format!("pandoc -f {from} -t {target}"),
            ExecOptions {
                stdin: Some(source.into()),
                ..Default::default()
            },
        )
        .unwrap()
}
fn word_document(bytes: &[u8]) -> String {
    String::from_utf8(
        parse_zip_archive(bytes)
            .unwrap()
            .into_iter()
            .find(|part| part.name == "word/document.xml")
            .unwrap()
            .content,
    )
    .unwrap()
}
fn paragraph<'a>(xml: &'a str, marker: &str) -> &'a str {
    xml.split("<w:p>")
        .find(|part| part.split("</w:p>").next().unwrap().contains(marker))
        .unwrap()
        .split("</w:p>")
        .next()
        .unwrap()
}
fn ordered(text: &str, markers: &[&str]) {
    let mut position = 0;
    for marker in markers {
        position += text[position..]
            .find(marker)
            .unwrap_or_else(|| panic!("missing or reordered {marker}: {text}"))
            + marker.len();
    }
}

#[test]
fn details_raw_wrappers_match_public_javascript_source_preservation() {
    let Value::Array(cases) = json::parse(
        include_bytes!("fixtures/pandoc-details.json"),
        Default::default(),
    )
    .unwrap() else {
        panic!("fixtures")
    };
    let string = |value: &Value, field: &str| {
        let Some(Value::String(text)) = value.get(field) else {
            panic!("{field}")
        };
        String::from_utf16(text).unwrap()
    };
    let (mut shell, _) = shell();
    for case in cases {
        let source = string(&case, "source");
        let from = string(&case, "from");
        let output = convert(&mut shell, &source, &from, "json");
        assert_eq!(output.exit_code, 0, "{from}: {source}: {}", output.stderr);
        let actual = json::parse(output.stdout.as_bytes(), Default::default()).unwrap();
        assert_eq!(
            actual.get("blocks"),
            case.get("blocks"),
            "{} ({from})",
            string(&case, "id")
        );
    }
}

#[test]
fn native_details_keep_closed_open_nested_content_and_destinations_in_both_binary_writers() {
    for attribute in ["", " open", " open=\"false\""] {
        let source = format!(
            "[OUTERLINK](#outer) [SUMMARYLINK](#summary)\n\n<details id=\"outer\"{attribute}>\n<summary id=\"summary\">OUTERSUMMARY</summary>\n\nBODY *EMPH*\n\n<details>\n<summary>INNERSUMMARY</summary>\n\nINNERBODY\n\n</details>\n\nAFTER\n\n</details>\n"
        );
        for from in ["gfm", "markdown"] {
            for target in ["docx", "pdf"] {
                let (mut shell, fs) = shell();
                let result = convert(&mut shell, &source, from, &format!("{target} -o /output"));
                assert_eq!(
                    result.exit_code, 0,
                    "{from}/{target}/{attribute}: {}",
                    result.stderr
                );
                let bytes = fs.read_file("/output").unwrap();
                if target == "docx" {
                    let xml = word_document(&bytes);
                    ordered(
                        &xml,
                        &[
                            "OUTERSUMMARY",
                            "BODY",
                            "EMPH",
                            "INNERSUMMARY",
                            "INNERBODY",
                            "AFTER",
                        ],
                    );
                    assert!(paragraph(&xml, "OUTERSUMMARY").contains("<w:b/>"));
                    assert!(paragraph(&xml, "INNERSUMMARY").contains("<w:b/>"));
                    assert!(paragraph(&xml, "EMPH").contains("<w:i/>"));
                    for id in ["outer", "summary"] {
                        assert!(xml.contains(&format!("w:name=\"{id}\"")), "{xml}");
                        assert!(xml.contains(&format!("w:anchor=\"{id}\"")), "{xml}");
                    }
                } else {
                    assert!(bytes.starts_with(b"%PDF-"));
                    let raw = String::from_utf8_lossy(&bytes);
                    assert!(
                        raw.matches("/Dest [").count() >= 2,
                        "PDF lost wrapper/summary destinations"
                    );
                    let reference = source
                        .replace(
                            &format!("<details id=\"outer\"{attribute}>"),
                            "<div id=\"outer\">",
                        )
                        .replace("<details>", "<div>")
                        .replace("</details>", "</div>")
                        .replace(
                            "<summary id=\"summary\">OUTERSUMMARY</summary>",
                            "<p id=\"summary\"><strong>OUTERSUMMARY</strong></p>",
                        )
                        .replace(
                            "<summary>INNERSUMMARY</summary>",
                            "<p><strong>INNERSUMMARY</strong></p>",
                        );
                    let control = convert(&mut shell, &reference, "gfm", "pdf -o /reference");
                    assert_eq!(control.exit_code, 0, "{}", control.stderr);
                    assert_eq!(
                        bytes,
                        fs.read_file("/reference").unwrap(),
                        "details changed the PDF text, style, or destinations"
                    );
                }
            }
        }
    }
}

#[test]
fn native_split_summary_keeps_markdown_formatting_and_body() {
    let source = "<details>\n<summary id=\"summary\">\n\n*SPLITSUMMARY*\n\n</summary>\n\nBODY\n\n</details>\n";
    for from in ["gfm", "markdown"] {
        for target in ["docx", "pdf"] {
            let (mut shell, fs) = shell();
            let result = convert(&mut shell, source, from, &format!("{target} -o /output"));
            assert_eq!(result.exit_code, 0, "{from}/{target}: {}", result.stderr);
            if target == "docx" {
                let xml = word_document(&fs.read_file("/output").unwrap());
                let summary = paragraph(&xml, "SPLITSUMMARY");
                assert!(
                    summary.contains("<w:b/>") && summary.contains("<w:i/>"),
                    "{summary}"
                );
                assert!(xml.contains("w:name=\"summary\""), "{xml}");
                ordered(&xml, &["SPLITSUMMARY", "BODY"]);
            } else {
                let reference = "<div>\n<p id=\"summary\"><strong><em>SPLITSUMMARY</em></strong></p>\n\nBODY\n\n</div>\n";
                let control = convert(&mut shell, reference, "gfm", "pdf -o /reference");
                assert_eq!(control.exit_code, 0, "{}", control.stderr);
                assert_eq!(
                    fs.read_file("/output").unwrap(),
                    fs.read_file("/reference").unwrap(),
                    "split summary changed PDF text or formatting"
                );
            }
        }
    }
}

#[test]
fn invalid_details_scopes_fail_before_overwriting_output() {
    for (source, message) in [
        (
            "<details>\n<summary>MORE</summary>\n\nBODY\n",
            "Unclosed raw HTML block tag: details",
        ),
        (
            "<details>\n<summary>MORE</summary>\n\nBODY\n\n</section>\n",
            "Mismatched raw HTML closing tag",
        ),
        ("<details/>\n\nBODY\n", "requires an explicit closing tag"),
    ] {
        for from in ["gfm", "markdown"] {
            for target in ["docx", "pdf"] {
                let (mut shell, fs) = shell();
                fs.write_file("/output", b"unchanged").unwrap();
                let output = convert(&mut shell, source, from, &format!("{target} -o /output"));
                assert_ne!(
                    output.exit_code, 0,
                    "{from}/{target}: malformed details accepted"
                );
                assert!(output.stderr.contains(message), "{}", output.stderr);
                assert_eq!(fs.read_file("/output").unwrap(), b"unchanged");
            }
        }
    }
}
