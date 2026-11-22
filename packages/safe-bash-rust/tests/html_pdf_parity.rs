use safe_bash_rust::{MemoryVfs, SafeBashFs, commands::archive::try_run_archive_command};

fn pdf(content: &str) -> Vec<u8> {
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>".to_owned(),
        format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned(),
    ];
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
    bytes.into_bytes()
}

#[test]
fn html_default_zoom_and_text_bounds_match_font_metrics() {
    let fs = MemoryVfs::new();
    fs.write_file(
        "/in.pdf",
        &pdf("BT /F1 12 Tf 10 36 Td (First) Tj 0 100 Td (Second) Tj ET"),
    )
    .unwrap();
    for (flags, page, first, second) in [
        (
            "",
            "height=\"1188\" width=\"918\"",
            "top=\"1121\" left=\"15\" width=\"35\" height=\"17\"",
            "top=\"971\" left=\"15\" width=\"61\" height=\"17\"",
        ),
        (
            "1",
            "height=\"792\" width=\"612\"",
            "top=\"747\" left=\"10\" width=\"23\" height=\"11\"",
            "top=\"647\" left=\"10\" width=\"41\" height=\"11\"",
        ),
    ] {
        let mut args = vec!["-xml", "-stdout"];
        if !flags.is_empty() {
            args.extend(["-zoom", flags]);
        }
        args.push("/in.pdf");
        let args = args.into_iter().map(str::to_owned).collect::<Vec<_>>();
        let out =
            try_run_archive_command("pdftohtml", &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(out.exit_code, 0, "{}", out.stderr);
        for expected in [page, first, second] {
            assert!(
                out.stdout.contains(expected),
                "missing {expected}: {}",
                out.stdout
            );
        }
    }
}

#[test]
fn hyphen_modes_preserve_hard_hyphens_selectively() {
    let fs = MemoryVfs::new();
    fs.write_file(
        "/in.pdf",
        &pdf("BT /F1 12 Tf 20 80 Td (hyphen-) Tj 0 -15 Td (ation) Tj ET"),
    )
    .unwrap();
    for mode in ["none", "soft", "all"] {
        let args = ["-remove-hyphens", mode, "/in.pdf", "-"].map(str::to_owned);
        let out =
            try_run_archive_command("pdftotext", &args, "", "/", &Default::default(), &fs).unwrap();
        let expected = if mode == "all" {
            "hyphenation\n\n\x0c"
        } else {
            "hyphen-\nation\n\n\x0c"
        };
        assert_eq!(
            (out.exit_code, out.stderr.as_str(), out.stdout.as_str()),
            (0, "", expected),
            "mode {mode}"
        );
    }
}

#[test]
fn invalid_hyphen_modes_honor_quiet_and_preserve_output() {
    let fs = MemoryVfs::new();
    fs.write_file("/out.txt", b"keep").unwrap();
    for mode in ["yes", "no", "auto", "invalid"] {
        for quiet in [false, true] {
            let mut args = vec!["-remove-hyphens", mode, "/missing.pdf", "/out.txt"];
            if quiet {
                args.push("-q");
            }
            let args = args.into_iter().map(str::to_owned).collect::<Vec<_>>();
            let out =
                try_run_archive_command("pdftotext", &args, "", "/", &Default::default(), &fs)
                    .unwrap();
            assert_eq!(
                (out.exit_code, out.stdout.as_str(), out.stderr.as_str()),
                (
                    99,
                    "",
                    if quiet {
                        ""
                    } else {
                        "Command Line Error: Invalid '-remove-hyphens' value\n"
                    }
                ),
                "{mode}, quiet={quiet}"
            );
            assert_eq!(fs.read_file("/out.txt").unwrap(), b"keep");
        }
        for info in ["-h", "-v", "-listenc"] {
            let args = ["-remove-hyphens", mode, info].map(str::to_owned);
            let out =
                try_run_archive_command("pdftotext", &args, "", "/", &Default::default(), &fs)
                    .unwrap();
            assert_eq!(out.exit_code, 0, "{mode} {info}: {}", out.stderr);
        }
    }
    let out = try_run_archive_command(
        "pdftotext",
        &["-remove-hyphens".into()],
        "",
        "/",
        &Default::default(),
        &fs,
    )
    .unwrap();
    assert_eq!(out.exit_code, 99);
    assert_eq!(
        out.stderr,
        "Command Line Error: Invalid '-remove-hyphens' value\n"
    );
}

#[test]
fn html_pdf_embeds_explicit_base14_widths_for_body_headings_and_code() {
    let fs = MemoryVfs::new();
    fs.write_file("/in.html", b"<h1>Heading</h1><p>Text</p><pre>Code</pre>")
        .unwrap();
    let args = ["/in.html", "/out.pdf"].map(str::to_owned);
    let out =
        try_run_archive_command("wkhtmltopdf", &args, "", "/", &Default::default(), &fs).unwrap();
    assert_eq!(out.exit_code, 0, "{}", out.stderr);
    let bytes = fs.read_file("/out.pdf").unwrap();
    let pdf = String::from_utf8_lossy(&bytes);
    for family in ["Helvetica", "Helvetica-Bold", "Courier"] {
        let marker = format!("/BaseFont /{family}\n");
        let font = pdf
            .split_once(&marker)
            .unwrap()
            .1
            .split_once("endobj")
            .unwrap()
            .0;
        assert!(
            font.contains("/FirstChar 32\n/LastChar 255\n/Widths [ "),
            "{family}: {font}"
        );
        let widths = font
            .split_once("/Widths [ ")
            .unwrap()
            .1
            .split_once(']')
            .unwrap()
            .0
            .split_whitespace()
            .map(|v| v.parse::<u16>().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(widths.len(), 224, "{family}");
        assert_eq!(widths[0], if family == "Courier" { 600 } else { 278 });
        if family == "Courier" {
            assert!(widths.iter().all(|&width| width == 600));
        }
    }
}

#[test]
fn html_flow_mode_and_single_document_layout_are_distinct() {
    let fs = MemoryVfs::new();
    fs.write_file("/in.pdf", &pdf("BT /F1 12 Tf 10 36 Td (First) Tj ET"))
        .unwrap();
    for (flags, expected) in [
        (
            vec!["-stdout", "/in.pdf"],
            "<a id=\"page1\"></a>\nFirst<br/>\n<hr/>",
        ),
        (
            vec!["-s", "-stdout", "/in.pdf"],
            "<div class=\"page\" id=\"page1\" style=\"position:relative;width:918pt;height:1188pt;\">\n  <p style=\"position:absolute;top:1121pt;left:15pt;margin:0;\">First</p>\n</div>",
        ),
    ] {
        let args = flags.into_iter().map(str::to_owned).collect::<Vec<_>>();
        let out =
            try_run_archive_command("pdftohtml", &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(out.exit_code, 0, "{}", out.stderr);
        assert!(out.stdout.contains(expected), "{}", out.stdout);
    }
}

#[test]
fn xml_font_names_strip_style_unless_full_names_are_requested() {
    let fs = MemoryVfs::new();
    fs.write_file("/in.html", b"<h1>Heading</h1>").unwrap();
    let args = ["/in.html", "/in.pdf"].map(str::to_owned);
    let out =
        try_run_archive_command("wkhtmltopdf", &args, "", "/", &Default::default(), &fs).unwrap();
    assert_eq!(out.exit_code, 0, "{}", out.stderr);
    for (full, family) in [(false, "Helvetica"), (true, "Helvetica-Bold")] {
        let mut args = vec!["-xml", "-stdout", "/in.pdf"];
        if full {
            args.push("-fontfullname");
        }
        let args = args.into_iter().map(str::to_owned).collect::<Vec<_>>();
        let out =
            try_run_archive_command("pdftohtml", &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(out.exit_code, 0, "{}", out.stderr);
        assert!(
            out.stdout
                .contains(&format!("size=\"30\" family=\"{family}\"")),
            "{}",
            out.stdout
        );
    }
}
