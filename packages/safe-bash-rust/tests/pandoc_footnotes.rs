use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{
    BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions,
    commands::codecs::parse_zip_archive,
};
use std::sync::Arc;

fn run(source: &str, from: &str, to: &str) -> (safe_bash_rust::ExecOutput, MemoryVfs) {
    let fs = MemoryVfs::new();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let output = shell
        .exec_with_options(
            &format!("pandoc -f {from} -t {to}"),
            ExecOptions {
                stdin: Some(source.into()),
                ..Default::default()
            },
        )
        .unwrap();
    (output, fs)
}
fn ast(source: &str, from: &str) -> Value {
    let (result, _) = run(source, from, "json");
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    json::parse(result.stdout.as_bytes(), Default::default()).unwrap()
}
fn count(value: &Value, tag: &str) -> usize {
    let own = usize::from(value.get("t") == Some(&Value::String(tag.encode_utf16().collect())));
    own + match value {
        Value::Array(values) => values.iter().map(|v| count(v, tag)).sum(),
        Value::Object(values) => values.iter().map(|(_, v)| count(v, tag)).sum(),
        _ => 0,
    }
}
fn part(bytes: &[u8], name: &str) -> String {
    String::from_utf8(
        parse_zip_archive(bytes)
            .unwrap()
            .into_iter()
            .find(|p| p.name == name)
            .unwrap()
            .content,
    )
    .unwrap()
}
const BASIC: &str = "Text[^n].\n\n[^n]: Body *text*.\n\n    Second paragraph.\n";

