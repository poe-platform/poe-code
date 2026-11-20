use safe_bash_rust::{
    BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellLimits, ShellOptions,
    commands::codecs::parse_zip_archive,
};
use std::sync::Arc;

fn shell() -> (Shell, MemoryVfs) {
    let fs = MemoryVfs::new();
    let sh = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    (sh, fs)
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
fn exec(sh: &mut Shell, source: &str, format: &str, flags: &str) -> safe_bash_rust::ExecOutput {
    sh.exec_with_options(
        &format!("pandoc -f json -t {format} {flags}"),
        ExecOptions {
            stdin: Some(source.into()),
            ..Default::default()
        },
    )
    .unwrap()
}
const RICH: &str = r##"{"pandoc-api-version":[1,23,1,2],"meta":{"title":{"t":"MetaString","c":"Canonical title"}},"blocks":[
{"t":"Null"},
{"t":"Header","c":[1,["heading",[],[]],[{"t":"Str","c":"HEADING"}]]},
{"t":"Div","c":[["wrapper",[],[]],[{"t":"Para","c":[{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"JUMP"}],["#heading",""]]},{"t":"Note","c":[{"t":"Para","c":[{"t":"Strong","c":[{"t":"Str","c":"NOTEBODY Ω"}]}]}]}]}]]},
{"t":"Table","c":[["table",[],[]],[null,[]],[[{"t":"AlignLeft"},{"t":"ColWidthDefault"}],[{"t":"AlignRight"},{"t":"ColWidthDefault"}]],[["",[],[]],[[["",[],[]],[[["headcell",[],[]],{"t":"AlignDefault"},1,1,[{"t":"Plain","c":[{"t":"Str","c":"HEAD"}]}]],[["",[],[]],{"t":"AlignDefault"},1,1,[{"t":"Plain","c":[{"t":"Str","c":"SECOND"}]}]]]]]],[[["",[],[]],1,[],[[["",[],[]],[[["",[],[]],{"t":"AlignDefault"},1,1,[{"t":"Plain","c":[{"t":"Str","c":"ROWNAME"}]}]],[["",[],[]],{"t":"AlignDefault"},1,1,[{"t":"Plain","c":[{"t":"Str","c":"VALUE"}]}]]]]]]],[["",[],[]],[]]]}
]}"##;

