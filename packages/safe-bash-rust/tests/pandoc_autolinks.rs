use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{
    BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions,
    commands::codecs::parse_zip_archive,
};
use std::sync::Arc;

fn text(value: &Value) -> String {
    let Value::String(units) = value else {
        panic!("expected string")
    };
    String::from_utf16(units).unwrap()
}

fn run(source: &str, from: &str, to: &str) -> safe_bash_rust::ExecOutput {
    Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    )
    .exec_with_options(
        &format!("pandoc -f {from} -t {to}"),
        ExecOptions {
            stdin: Some(source.into()),
            ..Default::default()
        },
    )
    .unwrap()
}

#[test]
fn native_autolinks_and_strikeout_match_public_javascript_ast() {
    // Captured from public JS readDocument/writeDocument and cross-checked with
    // Pandoc 2.19.2; URI percent-encoding follows the existing JS contract.
    assert_fixture(include_bytes!("fixtures/pandoc-autolinks.json"));
}

fn assert_fixture(fixture: &[u8]) {
    let Value::Array(cases) = json::parse(fixture, Default::default()).unwrap() else {
        panic!("fixtures")
    };
    let mut differences = Vec::new();
    for case in cases {
        let source = text(case.get("source").unwrap());
        let from = text(case.get("from").unwrap());
        let output = run(&source, &from, "json");
        assert_eq!(output.exit_code, 0, "{from}: {source:?}: {}", output.stderr);
        let document = json::parse(output.stdout.as_bytes(), Default::default()).unwrap();
        if document.get("blocks") != case.get("blocks") {
            differences.push(format!("{from}: {source:?}: {}", output.stdout.trim()));
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
fn image_labels_preserve_original_escaping_code_entities_and_nested_atoms() {
    // Both CommonMark/GFM oracles agree exactly on these canonical ASTs.
    assert_fixture(include_bytes!("fixtures/pandoc-image-alt.json"));
}

#[test]
fn unsafe_autolink_schemes_remain_parseable_but_pdf_rejects_them() {
    for source in [
        "<javascript:alert(1)>",
        "<file:///private/file>",
        "<ftp://example.com/file>",
    ] {
        let parsed = run(source, "commonmark", "json");
        assert_eq!(parsed.exit_code, 0);
        assert!(parsed.stdout.contains("\"Link\""), "{}", parsed.stdout);
        let output = run(source, "commonmark", "pdf");
        assert_ne!(output.exit_code, 0, "accepted {source}");
        assert!(
            output.stderr.contains("Invalid or unsupported PDF link"),
            "{}",
            output.stderr
        );
    }
    for source in ["<https://example.com>", "<a@example.com>"] {
        let output = run(source, "commonmark", "pdf");
        assert_eq!(output.exit_code, 0, "{}", output.stderr);
        assert!(
            output.stdout.contains("/Subtype /Link"),
            "missing PDF autolink"
        );
    }
}

#[test]
fn inline_profile_flags_reach_tables_quotes_and_footnotes() {
    for (source, from, link) in [
        ("> https://example.com and ~~text~~", "commonmark", false),
        ("> https://example.com and ~~text~~", "gfm", true),
        (
            "| Column |\n| --- |\n| https://example.com and ~~text~~ |",
            "gfm",
            true,
        ),
        (
            "text[^n]\n\n[^n]: https://example.com and ~~text~~",
            "gfm+footnotes",
            true,
        ),
        (
            "text[^n]\n\n[^n]: https://example.com and ~~text~~",
            "gfm+footnotes-autolink_bare_uris-strikeout",
            false,
        ),
    ] {
        let output = run(source, from, "json");
        assert_eq!(output.exit_code, 0, "{}", output.stderr);
        assert_eq!(output.stdout.contains("\"Link\""), link, "{from}: {source}");
        assert_eq!(
            output.stdout.contains("\"Strikeout\""),
            link,
            "{from}: {source}"
        );
    }
}

#[test]
fn html_reader_text_does_not_acquire_markdown_autolinks() {
    let output = run(
        "<p>&lt;https://example.com&gt; ~~text~~</p>",
        "html",
        "json",
    );
    assert_eq!(output.exit_code, 0, "{}", output.stderr);
    assert!(!output.stdout.contains("\"Link\""));
    assert!(output.stdout.contains("<https://example.com>"));
    assert!(!output.stdout.contains("\"Strikeout\""));
    assert!(output.stdout.contains("~~text~~"));
}

#[test]
fn mdq_keeps_plain_image_descriptions_and_its_existing_autolinks_and_single_tildes() {
    let source = "![**bold** and `*literal*` &amp;lt; [link](x)](image.png)\n\n~one~ ~~two~~ <https://example.com> a@example.com\n";
    for (command, expected) in [
        (
            "mdq --output plain ''",
            "bold and *literal* &lt; link\none two https://example.com a@example.com\n",
        ),
        (
            "mdq --link-format inline ''",
            "![bold and *literal* &lt; link](image.png)\n\n~~one~~ ~~two~~ <https://example.com> a@example.com\n",
        ),
        (
            "mdq --output json ''",
            r#"{"items":[{"document":[{"paragraph":"![bold and *literal* &lt; link][1]"},{"paragraph":"~~one~~ ~~two~~ <https://example.com> a@example.com"}]}],"links":{"1":{"url":"image.png"}}}"#,
        ),
    ] {
        let output = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                cwd: Some("/".into()),
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        )
        .exec_with_options(
            command,
            ExecOptions {
                stdin: Some(source.into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(output.exit_code, 0, "{}", output.stderr);
        assert_eq!(output.stdout, expected, "{command}");
    }
}

#[test]
fn rich_image_descriptions_do_not_acquire_nested_resources_or_active_links() {
    let fs = MemoryVfs::new();
    fs.write_file(
        "/outer.png",
        &terminal_png_rust::png::encode(1, 1, &[255, 0, 0, 255]).unwrap(),
    )
    .unwrap();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    for to in ["docx", "pdf"] {
        let output = shell
            .exec_with_options(
                &format!("pandoc -f commonmark -t {to} -o /out.{to}"),
                ExecOptions {
                    stdin: Some("![A ![B](absent.png) [C](javascript:ignored)](/outer.png)".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(output.exit_code, 0, "{}", output.stderr);
        let bytes = fs.read_file(&format!("/out.{to}")).unwrap();
        if to == "docx" {
            let part = parse_zip_archive(&bytes)
                .unwrap()
                .into_iter()
                .find(|part| part.name == "word/document.xml")
                .unwrap();
            let xml = String::from_utf8(part.content).unwrap();
            assert!(xml.contains("descr=\"A B C\""));
            assert_eq!(xml.matches("<w:drawing").count(), 1);
            assert!(!xml.contains("<w:hyperlink"));
        } else {
            let pdf = String::from_utf8_lossy(&bytes);
            assert_eq!(pdf.matches("/Subtype /Image").count(), 1);
            assert!(!pdf.contains("/Subtype /Link"));
        }
    }
}
