use safe_bash_rust::{MemoryVfs, SafeBashFs, commands::archive::try_run_archive_command};
// PDFium controls except /CA null: MuPDF confirms default opacity one.
// The supplied-appearance control uses explicit /CA 1 on that page.
const PDF: &[u8] = include_bytes!("fixtures/pdf-markup.pdf");
const CONTROL: &[u8] = include_bytes!("fixtures/pdf-markup-appearances.pdf");

fn render(command: &str, pdf: &[u8], hide: bool) -> Vec<Vec<u8>> {
    let fs = MemoryVfs::new();
    fs.write_file("/input.pdf", pdf).unwrap();
    let mut args = ["-png", "-r", "72", "/input.pdf", "/page"]
        .map(String::from)
        .to_vec();
    if hide {
        args.insert(0, "-hide-annotations".into());
    }
    let result =
        try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
    assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
    let mut files = fs
        .list_dir("/")
        .unwrap()
        .into_iter()
        .filter_map(|name| {
            let n = name
                .strip_prefix("page-")?
                .strip_suffix(".png")?
                .parse::<usize>()
                .ok()?;
            Some((n, name))
        })
        .collect::<Vec<_>>();
    files.sort_by_key(|(n, _)| *n);
    assert_eq!(files.len(), 32);
    let pages = files
        .into_iter()
        .map(|(_, name)| {
            let args = [format!("/{name}"), "/decoded.ppm".into()];
            let result =
                try_run_archive_command("convert", &args, "", "/", &Default::default(), &fs)
                    .unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            fs.read_file("/decoded.ppm")
                .unwrap()
                .strip_prefix(b"P6\n100 100\n255\n")
                .unwrap()
                .to_vec()
        })
        .collect();
    assert_eq!(fs.read_file("/input.pdf").unwrap(), pdf);
    pages
}

#[test]
fn missing_appearance_markup_matches_independent_renderer_controls() {
    for command in ["pdftoppm", "pdftocairo"] {
        let pages = render(command, PDF, false);
        for row in include_str!("fixtures/pdf-markup.samples").lines() {
            let n = row
                .split_whitespace()
                .map(|s| s.parse::<usize>().unwrap())
                .collect::<Vec<_>>();
            let at = (n[2] * 100 + n[1]) * 3;
            for c in 0..3 {
                assert!(
                    (pages[n[0] - 1][at + c] as i32 - n[3 + c] as i32).abs() <= 2,
                    "{command}: reference {row}; actual {:?}",
                    &pages[n[0] - 1][at..at + 3]
                );
            }
        }
        // PDFium's generated streams, with Rect normalized to their BBox to
        // remove private placement rules, paint exactly the original artwork.
        // Comparing in one rasterizer also covers thin and antialiased edges.
        let controls = render(command, CONTROL, false);
        for (page, (actual, expected)) in pages.iter().zip(&controls).enumerate() {
            let worst = actual
                .iter()
                .zip(expected)
                .map(|(&a, &b)| a.abs_diff(b))
                .max()
                .unwrap();
            assert!(
                worst <= 2,
                "{command}: page {} maximum error {worst} against PDFium appearance streams",
                page + 1
            );
        }
        let hidden = render(command, PDF, true);
        let hidden_controls = render(command, CONTROL, true);
        for (i, page) in hidden.iter().enumerate() {
            if i == 28 {
                assert!(page.iter().all(|v| *v == 255));
            } else if i == 26 || i == 27 {
                // The blue page rectangle rotates with the page, independently
                // of annotation hiding; it remains identical in both inputs.
                assert_eq!(page, &hidden_controls[i]);
            } else {
                assert_eq!(page, &pages[12]);
            }
        }
    }
}

fn annotation_pdf(annotation: &str) -> Vec<u8> {
    use std::fmt::Write;
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
        "<< /Type /Pages /Count 1 /Kids [3 0 R] >>".to_owned(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Annots [4 0 R] >>"
            .to_owned(),
        format!("<< /Type /Annot /Rect [0 0 100 100] {annotation} >>"),
    ];
    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = vec![0];
    for (i, obj) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        writeln!(pdf, "{} 0 obj\n{obj}\nendobj", i + 1).unwrap();
    }
    let xref = pdf.len();
    writeln!(pdf, "xref\n0 {}\n0000000000 65535 f ", offsets.len()).unwrap();
    for off in &offsets[1..] {
        writeln!(pdf, "{off:010} 00000 n ").unwrap();
    }
    write!(
        pdf,
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
        offsets.len()
    )
    .unwrap();
    pdf.into_bytes()
}

#[test]
fn invalid_or_excessive_markup_fails_before_output_but_can_be_hidden() {
    let cases = [
        "/Subtype /Highlight /QuadPoints [1 2 3]".into(),
        "/Subtype /Ink /InkList [[1 2 3]]".into(),
        "/Subtype /Square /C [1 2]".into(),
        "/Subtype /Square /CA /invalid".into(),
        "/Subtype /Squiggly /QuadPoints [0 10 1000000000 10 0 0 1000000000 0]".into(),
        format!("/Subtype /Ink /InkList [[{}]]", "1 ".repeat(65536)),
    ];
    for command in ["pdftoppm", "pdftocairo"] {
        for annotation in &cases {
            let source = annotation_pdf(annotation);
            let fs = MemoryVfs::new();
            fs.write_file("/in.pdf", &source).unwrap();
            let args = ["-png", "-r", "72", "/in.pdf", "/out"].map(String::from);
            let result =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            assert_ne!(
                result.exit_code,
                0,
                "{command} accepted {}",
                &annotation[..annotation.len().min(80)]
            );
            assert_eq!(fs.read_file("/in.pdf").unwrap(), source);
            assert!(
                !fs.list_dir("/")
                    .unwrap()
                    .iter()
                    .any(|name| name.starts_with("out"))
            );
            let args = [vec!["-hide-annotations".into()], args.to_vec()].concat();
            assert_eq!(
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs)
                    .unwrap()
                    .exit_code,
                0
            );
        }
    }
}
