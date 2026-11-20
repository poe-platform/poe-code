use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
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

#[test]
fn portable_search_document_preserves_symbols_and_emoticons() {
    let (mut sh, fs) = shell();
    let source = include_bytes!("../../safe-bash/docs/PORTABLE_SEARCH.md");
    fs.write_file("/source.md", source).unwrap();
    let generated = sh
        .exec("pandoc -f gfm -t pdf /source.md -o /source.pdf")
        .unwrap();
    assert_eq!(generated.exit_code, 0, "{}", generated.stderr);
    let bytes = fs.read_file("/source.pdf").unwrap();
    let objects = String::from_utf8_lossy(&bytes);
    assert!(objects.contains("<26BD>"), "soccer ToUnicode mapping");
    assert!(
        objects.contains("<D83DDE00>"),
        "supplementary UTF-16 mapping"
    );
    for mode in ["", "-raw", "-layout", "-bbox", "-bbox-layout", "-tsv"] {
        let result = sh.exec(&format!("pdftotext {mode} /source.pdf -")).unwrap();
        assert_eq!(result.exit_code, 0, "{mode}: {}", result.stderr);
        assert!(result.stdout.contains('⚽'), "{mode}: missing soccer ball");
        assert!(
            result.stdout.contains("é😀"),
            "{mode}: missing source emoticon"
        );
        assert!(!result.stdout.contains('\0'), "{mode}: raw CID bytes");
        assert!(
            !result.stdout.contains('\u{fffd}'),
            "{mode}: replacement glyph"
        );
    }
}

#[test]
fn native_generated_pdf_roundtrips_unicode_through_all_pdftotext_modes() {
    let (mut sh, fs) = shell();
    // Expected text/order independently checked against PDFium on this writer.
    fs.write_file(
        "/source.md",
        "# Café Łódź\n\nZażółć gęślą jaźń.\n\n**Ωμέγα** and _Жук_.\n".as_bytes(),
    )
    .unwrap();
    let generated = sh
        .exec("pandoc -f markdown -t pdf /source.md -o /source.pdf")
        .unwrap();
    assert_eq!(generated.exit_code, 0, "{}", generated.stderr);
    for mode in ["", "-raw", "-layout", "-bbox", "-bbox-layout", "-tsv"] {
        let result = sh.exec(&format!("pdftotext {mode} /source.pdf -")).unwrap();
        assert_eq!(result.exit_code, 0, "{mode}: {}", result.stderr);
        assert!(
            !result.stdout.contains('\0'),
            "{mode}: raw CID bytes escaped"
        );
        let mut cursor = 0;
        for word in [
            "Café",
            "Łódź",
            "Zażółć",
            "gęślą",
            "jaźń.",
            "Ωμέγα",
            "and",
            "Жук",
        ] {
            let at = result.stdout[cursor..].find(word).unwrap_or_else(|| {
                panic!("{mode}: missing/out-of-order {word}: {:?}", result.stdout)
            });
            cursor += at + word.len();
        }
    }
}

#[test]
fn malformed_or_unsupported_composite_maps_fail_without_publishing_raw_codes() {
    let (mut sh, fs) = shell();
    fs.write_file("/source.md", b"A B\n").unwrap();
    assert_eq!(
        sh.exec("pandoc -t pdf /source.md -o /source.pdf")
            .unwrap()
            .exit_code,
        0
    );
    let original = fs.read_file("/source.pdf").unwrap();
    for (from, to) in [
        (b"<0041>".as_slice(), b"<D800>".as_slice()),
        (b"<0041>".as_slice(), b"<DC00>".as_slice()),
        (b"/Identity-H".as_slice(), b"/Identity-V".as_slice()),
        (b"/ToUnicode".as_slice(), b"/NoUnicode".as_slice()),
        (b"endbfchar".as_slice(), b"badbfchar".as_slice()),
    ] {
        let mut bytes = original.clone();
        let at = bytes.windows(from.len()).position(|s| s == from).unwrap();
        bytes[at..at + from.len()].copy_from_slice(to);
        fs.write_file("/bad.pdf", &bytes).unwrap();
        for mode in ["", "-raw", "-layout", "-bbox", "-tsv"] {
            fs.write_file("/out.txt", b"KEEP").unwrap();
            let result = sh
                .exec(&format!("pdftotext {mode} /bad.pdf /out.txt"))
                .unwrap();
            assert_ne!(
                result.exit_code,
                0,
                "{mode} accepted {:?}",
                String::from_utf8_lossy(to)
            );
            assert!(result.stdout.is_empty());
            assert_eq!(fs.read_file("/out.txt").unwrap(), b"KEEP");
        }
    }
}