#[test]
fn native_markdown_footnote_body_is_structured_and_removed_from_document() {
    let actual = ast(BASIC, "markdown");
    let expected = json::parse(br#"[{"t":"Para","c":[{"t":"Str","c":"Text"},{"t":"Note","c":[{"t":"Para","c":[{"t":"Str","c":"Body"},{"t":"Space"},{"t":"Emph","c":[{"t":"Str","c":"text"}]},{"t":"Str","c":"."}]},{"t":"Para","c":[{"t":"Str","c":"Second"},{"t":"Space"},{"t":"Str","c":"paragraph."}]}]},{"t":"Str","c":"."}]}]"#, Default::default()).unwrap();
    assert_eq!(actual.get("blocks"), Some(&expected));
}

#[test]
fn native_footnote_extensions_match_javascript_dialects() {
    for from in [
        "markdown",
        "md",
        "gfm+footnotes",
        "markdown-footnotes+footnotes",
        "markdown+footnotes-footnotes",
    ] {
        assert_eq!(count(&ast(BASIC, from), "Note"), 1, "{from}");
    }
    for from in ["gfm", "commonmark", "commonmark_x", "markdown-footnotes"] {
        assert_eq!(count(&ast(BASIC, from), "Note"), 0, "{from}");
    }
    for from in [
        "commonmark+footnotes",
        "commonmark-footnotes",
        "commonmark+footnotes-footnotes",
    ] {
        let (result, _) = run(BASIC, from, "json");
        assert_ne!(result.exit_code, 0);
        assert!(result.stderr.contains("Unsupported extension"));
    }
}

#[test]
fn disabled_footnotes_leave_caret_labels_available_for_reference_links() {
    let expected = json::parse(br#"[{"t":"Para","c":[{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"^x"}],["target",""]]}]}]"#, Default::default()).unwrap();
    for from in ["commonmark", "gfm", "commonmark_x", "markdown-footnotes"] {
        let actual = ast("[^x]\n\n[^x]: target\n", from);
        assert_eq!(actual.get("blocks"), Some(&expected), "{from}");
        let (result, _) = run(
            "[^x] [LABEL][^x] [^X]\n\n> [^x]: target \"Title\"\n",
            from,
            "json",
        );
        assert_eq!(result.exit_code, 0, "{from}: {}", result.stderr);
        let actual = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
        assert_eq!(count(&actual, "Link"), 3, "{from}");
        assert!(result.stdout.contains("\"c\":\"^X\""));
        assert_eq!(result.stdout.matches("[\"target\",\"Title\"]").count(), 3);
        assert!(result.stdout.contains("\"t\":\"BlockQuote\",\"c\":[]"));
    }
    for from in ["markdown", "gfm+footnotes"] {
        assert_eq!(
            count(&ast("[^x]\n\n[^x]: target\n", from), "Note"),
            1,
            "{from}"
        );
    }
}

#[test]
fn native_footnote_references_are_repeated_nested_and_cycle_safe() {
    let source = "[^a]: Outer[^b].\n\n[^b]: Inner[^a].\n\nRef[^a] again[^a].\n";
    let actual = ast(source, "markdown");
    assert_eq!(count(&actual, "Note"), 4);
    let (result, _) = run(source, "markdown", "json");
    assert!(result.stdout.contains("Inner[^a]."));
    let (result, _) = run("Text[^n].\n\n[^n]: Self[^n].", "markdown", "json");
    assert_eq!(
        count(
            &json::parse(result.stdout.as_bytes(), Default::default()).unwrap(),
            "Note"
        ),
        1
    );
    assert!(result.stdout.contains("Self[^n]."));
}

#[test]
fn native_footnote_labels_are_case_sensitive_and_first_definition_wins() {
    let (result, _) = run(
        "Ref[^n] [^N].\n\n[^n]: FIRST.\n\n[^n]: SECOND.\n",
        "markdown",
        "json",
    );
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let actual = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
    assert_eq!(count(&actual, "Note"), 1);
    assert!(result.stdout.contains("FIRST."));
    assert!(!result.stdout.contains("SECOND."));
    assert!(result.stdout.contains("[^N]."));
}

#[test]
fn native_footnotes_preserve_code_escapes_and_container_definitions() {
    let source = "Text `[^n]` \\[^n] [^missing] real[^n] quote[^q] list[^l].\n\n```\n[^n]: WRONG\n```\n\n> [^q]: QUOTED\n\n- [^l]: LISTED\n\n[^n]: CORRECT\n\n    ```\n    [^x]: LITERAL\n    ```\n";
    let actual = ast(source, "markdown");
    assert_eq!(count(&actual, "Note"), 3);
    assert_eq!(count(&actual, "CodeBlock"), 2);
    assert_eq!(count(&actual, "Code"), 1);
    let (result, _) = run(source, "markdown", "json");
    for marker in [
        "WRONG",
        "LITERAL",
        "QUOTED",
        "LISTED",
        "CORRECT",
        "[^missing]",
    ] {
        assert!(result.stdout.contains(marker), "{marker}");
    }
}

#[test]
fn native_footnotes_resolve_in_lists_tables_quotes_and_links() {
    let source = "- list[^n]\n\n> quote[^n]\n\n| Header |\n| --- |\n| cell[^n] |\n\n[link[^n]](https://example.com)\n\n[^n]: body\n\n    - CHILD\n    - **BOLD**\n";
    let actual = ast(source, "markdown");
    assert_eq!(count(&actual, "Note"), 4);
    assert_eq!(count(&actual, "Strong"), 4);
    assert_eq!(count(&actual, "BulletList"), 5);
}

#[test]
fn native_footnotes_reach_real_docx_and_pdf() {
    let source = "Text[^n] again[^n].\n\n[^n]: **NOTEBODY Ω** [LINK](https://example.com/note).\n";
    for to in ["docx", "pdf"] {
        let (result, fs) = run(source, "markdown", &format!("{to} -o /output"));
        assert_eq!(result.exit_code, 0, "{to}: {}", result.stderr);
        let bytes = fs.read_file("/output").unwrap();
        if to == "docx" {
            let body = part(&bytes, "word/document.xml");
            assert_eq!(body.matches("<w:footnoteReference").count(), 2);
            let notes = part(&bytes, "word/footnotes.xml");
            assert_eq!(notes.matches("NOTEBODY Ω").count(), 2);
            assert!(notes.contains("<w:b"));
            assert!(
                part(&bytes, "word/_rels/footnotes.xml.rels").contains("https://example.com/note")
            );
        } else {
            let pdf = String::from_utf8_lossy(&bytes);
            assert!(pdf.contains("> <03A9>"));
            assert!(pdf.contains("https://example.com/note"));
        }
    }
}

#[test]
fn native_nested_footnotes_reject_invalid_docx_without_publishing() {
    let (result, fs) = run(
        "Text[^a].\n\n[^a]: Outer[^b].\n\n[^b]: Inner.\n",
        "markdown",
        "docx -o /output",
    );
    assert_ne!(result.exit_code, 0);
    assert!(
        result.stderr.contains("Nested footnotes"),
        "{}",
        result.stderr
    );
    assert!(fs.read_file("/output").is_err());
}

#[test]
fn native_text_writers_do_not_silently_drop_notes() {
    for to in [
        "html",
        "plain",
        "markdown",
        "gfm",
        "commonmark",
        "rst",
        "latex",
        "rtf",
        "odt",
        "epub",
    ] {
        let (result, _) = run(BASIC, "markdown", to);
        assert_ne!(
            result.exit_code, 0,
            "{to} silently accepted unsupported notes"
        );
        assert!(
            result.stderr.contains("E_CAPABILITY"),
            "{to}: {}",
            result.stderr
        );
    }
}

#[test]
fn native_heading_ids_survive_json_and_canonical_binary_output() {
    let source = "# Heading[^n]\n\n[JUMP](#heading).\n\n[^n]: body\n";
    let actual = ast(source, "markdown");
    let Value::Array(blocks) = actual.get("blocks").unwrap() else {
        panic!()
    };
    let Value::Array(header) = blocks[0].get("c").unwrap() else {
        panic!()
    };
    let Value::Array(attributes) = &header[1] else {
        panic!()
    };
    assert_eq!(
        attributes[0],
        Value::String("heading".encode_utf16().collect())
    );
    for to in ["docx", "pdf"] {
        let (result, fs) = run(source, "markdown", &format!("{to} -o /output"));
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let bytes = fs.read_file("/output").unwrap();
        if to == "docx" {
            let body = part(&bytes, "word/document.xml");
            assert!(body.contains("w:name=\"heading\""));
            assert!(body.contains("w:anchor=\"heading\""));
        } else {
            assert!(String::from_utf8_lossy(&bytes).contains("/Dest ["));
        }
    }
}

#[test]
fn canonical_markdown_writer_preserves_lists_tasks_code_tables_and_raw_styles() {
    let source = "# Heading\n\n[JUMP](#heading)\n\n5. FIFTH\n6. SIXTH\n\n- [x] DONE\n- [ ] TODO\n\n```rust\nCODE\n  INDENT\n```\n\n| HEAD | RIGHT |\n| --- | ---: |\n| LEFT | CELL |\n\n<span style=\"color:#ff0000\">RED</span>\n";
    for to in ["docx", "pdf"] {
        let (result, fs) = run(
            source,
            "markdown",
            &format!("{to} --shift-heading-level-by=1 --number-sections -o /output"),
        );
        assert_eq!(result.exit_code, 0, "{to}: {}", result.stderr);
        let bytes = fs.read_file("/output").unwrap();
        if to == "docx" {
            let body = part(&bytes, "word/document.xml");
            for marker in [
                "w:anchor=\"heading\"",
                "w:val=\"Heading2\"",
                "1 Heading",
                "FIFTH",
                "SIXTH",
                "DONE",
                "TODO",
                "  INDENT",
                "<w:tblHeader",
                "w:val=\"right\"",
                "w:val=\"FF0000\"",
            ] {
                assert!(body.contains(marker), "missing {marker}: {body}");
            }
            let numbering = part(&bytes, "word/numbering.xml");
            assert!(numbering.contains("<w:start w:val=\"5\""));
            assert!(!body.contains(['☒', '☑', '☐']));
            for (label, marker) in [("DONE", '☑'), ("TODO", '☐')] {
                let paragraph = body.split("<w:p>").find(|p| p.contains(label)).unwrap();
                let paragraph = paragraph.split("</w:p>").next().unwrap();
                assert_eq!(paragraph.matches("<w:numPr>").count(), 1);
                let id = paragraph
                    .split("<w:numId w:val=\"")
                    .nth(1)
                    .unwrap()
                    .split('"')
                    .next()
                    .unwrap();
                let definition = numbering
                    .split(&format!("<w:abstractNum w:abstractNumId=\"{id}\">"))
                    .nth(1)
                    .unwrap()
                    .split("</w:abstractNum>")
                    .next()
                    .unwrap();
                assert!(definition.contains(&format!("<w:lvlText w:val=\"{marker}\"/>")));
            }
        } else {
            let pdf = String::from_utf8_lossy(&bytes);
            assert!(pdf.contains("/Dest ["));
            let mut rest = bytes.as_slice();
            let mut red = false;
            let mut boxes = 0;
            let mut checks = 0;
            while let Some(start) = rest.windows(7).position(|s| s == b"stream\n") {
                rest = &rest[start + 7..];
                let end = rest.windows(10).position(|s| s == b"\nendstream").unwrap();
                let stream = &rest[..end];
                let inflated = stream
                    .strip_prefix(&[0x78])
                    .and_then(|s| safe_bash_rust::commands::codecs::inflate_raw(&s[1..]).ok())
                    .map(|(bytes, _)| bytes);
                let content = String::from_utf8_lossy(inflated.as_deref().unwrap_or(stream));
                red |= content.contains("1 0 0 rg");
                boxes += content.matches(" re B\n").count();
                checks += content.matches(" w 1 J 1 j ").count();
                rest = &rest[end + 10..];
            }
            assert!(red, "PDF text lost the raw HTML color");
            assert_eq!(boxes, 2, "each task needs one vector checkbox");
            assert_eq!(checks, 1, "only the completed task is checked");
        }
    }
}

#[test]
fn canonical_markdown_embeds_typed_and_raw_images_in_notes_and_body() {
    let png = terminal_png_rust::png::encode(2, 1, &[255, 0, 0, 255, 0, 255, 0, 255]).unwrap();
    let fs = MemoryVfs::new();
    fs.write_file("/pixel.png", &png).unwrap();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let source = "![BODY](pixel.png)\n\n<img src=\"pixel.png\" alt=\"RAW\">\n\nRef[^n].\n\n[^n]: ![NOTE](pixel.png)\n\n    <img src=\"pixel.png\" alt=\"RAWNOTE\">\n";
    for to in ["docx", "pdf"] {
        let result = shell
            .exec_with_options(
                &format!("pandoc -f markdown -t {to} -o /output"),
                ExecOptions {
                    stdin: Some(source.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{to}: {}", result.stderr);
        let bytes = fs.read_file("/output").unwrap();
        if to == "docx" {
            assert_eq!(
                part(&bytes, "word/document.xml")
                    .matches("<w:drawing")
                    .count(),
                2
            );
            assert_eq!(
                part(&bytes, "word/footnotes.xml")
                    .matches("<w:drawing")
                    .count(),
                2
            );
            assert!(
                parse_zip_archive(&bytes)
                    .unwrap()
                    .iter()
                    .any(|part| part.content == png)
            );
        } else {
            assert!(String::from_utf8_lossy(&bytes).contains("/Subtype /Image"));
        }
    }
}

#[test]
fn note_expansion_is_bounded_and_generated_json_is_not_recharged_as_input() {
    let fs = MemoryVfs::new();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    shell.set_limits(safe_bash_rust::ShellLimits {
        max_input_bytes: BASIC.len(),
        ..Default::default()
    });
    let result = shell
        .exec_with_options(
            "pandoc -f markdown -t docx -o /output",
            ExecOptions {
                stdin: Some(BASIC.into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert!(fs.read_file("/output").is_ok());

    let mut source = "Ref[^0].\n\n".to_owned();
    for index in 0..16 {
        source.push_str(&format!(
            "[^{}]: [^{}] [^{}]\n\n",
            index,
            index + 1,
            index + 1
        ));
    }
    source.push_str("[^16]: LEAF\n");
    shell.set_limits(safe_bash_rust::ShellLimits {
        max_parse_units: 1000,
        ..Default::default()
    });
    let result = shell
        .exec_with_options(
            "pandoc -f markdown -t json -o /bounded",
            ExecOptions {
                stdin: Some(source),
                ..Default::default()
            },
        )
        .unwrap();
    assert_ne!(result.exit_code, 0);
    assert!(fs.read_file("/bounded").is_err());
}

#[test]
fn descriptive_image_notes_do_not_read_resources_or_emit_footnotes() {
    let fs = MemoryVfs::new();
    let png = terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap();
    fs.write_file("/pixel.png", &png).unwrap();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let source = "Inline ![alt[^n]](pixel.png).\n\n[^n]: ![HIDDEN](missing.png)\n";
    for to in ["docx", "pdf"] {
        let result = shell
            .exec_with_options(
                &format!("pandoc -f markdown -t {to} -o /output"),
                ExecOptions {
                    stdin: Some(source.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{to}: {}", result.stderr);
        let bytes = fs.read_file("/output").unwrap();
        if to == "docx" {
            assert!(!part(&bytes, "word/document.xml").contains("footnoteReference"));
        }
    }
}
