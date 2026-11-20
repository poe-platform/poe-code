use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
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
fn run(shell: &mut Shell, blocks: &str, target: &str, options: &str) -> safe_bash_rust::ExecOutput {
    shell
        .exec_with_options(
            &format!("pandoc -f json -t {target} {options}"),
            ExecOptions {
                stdin: Some(format!(
                    r#"{{"pandoc-api-version":[1,23,1,2],"meta":{{}},"blocks":{blocks}}}"#
                )),
                ..Default::default()
            },
        )
        .unwrap()
}
#[test]
fn raw_blocks_roundtrip_without_becoming_paragraphs_or_inline_nodes() {
    let blocks = r#"[{"t":"RawBlock","c":["html","<div id='wrapper'>"]},{"t":"OrderedList","c":[[3,{"t":"Decimal"},{"t":"Period"}],[[{"t":"Plain","c":[{"t":"Str","c":"ITEM"}]}]]]},{"t":"RawBlock","c":["html","</div>"]}]"#;
    let (mut sh, _) = shell();
    let result = run(&mut sh, blocks, "json", "");
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let actual = json::parse(result.stdout.as_bytes(), Default::default()).unwrap();
    assert_eq!(
        actual.get("blocks"),
        Some(&json::parse(blocks.as_bytes(), Default::default()).unwrap())
    );
    let html = run(&mut sh, blocks, "html", "");
    assert_eq!(html.exit_code, 0, "{}", html.stderr);
    assert!(
        html.stdout
            .starts_with("<div id='wrapper'>\n<ol start=\"3\" type=\"1\">"),
        "{}",
        html.stdout
    );
    assert!(html.stdout.ends_with("</ol>\n</div>\n"), "{}", html.stdout);
}
#[test]
fn raw_tables_code_and_images_reach_both_document_engines() {
    let blocks = r#"[{"t":"RawBlock","c":["html","<table><tr><th>HEADER</th><td>CELL</td></tr></table><pre><code>CODE &lt;literal&gt;\n  INDENTED</code></pre><p><img src='pixel.png' width='48' height='24' alt='PIXEL'></p>"]}]"#;
    let (mut sh, fs) = shell();
    fs.write_file(
        "/pixel.png",
        &terminal_png_rust::png::encode(2, 1, &[255, 0, 0, 255, 0, 255, 0, 255]).unwrap(),
    )
    .unwrap();
    for target in ["docx", "pdf"] {
        let result = run(&mut sh, blocks, target, "-o /output");
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let bytes = fs.read_file("/output").unwrap();
        let source = String::from_utf8_lossy(&bytes);
        if target == "docx" {
            for token in [
                "<w:tbl>",
                "HEADER",
                "CELL",
                "CODE &lt;literal&gt;",
                "  INDENTED",
                "word/media/image-1.png",
                "PIXEL",
            ] {
                assert!(source.contains(token), "missing {token}");
            }
        } else {
            assert!(bytes.starts_with(b"%PDF-"));
            assert!(source.contains("/Subtype /Image"), "missing PDF image");
            assert!(
                source.contains("> <0048>"),
                "missing PDF header glyph in ToUnicode map"
            );
        }
    }
}
#[test]
fn unsupported_json_nodes_fail_before_stdout_or_destination_publication() {
    let (mut sh, fs) = shell();
    for blocks in [
        r#"[{"t":"Table","c":[]}]"#,
        r#"[{"t":"CustomBlock","c":"HIDDEN"}]"#,
        r#"[{"t":"BlockQuote","c":[{"t":"Para","c":[{"t":"Strong","c":[{"t":"CustomInline","c":"HIDDEN"}]}]}]}]"#,
        r#"[{"t":"BulletList","c":[[{"t":"DefinitionList","c":[]}]]}]"#,
    ] {
        for target in ["json", "docx", "pdf"] {
            for options in ["", "-o /saved"] {
                fs.write_file("/saved", b"KEEP").unwrap();
                let result = run(&mut sh, blocks, target, options);
                assert_ne!(
                    result.exit_code, 0,
                    "silently accepted {blocks} -> {target}"
                );
                assert!(
                    result.stderr.contains("Unsupported Pandoc JSON")
                        || target != "json"
                            && (result.stderr.contains("E_AST:")
                                || result.stderr.contains("E_CAPABILITY:")
                                || result.stderr.contains("E_UNSUPPORTED_FEATURE:")),
                    "{}",
                    result.stderr
                );
                assert!(result.stdout.is_empty());
                assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
            }
        }
    }
}
#[test]
fn null_is_nonrendering_but_malformed_content_is_not_silently_dropped() {
    let (mut sh, _) = shell();
    let result = run(
        &mut sh,
        r#"[{"t":"Null"},{"t":"Para","c":[{"t":"Str","c":"KEEP"}]}]"#,
        "plain",
        "",
    );
    assert_eq!(result.exit_code, 0);
    assert_eq!(result.stdout, "KEEP\n");
    for blocks in [
        r#"[null]"#,
        r#"[{"c":"missing tag"}]"#,
        r#"[{"t":"Para","c":"not inlines"}]"#,
        r#"[{"t":"Para","c":[{"t":"Str"}]}]"#,
        r#"[{"t":"RawBlock","c":["html"]}]"#,
        r#"[{"t":"BulletList","c":["invalid item"]}]"#,
    ] {
        let result = run(&mut sh, blocks, "json", "");
        assert_ne!(result.exit_code, 0, "accepted malformed {blocks}");
        assert!(result.stdout.is_empty());
    }
}
#[test]
fn raw_block_policies_preserve_explicit_text_and_comment_stripping() {
    let blocks = r#"[{"t":"RawBlock","c":["html","<b><!--hidden-->VISIBLE</b>"]}]"#;
    let (mut sh, fs) = shell();
    let html = run(&mut sh, blocks, "html", "--strip-comments");
    assert_eq!(html.exit_code, 0);
    assert_eq!(html.stdout, "<b>VISIBLE</b>\n");
    let escaped = run(&mut sh, blocks, "html", "--raw-content=escape");
    assert_eq!(escaped.exit_code, 0);
    assert!(
        escaped
            .stdout
            .contains("&lt;b&gt;&lt;!--hidden--&gt;VISIBLE&lt;/b&gt;")
    );
    for policy in ["escape", "retain"] {
        let plain = run(&mut sh, blocks, "plain", &format!("--raw-content={policy}"));
        assert_eq!(plain.exit_code, 0);
        assert_eq!(plain.stdout, "<b><!--hidden-->VISIBLE</b>\n");
    }
    for (target, options) in [
        ("plain", ""),
        ("html", "--raw-content=reject"),
        ("docx", "--raw-content=reject"),
        ("pdf", "--raw-content=reject"),
        ("rst", ""),
    ] {
        fs.write_file("/saved", b"KEEP").unwrap();
        let result = run(&mut sh, blocks, target, &format!("{options} -o /saved"));
        assert_ne!(result.exit_code, 0, "{target} {options}");
        assert_eq!(fs.read_file("/saved").unwrap(), b"KEEP");
    }
    let stripped = run(&mut sh, blocks, "json", "--strip-comments");
    assert_eq!(stripped.exit_code, 0);
    assert!(!stripped.stdout.contains("hidden"));
    let parsed = json::parse(stripped.stdout.as_bytes(), Default::default()).unwrap();
    assert!(matches!(parsed.get("blocks"), Some(Value::Array(items)) if items.len() == 1));
}