fn stream(bytes: &[u8]) -> Vec<u8> {
    [
        format!("<< /Length {} >>\nstream\n", bytes.len()).as_bytes(),
        bytes,
        b"\nendstream",
    ]
    .concat()
}
fn composite_pdf(mapping: &str) -> Vec<u8> {
    let cmap = format!(
        "begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange {mapping} endcmap"
    );
    let objects=vec![
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] /MediaBox [0 0 200 200] >>".to_vec(),
        b"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>".to_vec(),
        stream(b"BT /F1 12 Tf 1 0 0 1 20 150 Tm <00010100FFFF> Tj ET"),
        b"<< /Type /Font /Subtype /Type0 /BaseFont /LiberationSans /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 8 0 R >>".to_vec(),
        b"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /LiberationSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 7 0 R /DW 600 /CIDToGIDMap /Identity >>".to_vec(),
        b"<< /Type /FontDescriptor /FontName /LiberationSans /Flags 32 /FontBBox [-100 -200 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 9 0 R >>".to_vec(),
        stream(cmap.as_bytes()),
        stream(include_bytes!("../../pdf-ast-rust/src/fonts/LiberationSans-Regular.ttf")),
    ];
    classic_pdf(&objects)
}

fn classic_pdf(objects: &[Vec<u8>]) -> Vec<u8> {
    let mut pdf = b"%PDF-1.7\n".to_vec();
    let mut offsets = Vec::new();
    for (i, body) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend(format!("{} 0 obj\n", i + 1).bytes());
        pdf.extend(body);
        pdf.extend(b"\nendobj\n");
    }
    let xref = pdf.len();
    pdf.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).bytes());
    for offset in offsets {
        pdf.extend(format!("{offset:010} 00000 n \n").bytes());
    }
    pdf.extend(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        )
        .bytes(),
    );
    pdf
}

#[test]
fn bfchar_sequences_and_surrogates_reach_plain_and_spatial_output() {
    let (mut sh, fs) = shell();
    fs.write_file(
        "/input.pdf",
        &composite_pdf("3 beginbfchar <0001> <00660069> <0100> <D83DDE00> <FFFF> <03A9> endbfchar"),
    )
    .unwrap();
    for mode in ["", "-raw", "-layout", "-bbox", "-tsv"] {
        let result = sh.exec(&format!("pdftotext {mode} /input.pdf -")).unwrap();
        assert_eq!(result.exit_code, 0, "{mode}: {}", result.stderr);
        assert!(
            result.stdout.contains("fi😀Ω"),
            "{mode}: {:?}",
            result.stdout
        );
    }
    fs.write_file(
        "/input.pdf",
        &composite_pdf("2 beginbfchar <0001> <0041> <0100> <0042> endbfchar"),
    )
    .unwrap();
    for mode in ["", "-raw", "-layout", "-bbox", "-tsv"] {
        let result = sh.exec(&format!("pdftotext {mode} /input.pdf -")).unwrap();
        assert_ne!(result.exit_code, 0, "{mode}: missing CID was guessed");
        assert!(result.stdout.is_empty());
    }
}

#[test]
fn unicode_mapping_changes_extraction_without_changing_raster_glyph_ids() {
    let (mut sh, fs) = shell();
    fs.write_file("/source.md", b"A\n").unwrap();
    assert_eq!(
        sh.exec("pandoc -t pdf /source.md -o /one.pdf")
            .unwrap()
            .exit_code,
        0
    );
    let mut bytes = fs.read_file("/one.pdf").unwrap();
    let at = bytes.windows(6).position(|v| v == b"<0041>").unwrap();
    bytes[at..at + 6].copy_from_slice(b"<0042>");
    fs.write_file("/two.pdf", &bytes).unwrap();
    for name in ["one", "two"] {
        let result = sh
            .exec(&format!("pdftoppm -scale-to 80 -png /{name}.pdf /{name}"))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
    }
    assert_eq!(
        fs.read_file("/one-1.png").unwrap(),
        fs.read_file("/two-1.png").unwrap()
    );
    assert_eq!(sh.exec("pdftotext /one.pdf -").unwrap().stdout.trim(), "A");
    assert_eq!(sh.exec("pdftotext /two.pdf -").unwrap().stdout.trim(), "B");
}

#[test]
fn supported_simple_fonts_keep_unicode_and_layout_line_breaks() {
    let (mut sh, fs) = shell();
    let bytes=classic_pdf(&[
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] /MediaBox [0 0 200 200] >>".to_vec(),
        b"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>".to_vec(),
        stream(b"BT /F1 12 Tf 1 0 0 1 20 150 Tm (legacy-) Tj 0 -12 Td (word) Tj 0 -12 Td (Caf\\351) Tj ET"),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>".to_vec(),
    ]);
    fs.write_file("/simple.pdf", &bytes).unwrap();
    for mode in ["", "-raw", "-layout", "-bbox", "-tsv"] {
        let result = sh.exec(&format!("pdftotext {mode} /simple.pdf -")).unwrap();
        assert_eq!(result.exit_code, 0, "{mode}: {}", result.stderr);
        assert!(
            result.stdout.contains("Café"),
            "{mode}: {:?}",
            result.stdout
        );
        if matches!(mode, "-raw" | "-layout") {
            assert!(
                result.stdout.contains("legacy-\nword"),
                "{mode}: {:?}",
                result.stdout
            );
        }
    }
}

