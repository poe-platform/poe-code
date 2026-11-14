use safe_bash_rust::{MemoryVfs, SafeBashFs, commands::archive::try_run_archive_command};

#[test]
fn rasterizers_accept_header_prefixes_and_ignore_unindexed_duplicates() {
    // qpdf 12.4.2 accepts both inputs cleanly; PDFium renders solid red.
    // An unindexed stream after EOF paints green and must not replace the page.
    let prefixed = include_bytes!("fixtures/pdf-header-prefix.pdf");
    let plain = &prefixed[b"leading bytes\n".len()..];
    for command in ["pdftoppm", "pdftocairo"] {
        let fs = MemoryVfs::new();
        let mut expected = None;
        for bytes in [plain, prefixed.as_slice()] {
            for stdin in [false, true] {
                fs.write_file("/input.pdf", bytes).unwrap();
                let input = if stdin { "-" } else { "/input.pdf" };
                let args = ["-png", "-r", "72", "-singlefile", input, "/page"].map(str::to_owned);
                let result = try_run_archive_command(
                    command,
                    &args,
                    if stdin {
                        std::str::from_utf8(bytes).unwrap()
                    } else {
                        ""
                    },
                    "/",
                    &Default::default(),
                    &fs,
                )
                .unwrap();
                assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
                assert!(result.stderr.is_empty());
                let png = fs.read_file("/page.png").unwrap();
                assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
                if let Some(expected) = &expected {
                    assert_eq!(&png, expected);
                } else {
                    expected = Some(png);
                }
                assert_eq!(fs.read_file("/input.pdf").unwrap(), bytes);
            }
        }
        for bytes in [
            b"leading bytes\n%PDF-1.4\nnot a document\n%%EOF\n".as_slice(),
            b"not a PDF",
        ] {
            fs.write_file("/input.pdf", bytes).unwrap();
            fs.write_file("/page.png", b"existing output").unwrap();
            let args = ["-q", "-png", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
            let result =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            assert_ne!(result.exit_code, 0);
            assert!(result.stderr.is_empty());
            assert_eq!(fs.read_file("/page.png").unwrap(), b"existing output");
        }
    }
    let fs = MemoryVfs::new();
    fs.write_file("/input.pdf", prefixed).unwrap();
    let args = ["-r", "72", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
    let result =
        try_run_archive_command("pdftoppm", &args, "", "/", &Default::default(), &fs).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let ppm = fs.read_file("/page.ppm").unwrap();
    let pixels = ppm.strip_prefix(b"P6\n120 80\n255\n").unwrap();
    assert_eq!(pixels.len(), 120 * 80 * 3);
    assert!(pixels.chunks_exact(3).all(|pixel| pixel == [255, 0, 0]));
}

fn pdf(objects: &[&str]) -> String {
    let mut bytes = String::from("%PDF-1.4\n");
    let mut offsets = vec![0];
    for (i, object) in objects.iter().enumerate() {
        offsets.push(bytes.len());
        bytes.push_str(&format!("{} 0 obj\n{object}\nendobj\n", i + 1));
    }
    let xref = bytes.len();
    bytes.push_str(&format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len()));
    for offset in &offsets[1..] {
        bytes.push_str(&format!("{offset:010} 00000 n \n"));
    }
    bytes.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
        offsets.len()
    ));
    bytes
}

#[test]
fn malformed_pdf_is_not_metadata_or_a_successful_blank_image() {
    let valid = pdf(&[
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 24 32] >>",
        "<< /Type /Page /Parent 2 0 R >>",
    ]);
    let missing_catalog = pdf(&["<< /Type /Pages /Kids [] /Count 0 >>"]);
    let broken_content = pdf(&[
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 24 32] >>",
        "<< /Type /Page /Parent 2 0 R /Contents 999 0 R >>",
    ]);
    for bytes in [
        "%PDF-1.4\nnot a PDF document\n%%EOF\n",
        &valid[..valid.find("3 0 obj").unwrap() + 7],
        &missing_catalog,
        &broken_content,
    ] {
        for (command, args) in [
            ("pdfinfo", vec!["/input.pdf"]),
            (
                "pdftoppm",
                vec!["-png", "-scale-to", "800", "-f", "1", "-l", "1", "/input.pdf", "/page"],
            ),
            (
                "pdftocairo",
                vec!["-png", "-scale-to", "800", "-f", "1", "-l", "1", "/input.pdf", "/page"],
            ),
        ] {
            let fs = MemoryVfs::new();
            fs.write_file("/input.pdf", bytes.as_bytes()).unwrap();
            let args = args.into_iter().map(str::to_owned).collect::<Vec<_>>();
            let result =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            assert_ne!(
                result.exit_code, 0,
                "{command} accepted malformed PDF: {bytes}"
            );
            assert!(result.stdout.is_empty());
            assert!(!result.stderr.is_empty());
            assert!(!fs.exists("/page-1.png"));
            if command != "pdfinfo" {
                fs.write_file("/page-1.png", b"existing output").unwrap();
                let mut quiet = vec!["-q".to_owned()];
                quiet.extend(args.clone());
                let result =
                    try_run_archive_command(command, &quiet, "", "/", &Default::default(), &fs)
                        .unwrap();
                assert_ne!(result.exit_code, 0);
                assert!(result.stderr.is_empty());
                assert_eq!(fs.read_file("/page-1.png").unwrap(), b"existing output");
            }
            assert_eq!(fs.read_file("/input.pdf").unwrap(), bytes.as_bytes());
        }
    }
}