#[test]
fn native_binary_json_preserves_notes_tables_containers_and_destinations() {
    let (mut sh, fs) = shell();
    for format in ["docx", "pdf"] {
        let result = exec(&mut sh, RICH, format, "-o /output");
        assert_eq!(result.exit_code, 0, "{format}: {}", result.stderr);
        let bytes = fs.read_file("/output").unwrap();
        if format == "docx" {
            let body = part(&bytes, "word/document.xml");
            for marker in [
                "<w:footnoteReference",
                "<w:tbl>",
                "<w:tblHeader",
                "w:name=\"wrapper\"",
                "w:name=\"table\"",
                "w:name=\"headcell\"",
                "w:anchor=\"heading\"",
                "ROWNAME",
                "VALUE",
            ] {
                assert!(body.contains(marker), "missing {marker}");
            }
            assert!(part(&bytes, "word/footnotes.xml").contains("NOTEBODY Ω"));
            assert!(part(&bytes, "docProps/core.xml").contains("Canonical title"));
        } else {
            let pdf = String::from_utf8_lossy(&bytes);
            assert!(pdf.contains("/Subtype /Link"));
            assert!(pdf.contains("/Dest ["));
            assert!(pdf.contains("> <03A9>"), "footnote glyph missing");
        }
    }
}
#[test]
fn multiple_json_operands_merge_content_and_later_metadata_with_cli_precedence() {
    let (mut sh, fs) = shell();
    fs.write_file("/a.json", br#"{"meta":{"title":{"t":"MetaString","c":"FIRST TITLE"},"author":{"t":"MetaString","c":"FIRST AUTHOR"}},"blocks":[{"t":"Para","c":[{"t":"Str","c":"FIRST BODY"}]}]}"#).unwrap();
    fs.write_file("/b.json", br#"{"meta":{"title":{"t":"MetaString","c":"SECOND TITLE"}},"blocks":[{"t":"Para","c":[{"t":"Str","c":"SECOND BODY"}]}]}"#).unwrap();
    for scope in ["", "--file-scope"] {
        for (extra, title) in [("", "SECOND TITLE"), ("-M title=OVERRIDE", "OVERRIDE")] {
            let result = sh
                .exec(&format!(
                    "pandoc -f json -t docx /a.json /b.json {scope} {extra} -o /output"
                ))
                .unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            let bytes = fs.read_file("/output").unwrap();
            let body = part(&bytes, "word/document.xml");
            assert!(body.find("FIRST BODY").unwrap() < body.find("SECOND BODY").unwrap());
            assert!(part(&bytes, "docProps/core.xml").contains(title));
        }
    }
}
#[test]
fn canonical_resources_include_notes_and_raw_html_but_do_not_resolve_alt_text() {
    let (mut sh, fs) = shell();
    let image = terminal_png_rust::png::encode(2, 1, &[255, 0, 0, 255, 0, 255, 0, 255]).unwrap();
    fs.write_file("/pixel.png?a=1&b=2", &image).unwrap();
    let source = r#"{"blocks":[{"t":"Para","c":[{"t":"Image","c":[["",[],[]],[{"t":"Image","c":[["",[],[]],[{"t":"Str","c":"DESCRIPTIVE"}],["missing-alt.png",""]]}],["pixel.png?a=1&b=2",""]]},{"t":"Note","c":[{"t":"Para","c":[{"t":"RawInline","c":["html","<img src='pixel.png?a=1&amp;b=2' width='24' height='12' alt='NOTEIMAGE'>"]}]}]}]},{"t":"RawBlock","c":["html","<p><img src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAADUlEQVR4AQECAP3/AIAAggCBw24l4AAAAABJRU5ErkJggg==' alt='DATAIMAGE'></p>"]}]}"#;
    for format in ["docx", "pdf"] {
        let result = exec(&mut sh, source, format, "-o /output");
        assert_eq!(result.exit_code, 0, "{format}: {}", result.stderr);
        let bytes = fs.read_file("/output").unwrap();
        if format == "docx" {
            assert_eq!(
                part(&bytes, "word/document.xml")
                    .matches("<w:drawing ")
                    .count(),
                2
            );
            assert!(part(&bytes, "word/footnotes.xml").contains("NOTEIMAGE"));
        } else {
            assert!(String::from_utf8_lossy(&bytes).contains("/Subtype /Image"));
        }
    }
}
#[test]
fn direct_canonical_mapping_keeps_heading_shift_numbering_and_raw_policies() {
    let (mut sh, fs) = shell();
    let source = r#"{"blocks":[{"t":"Header","c":[1,["custom-id",[],[]],[{"t":"Str","c":"TITLE"}]]},{"t":"RawBlock","c":["html","<p><!--HIDDEN--><b>RAW</b></p>"]}]}"#;
    let result = exec(
        &mut sh,
        source,
        "docx",
        "--shift-heading-level-by=1 --number-sections --strip-comments -o /output",
    );
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let body = part(&fs.read_file("/output").unwrap(), "word/document.xml");
    assert!(body.contains("w:pStyle w:val=\"Heading2\""));
    assert!(body.contains("w:name=\"custom-id\""));
    assert!(body.contains(">1 "));
    assert!(!body.contains("HIDDEN"));
    let escaped = exec(&mut sh, source, "docx", "--raw-content=escape -o /output");
    assert_eq!(escaped.exit_code, 0, "{}", escaped.stderr);
    assert!(
        part(&fs.read_file("/output").unwrap(), "word/document.xml")
            .contains("&lt;p&gt;&lt;!--HIDDEN--&gt;&lt;b&gt;RAW&lt;/b&gt;&lt;/p&gt;")
    );
}
#[test]
fn native_pdf_defaults_match_pandoc_profile() {
    let (mut sh, fs) = shell();
    let source = r#"{"blocks":[{"t":"Para","c":[{"t":"Str","c":"One"}]},{"t":"Para","c":[{"t":"Str","c":"Two"}]}]}"#;
    let result = exec(&mut sh, source, "pdf", "-o /output");
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let document = safe_bash_rust::document::from_html("<p>One</p><p>Two</p>").unwrap();
    let defaults = safe_bash_rust::document::pdf::PdfOptions::default();
    assert_eq!(defaults.line_height, 1.65);
    let options = safe_bash_rust::document::pdf::PdfOptions {
        line_height: 1.2,
        ..defaults
    };
    assert_eq!(
        fs.read_file("/output").unwrap(),
        safe_bash_rust::document::pdf::write_pdf_with_options(&document, &options).unwrap()
    );
}
#[test]
fn resource_and_output_failures_preserve_the_destination() {
    for target in [
        "https://example.com/image.png",
        "//example.com/image.png",
        "missing.png",
    ] {
        let (mut sh, fs) = shell();
        fs.write_file("/saved", b"KEEP").unwrap();
        let source = format!(
            r#"{{"blocks":[{{"t":"Para","c":[{{"t":"Image","c":[["",[],[]],[],["{target}",""]]}}]}}]}}"#
        );
        for format in ["docx", "pdf"] {
            let result = exec(&mut sh, &source, format, "-o /saved");
            assert_ne!(result.exit_code, 0);
            assert!(result.stdout.is_empty());
            assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
        }
    }
    for format in ["docx", "pdf"] {
        let (mut sh, fs) = shell();
        fs.write_file("/saved", b"KEEP").unwrap();
        sh.set_limits(ShellLimits {
            max_output_bytes: 64,
            ..Default::default()
        });
        let result = sh.exec_with_options(
            &format!("pandoc -f json -t {format} -o /saved"),
            ExecOptions {
                stdin: Some(RICH.into()),
                ..Default::default()
            },
        );
        assert!(result.unwrap_err().contains("maxOutputBytes"));
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
}

#[test]
fn raw_inline_policy_rejects_before_publication_and_escape_never_reads_images() {
    let (mut sh, fs) = shell();
    let source = r#"{"blocks":[{"t":"Para","c":[{"t":"RawInline","c":["html5","<img src='missing.png'>"]}]}]}"#;
    for format in ["docx", "pdf"] {
        fs.write_file("/saved", b"KEEP").unwrap();
        let rejected = exec(&mut sh, source, format, "--raw-content=reject -o /saved");
        assert_ne!(rejected.exit_code, 0);
        assert!(
            rejected.stderr.contains("Raw content rejected"),
            "{}",
            rejected.stderr
        );
        assert!(rejected.stdout.is_empty());
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
        let escaped = exec(&mut sh, source, format, "--raw-content=escape -o /saved");
        assert_eq!(escaped.exit_code, 0, "{}", escaped.stderr);
        let bytes = fs.read_file("/saved").unwrap();
        if format == "docx" {
            assert!(
                part(&bytes, "word/document.xml")
                    .contains("&lt;img src=&apos;missing.png&apos;&gt;")
            );
        }
    }
}

#[test]
fn oversized_resources_and_total_json_input_fail_without_replacing_output() {
    let (mut sh, fs) = shell();
    let pixels: Vec<u8> = (0..32 * 32 * 4)
        .map(|i| ((i * 57 + i / 7) % 251) as u8)
        .collect();
    let image = terminal_png_rust::png::encode(32, 32, &pixels).unwrap();
    assert!(image.len() > 512);
    fs.write_file("/large.png", &image).unwrap();
    fs.write_file("/saved", b"KEEP").unwrap();
    sh.set_limits(ShellLimits {
        max_input_bytes: 512,
        ..Default::default()
    });
    let source =
        r#"{"blocks":[{"t":"Para","c":[{"t":"Image","c":[["",[],[]],[],["large.png",""]]}]}]}"#;
    for format in ["docx", "pdf"] {
        let result = exec(&mut sh, source, format, "-o /saved");
        assert_ne!(result.exit_code, 0);
        assert!(
            result.stderr.contains("Document resource byte limit"),
            "{}",
            result.stderr
        );
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
    let source = format!(
        r#"{{"blocks":[{{"t":"Para","c":[{{"t":"Str","c":"{}"}}]}}]}}"#,
        "x".repeat(300)
    );
    fs.write_file("/a.json", source.as_bytes()).unwrap();
    fs.write_file("/b.json", source.as_bytes()).unwrap();
    let result = sh.exec("pandoc -f json -t docx /a.json /b.json -o /saved");
    assert!(result.unwrap_err().contains("maxInputBytes"));
    assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
}

#[test]
fn descriptive_raw_image_text_does_not_execute_raw_policy_or_resolve_resources() {
    let (mut sh, fs) = shell();
    fs.write_file(
        "/pixel.png",
        &terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap(),
    )
    .unwrap();
    let source = r#"{"blocks":[{"t":"Para","c":[{"t":"Image","c":[["",[],[]],[{"t":"RawInline","c":["html","<img src='missing.png'>"]}],["pixel.png",""]]}]}]}"#;
    for format in ["docx", "pdf"] {
        let result = exec(&mut sh, source, format, "--raw-content=reject -o /output");
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
    }
}

#[test]
fn typed_docx_images_use_shared_raster_admission_for_vfs_and_data_urls() {
    let (mut sh, fs) = shell();
    let encoded = "R0lGODdhCAAGAIEAAMgUKAAAAAAAAAAAACwAAAAACAAGAAAIDgABCBxIsKDBgwgTDgwIADs=";
    let gif = mcp_protocol_rust::formats::base64_decode(encoded).unwrap();
    assert_eq!(gif, include_bytes!("fixtures/html-images/pixel.gif"));
    fs.write_file("/pixel.gif", &gif).unwrap();
    for target in [
        "pixel.gif".to_owned(),
        format!("data:image/gif;base64,{encoded}"),
    ] {
        let source = format!(
            r#"{{"blocks":[{{"t":"Para","c":[{{"t":"Image","c":[["",[],[]],[],["{target}",""]]}}]}}]}}"#
        );
        let result = exec(&mut sh, &source, "docx", "-o /output");
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert!(
            parse_zip_archive(&fs.read_file("/output").unwrap())
                .unwrap()
                .iter()
                .any(|part| part.name.ends_with(".gif") && part.content == gif)
        );
        let result = exec(&mut sh, &source, "pdf", "-o /pdf");
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let pdf = fs.read_file("/pdf").unwrap();
        assert!(String::from_utf8_lossy(&pdf).contains("/Subtype /Image"));
    }
}

#[test]
fn invalid_heading_levels_are_rejected_before_shift_can_normalize_them() {
    let (mut sh, fs) = shell();
    for level in ["1e100", "0", "1.5"] {
        let source = format!(
            r#"{{"blocks":[{{"t":"Header","c":[{level},["",[],[]],[{{"t":"Str","c":"INVALID"}}]]}}]}}"#
        );
        for format in ["docx", "pdf"] {
            fs.write_file("/saved", b"KEEP").unwrap();
            let result = exec(
                &mut sh,
                &source,
                format,
                "--shift-heading-level-by=1 -o /saved",
            );
            assert_ne!(result.exit_code, 0, "accepted {level}");
            assert!(result.stderr.contains("E_AST"), "{}", result.stderr);
            assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
        }
    }
}

#[test]
fn pdf_layout_budget_is_applied_before_publication() {
    let (mut sh, fs) = shell();
    fs.write_file("/saved", b"KEEP").unwrap();
    sh.set_limits(ShellLimits {
        max_parse_units: 128,
        ..Default::default()
    });
    let source = format!(
        r#"{{"blocks":[{{"t":"Para","c":[{{"t":"Str","c":"{}"}}]}}]}}"#,
        "budget ".repeat(128)
    );
    let result = exec(&mut sh, &source, "pdf", "-o /saved");
    assert_ne!(result.exit_code, 0);
    assert!(result.stderr.contains("layoutWork"), "{}", result.stderr);
    assert!(result.stdout.is_empty());
    assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
}

#[test]
fn visible_metadata_images_resolve_inside_the_native_vfs() {
    let (mut sh, fs) = shell();
    fs.write_file(
        "/pixel.png",
        &terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap(),
    )
    .unwrap();
    let source = r#"{"meta":{"title":{"t":"MetaInlines","c":[{"t":"Str","c":"VISIBLE TITLE"},{"t":"Space"},{"t":"Image","c":[["",[],[]],[{"t":"Str","c":"TITLEIMAGE"}],["pixel.png",""]]}]},"subtitle":{"t":"MetaInlines","c":[{"t":"RawInline","c":["html","<img src='pixel.png' alt='SUBTITLEIMAGE'>"]}]},"unused":{"t":"MetaInlines","c":[{"t":"Image","c":[["",[],[]],[],["never-read.png",""]]}]}},"blocks":[{"t":"Para","c":[{"t":"Str","c":"BODY"}]}]}"#;
    for format in ["docx", "pdf"] {
        let result = exec(&mut sh, source, format, "-o /output");
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let bytes = fs.read_file("/output").unwrap();
        if format == "docx" {
            let body = part(&bytes, "word/document.xml");
            assert!(body.find("VISIBLE TITLE").unwrap() < body.find("BODY").unwrap());
            assert_eq!(body.matches("<w:drawing ").count(), 2);
            assert!(body.contains("TITLEIMAGE"));
            assert!(body.contains("SUBTITLEIMAGE"));
        } else {
            assert!(String::from_utf8_lossy(&bytes).contains("/Subtype /Image"));
        }
        fs.write_file("/saved", b"KEEP").unwrap();
        let missing = source.replace("pixel.png", "missing.png");
        let result = exec(&mut sh, &missing, format, "-o /saved");
        assert_ne!(result.exit_code, 0);
        assert!(result.stdout.is_empty());
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
}

#[test]
fn visible_metadata_raw_policy_runs_before_resource_discovery() {
    let (mut sh, fs) = shell();
    let source = r#"{"meta":{"title":{"t":"MetaInlines","c":[{"t":"RawInline","c":["html","<img src='missing.png'>"]}]}},"blocks":[{"t":"Para","c":[{"t":"Str","c":"BODY"}]}]}"#;
    for format in ["docx", "pdf"] {
        fs.write_file("/saved", b"KEEP").unwrap();
        let result = exec(&mut sh, source, format, "--raw-content=reject -o /saved");
        assert_ne!(result.exit_code, 0);
        assert!(
            result.stderr.contains("Raw content rejected"),
            "{}",
            result.stderr
        );
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
        let escaped = exec(&mut sh, source, format, "--raw-content=escape -o /saved");
        assert_eq!(escaped.exit_code, 0, "{}", escaped.stderr);
        if format == "docx" {
            assert!(
                part(&fs.read_file("/saved").unwrap(), "word/document.xml")
                    .contains("&lt;img src=&apos;missing.png&apos;&gt;")
            );
        }
    }
}

#[test]
fn truncated_gif_is_rejected_before_replacing_pdf_output() {
    let (mut sh, fs) = shell();
    let encoded = "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    let gif = mcp_protocol_rust::formats::base64_decode(encoded).unwrap();
    fs.write_file("/truncated.gif", &gif).unwrap();
    for target in [
        "truncated.gif".to_owned(),
        format!("data:image/gif;base64,{encoded}"),
    ] {
        let source = format!(
            r#"{{"blocks":[{{"t":"Para","c":[{{"t":"Image","c":[["",[],[]],[],["{target}",""]]}}]}}]}}"#
        );
        fs.write_file("/saved", b"KEEP").unwrap();
        let rejected = exec(&mut sh, &source, "pdf", "-o /saved");
        assert_ne!(rejected.exit_code, 0);
        assert_eq!(rejected.stderr, "pandoc: Truncated GIF LZW data\n");
        assert!(rejected.stdout.is_empty());
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
}