#[test]
fn expanded_unicode_obeys_output_limits_before_publication() {
    let (mut sh, fs) = shell();
    fs.write_file(
        "/input.pdf",
        &composite_pdf("3 beginbfchar <0001> <00660069> <0100> <D83DDE00> <FFFF> <03A9> endbfchar"),
    )
    .unwrap();
    fs.write_file("/out.txt", b"KEEP").unwrap();
    sh.set_limits(safe_bash_rust::ShellLimits {
        max_output_bytes: 8,
        ..Default::default()
    });
    let result = sh.exec("pdftotext /input.pdf /out.txt");
    assert!(result.is_err() || result.unwrap().exit_code != 0);
    assert_eq!(fs.read_file("/out.txt").unwrap(), b"KEEP");
}

#[test]
fn shared_fonts_are_admitted_once_across_a_long_generated_pdf() {
    let (mut sh, fs) = shell();
    let source = (0..420)
        .map(|i| {
            format!(
                "Paragraph {i}. **Bold** and *italic* and ***both*** and `code`. Plain text.\n\n"
            )
        })
        .collect::<String>();
    fs.write_file("/source.md", source.as_bytes()).unwrap();
    let result = sh
        .exec("pandoc -f markdown -t pdf /source.md -o /long.pdf")
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let pdf = fs.read_file("/long.pdf").unwrap();
    assert!(pdf.windows(12).filter(|s| *s == b"/Type /Page ").count() >= 12);
    for mode in ["", "-raw", "-layout", "-bbox", "-tsv"] {
        let result = sh.exec(&format!("pdftotext {mode} /long.pdf -")).unwrap();
        assert_eq!(result.exit_code, 0, "{mode}: {}", result.stderr);
        assert_eq!(result.stdout.matches("Paragraph").count(), 420, "{mode}");
        assert!(result.stdout.contains("419."), "{mode}: lost the last page");
    }
    for (flags, prefix) in [("-f 1 -l 12", "all"), ("-f 12 -l 12", "last")] {
        let result = sh
            .exec(&format!(
                "pdftoppm {flags} -scale-to 40 -png /long.pdf /{prefix}"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
    }
    assert_eq!(
        fs.read_file("/all-12.png").unwrap(),
        fs.read_file("/last-12.png").unwrap(),
        "font reuse changed rendering after previous pages"
    );
}

#[test]
fn default_four_column_reading_order_matches_the_public_javascript_reader() {
    let (mut sh, fs) = shell();
    fs.write_file("/source.md",b"| Case | Family | Light | Dark |\n| --- | --- | --- | --- |\n| diagram-003-flowchart | flowchart | Approved | Approved |\n| diagram-004-flowchart | flowchart | Approved | Approved |\n").unwrap();
    assert_eq!(
        sh.exec("pandoc -f gfm -t pdf /source.md -o /table.pdf")
            .unwrap()
            .exit_code,
        0
    );
    let expected = "Case\n\nFamily\n\nLight\n\nDark\n\ndiagram-003-flowchart flowchart\n\nApproved\n\nApproved\n\ndiagram-004-flowchart flowchart\n\nApproved\n\nApproved\n\n\x0c";
    assert_eq!(sh.exec("pdftotext /table.pdf -").unwrap().stdout, expected);
}

#[test]
fn layout_preserves_table_columns_like_the_public_javascript_reader() {
    let (mut sh, fs) = shell();
    fs.write_file("/source.md",b"| Name | Trigger | Description |\n| --- | --- | --- |\n| `github-pull-request-synchronized` | PR updated | Re-reviews the PR after new commits are pushed |\n").unwrap();
    assert_eq!(
        sh.exec("pandoc -f gfm -t pdf /source.md -o /table.pdf")
            .unwrap()
            .exit_code,
        0
    );
    // Exact public extractPdfToTextBytes(bytes, ['-layout']) reference.
    let expected = "Name                          Trigger      Description\n\ngithub-pull-request-synchroni PR updated   Re-reviews the PR after new\nzed                                        commits are pushed\n\x0c";
    let result = sh.exec("pdftotext -layout /table.pdf -").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, expected);
    let normal = sh.exec("pdftotext /table.pdf -").unwrap();
    assert_eq!(
        normal.stdout,
        "Name\n\nTrigger\n\ngithub-pull-request-synchroni PR updated\nzed\n\nDescription\n\nRe-reviews the PR after new\ncommits are pushed\n\n\x0c"
    );
    assert_eq!(
        sh.exec("pdftotext -raw /table.pdf -").unwrap().stdout,
        "Name Trigger Description\ngithub-pull-request-synchroni\nzed\nPR updated Re-reviews the PR after new\ncommits are pushed\x0c"
    );
}