#[test]
fn valid_blank_and_vector_pages_still_render_after_xref_repair() {
    for content in ["", "1 0 0 rg 0 0 24 32 re f"] {
        let stream = format!(
            "<< /Length {} >>\nstream\n{content}\nendstream",
            content.len()
        );
        let valid = pdf(&[
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 24 32] >>",
            "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>",
            &stream,
        ]);
        let damaged_xref = format!(
            "{}startxref\n0\n%%EOF\n",
            valid.split("startxref").next().unwrap()
        );
        for bytes in [&valid, &damaged_xref] {
            let fs = MemoryVfs::new();
            fs.write_file("/input.pdf", bytes.as_bytes()).unwrap();
            let info = try_run_archive_command(
                "pdfinfo",
                &["/input.pdf".to_owned()],
                "",
                "/",
                &Default::default(),
                &fs,
            )
            .unwrap();
            assert_eq!(info.exit_code, 0, "{}", info.stderr);
            assert!(info.stdout.contains("24 x 32"));
            let args = ["-r", "72", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
            let result =
                try_run_archive_command("pdftoppm", &args, "", "/", &Default::default(), &fs)
                    .unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            let image = fs.read_file("/page.ppm").unwrap();
            let header = b"P6\n24 32\n255\n";
            assert!(image.starts_with(header));
            let pixels = &image[header.len()..];
            assert_eq!(pixels.len(), 24 * 32 * 3);
            let expected = if content.is_empty() {
                [255, 255, 255]
            } else {
                [255, 0, 0]
            };
            assert!(pixels.chunks_exact(3).all(|pixel| pixel == expected));
        }
    }
}

#[test]
fn legacy_documents_and_password_protected_pdfs_keep_their_supported_behavior() {
    let fs = MemoryVfs::new();
    let legacy = b"%PDF-1.4\n%%SAFE_PDF_V2%%\nSIZE:24:32\nPAGE:0:48656c6c6f:::\n%%EOF\n";
    fs.write_file("/legacy.pdf", legacy).unwrap();
    for (command, args) in [
        ("pdfinfo", vec!["/legacy.pdf"]),
        (
            "pdftoppm",
            vec!["-png", "-singlefile", "-r", "72", "/legacy.pdf", "/legacy"],
        ),
    ] {
        let args = args.into_iter().map(str::to_owned).collect::<Vec<_>>();
        let result =
            try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
    }
    // Existing revision-3 reference credentials for reader/owner; no encrypted
    // streams are needed to verify authentication on a genuinely blank page.
    let encrypted = pdf(&[
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 24 32] >>",
        "<< /Type /Page /Parent 2 0 R >>",
        "<< /Filter /Standard /V 2 /R 3 /Length 128 /P -1052 /U <94A57277391CA32F87E903F479F2A13A28BF4E5E4E758A4164004E56FFFA0108> /O <0CB58749C5346569E765906CAF64E4429A4C20D6E996FDEF963E9B5080F9E083> >>",
    ]).replace("/Root 1 0 R", "/Root 1 0 R /Encrypt 4 0 R /ID [<BC0F227BE410D486C2F262EF0840C151> <BC0F227BE410D486C2F262EF0840C151>]");
    fs.write_file("/encrypted.pdf", encrypted.as_bytes())
        .unwrap();
    for password in ["wrong", "reader", "owner"] {
        for command in ["pdfinfo", "pdftoppm", "pdftocairo"] {
            let mut args = vec!["-upw", password];
            if command != "pdfinfo" {
                args.extend(["-png", "-singlefile", "-r", "72"]);
            }
            args.push("/encrypted.pdf");
            if command != "pdfinfo" {
                args.push("/encrypted");
            }
            let args = args.into_iter().map(str::to_owned).collect::<Vec<_>>();
            let result =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            if password == "wrong" {
                assert_ne!(result.exit_code, 0);
                assert!(result.stderr.contains("password"));
                assert!(!fs.exists("/encrypted.png"));
            } else {
                assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
            }
        }
    }
}
