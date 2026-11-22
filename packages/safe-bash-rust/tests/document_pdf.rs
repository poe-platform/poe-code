use safe_bash_rust::{
    MemoryVfs, SafeBashFs,
    commands::archive::try_run_archive_command,
    document::{self, Block, Document, Inline, Paragraph, TextStyle},
};

fn text_pdf(text: &str) -> Vec<u8> {
    document::write_pdf(&Document {
        title: "Portable document".into(),
        blocks: vec![Block::Paragraph(Paragraph {
            inlines: vec![Inline::Text {
                text: text.into(),
                style: TextStyle::default(),
            }],
            ..Default::default()
        })],
    })
    .unwrap()
}

fn info(bytes: &[u8]) -> String {
    let fs = MemoryVfs::new();
    fs.write_file("/input.pdf", bytes).unwrap();
    let result = try_run_archive_command(
        "pdfinfo",
        &["/input.pdf".into()],
        "",
        "/",
        &Default::default(),
        &fs,
    )
    .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    result.stdout
}

#[test]
fn unicode_has_an_embedded_font_and_complete_to_unicode_map() {
    let text = "Zażółć gęślą jaźń. Café, naïve, résumé. “Curly quotes” – —.";
    let bytes = text_pdf(text);
    assert!(bytes.starts_with(b"%PDF-1.7"));
    let raw = String::from_utf8_lossy(&bytes);
    assert!(raw.contains("/FontFile2"));
    assert!(raw.contains("/ToUnicode"));
    for c in text.chars() {
        assert!(
            raw.contains(&format!("<{:04X}>", c as u32)),
            "Missing Unicode mapping for {c}"
        );
    }
    assert!(info(&bytes).contains("Pages:"));
}

#[test]
fn long_documents_have_a_valid_page_tree() {
    let source = (0..180)
        .map(|n| format!("Paragraph {n}: the document continues on the following page."))
        .collect::<Vec<_>>()
        .join("\n");
    let bytes = text_pdf(&source);
    let raw = String::from_utf8_lossy(&bytes);
    let count = raw.matches("/Type /Page ").count();
    assert!((4..=6).contains(&count), "unexpected page count {count}");
    assert!(raw.contains(&format!("/Count {count}")));
    let metadata = info(&bytes);
    assert!(metadata.lines().any(|line| line.starts_with("Pages:") && line.trim_end().ends_with(&count.to_string())), "{metadata}");
}

#[test]
fn rich_document_has_links_and_embedded_image() {
    let html = r##"<h1 id="title">A heading</h1><p><b>Bold</b> <i>Italic</i> <mark>Highlight</mark> <a href="https://example.com">A link</a> <a href="#title">Back</a></p><table><tr><th>Item</th><th>Value</th></tr><tr><td>Alpha</td><td>12.50</td></tr></table><p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"/></p>"##;
    let doc = document::from_html(html).unwrap();
    let bytes = document::write_pdf(&doc).unwrap();
    let raw = String::from_utf8_lossy(&bytes);
    assert!(raw.contains("/Subtype /Link"));
    assert!(raw.contains("https://example.com"));
    assert!(raw.contains("/Dest ["));
    assert!(raw.contains("/Subtype /Image"));
    assert!(info(&bytes).contains("Pages:"));
}

#[test]
fn unsupported_glyphs_fail_instead_of_becoming_missing_boxes() {
    let doc = Document {
        title: String::new(),
        blocks: vec![Block::Paragraph(Paragraph {
            inlines: vec![Inline::Text {
                text: "\u{10ffff}".into(),
                style: TextStyle::default(),
            }],
            ..Default::default()
        })],
    };
    assert!(document::write_pdf(&doc).unwrap_err().contains("U+10FFFF"));
}

/// Independent integration check, intentionally outside the zero-dependency
/// default tests. Run with --ignored on hosts with Python pypdfium2 installed.
#[test]
#[ignore = "requires the independent pypdfium2 PDF reader"]
fn independent_pdfium_reads_unicode_and_every_page_boundary() {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let source = format!(
        "Zażółć gęślą jaźń. Café, naïve, résumé. “Curly quotes” – —.\n{}",
        (0..180)
            .map(|n| format!("Paragraph {n}: the document continues."))
            .collect::<Vec<_>>()
            .join("\n")
    );
    let bytes = text_pdf(&source);
    let mut child=Command::new("python3").args(["-c", "import sys,pypdfium2 as pdfium; p=pdfium.PdfDocument(sys.stdin.buffer.read()); print('\\n'.join(page.get_textpage().get_text_range() for page in p))"]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    child.stdin.take().unwrap().write_all(&bytes).unwrap();
    let result = child.wait_with_output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let text = String::from_utf8(result.stdout).unwrap();
    assert!(text.contains("Zażółć gęślą jaźń. Café, naïve, résumé. “Curly quotes” – —."));
    for n in 0..180 {
        assert!(
            text.contains(&format!("Paragraph {n}:")),
            "missing paragraph {n}"
        );
    }
}

#[test]
#[ignore = "requires the independent pypdfium2 PDF reader"]
fn independent_pdfium_verifies_custom_colors_and_rowspan_positions() {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let html = r##"<p><span style="color:#ff0000">Red lettering</span> <span style="background-color:#00ff00">Green highlight</span></p><table><tr><th>Group</th><th>Value</th></tr><tr><td rowspan="2">Shared</td><td>Top</td></tr><tr><td>Bottom</td></tr><tr><td colspan="2">Wide cell</td></tr></table>"##;
    let document = document::from_html(html).unwrap();
    let bytes = document::write_pdf(&document).unwrap();
    let mut child = Command::new("python3")
        .args([
            "-c",
            r#"
import sys,pypdfium2 as pdfium
p=pdfium.PdfDocument(sys.stdin.buffer.read())
page=p[0]; text=page.get_textpage(); content=text.get_text_range()
assert 'Shared' in content and 'Bottom' in content and 'Wide cell' in content,content
shared=text.get_charbox(content.index('Shared'))
bottom=text.get_charbox(content.index('Bottom'))
assert bottom[0] > shared[0]+100,(shared,bottom)
pixels=page.render(scale=1).to_pil().convert('RGB').getdata()
red=sum(r>170 and g<90 and b<90 for r,g,b in pixels)
green=sum(g>170 and r<100 and b<100 for r,g,b in pixels)
assert red>30 and green>100,(red,green)
"#,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(&bytes).unwrap();
    let result = child.wait_with_output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}