#[test]
fn markdown_raw_blocks_preserve_source_and_split_wrappers_through_json() {
    let source = "<div id='wrapper'>\n\n1. FIRST\n2. SECOND\n\n<table><tr><td>CELL</td></tr></table>\n\n<pre><code>CODE &lt;literal&gt;\n  INDENTED</code></pre>\n\n</div>\n";
    let (mut sh, fs) = shell();
    let parsed = sh
        .exec_with_options(
            "pandoc -f gfm -t json",
            ExecOptions {
                stdin: Some(source.into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(parsed.exit_code, 0, "{}", parsed.stderr);
    let tree = json::parse(parsed.stdout.as_bytes(), Default::default()).unwrap();
    let Some(Value::Array(blocks)) = tree.get("blocks") else {
        panic!()
    };
    let kinds: Vec<_> = blocks.iter().map(|b| b.get("t").unwrap().clone()).collect();
    let tags = json::parse(
        br#"["RawBlock","OrderedList","RawBlock","RawBlock","RawBlock"]"#,
        Default::default(),
    )
    .unwrap();
    assert_eq!(Value::Array(kinds), tags);
    assert!(parsed.stdout.contains("  INDENTED"));
    for (from, input) in [("gfm", source.to_owned()), ("json", parsed.stdout)] {
        let result = sh
            .exec_with_options(
                &format!("pandoc -f {from} -t docx -o /output"),
                ExecOptions {
                    stdin: Some(input),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let bytes = fs.read_file("/output").unwrap();
        let xml = String::from_utf8_lossy(&bytes);
        for token in [
            "w:name=\"wrapper\"",
            "<w:numPr>",
            "FIRST",
            "SECOND",
            "<w:tbl>",
            "CELL",
            "CODE &lt;literal&gt;",
            "  INDENTED",
        ] {
            assert!(xml.contains(token), "{from} missing {token}");
        }
    }
}
