use safe_bash_rust::{MemoryVfs, SafeBashFs, commands::archive::try_run_archive_command};
use std::fmt::Write;

fn pdf(w: f64, h: f64, rotation: u16, origin: (f64, f64), paint: &str) -> Vec<u8> {
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".into(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into(),
        format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [{} {} {} {}] /Rotate {rotation} /Resources << >> /Contents 4 0 R >>",
            origin.0,
            origin.1,
            origin.0 + w,
            origin.1 + h
        ),
        format!("<< /Length {} >>\nstream\n{paint}\nendstream", paint.len()),
    ];
    let mut pdf = "%PDF-1.4\n".to_string();
    let mut offsets = vec![0];
    for (i, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        writeln!(pdf, "{} 0 obj\n{object}\nendobj", i + 1).unwrap();
    }
    let xref = pdf.len();
    writeln!(pdf, "xref\n0 5\n0000000000 65535 f ").unwrap();
    for offset in &offsets[1..] {
        writeln!(pdf, "{offset:010} 00000 n ").unwrap();
    }
    write!(
        pdf,
        "trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    )
    .unwrap();
    pdf.into_bytes()
}

#[test]
fn pdftk_and_qpdf_keep_distinct_stamp_geometry() {
    for (w, h, rotation, shifted, pdftk, qpdf) in [
        (100., 100., 0, false, "2 0 0 2 0 50", "1 0 0 1 50 100"),
        (400., 400., 0, false, "0.5 0 0 0.5 0 50", "0.5 0 0 0.5 0 50"),
        (200., 300., 0, false, "", "1 0 0 1 0 0"),
        (100., 100., 90, false, "0 2 -2 0 200 50", "0 1 -1 0 150 100"),
        (
            100.,
            100.,
            180,
            false,
            "-2 0 0 -2 200 250",
            "-1 0 0 -1 150 200",
        ),
        (100., 100., 270, false, "0 -2 2 0 0 250", "0 -1 1 0 50 200"),
        (100., 100., 0, true, "2 0 0 2 0 50", "1 0 0 1 40 100"),
    ] {
        for command in ["pdftk", "qpdf"] {
            for underlay in [false, true] {
                let fs = MemoryVfs::new();
                fs.write_file(
                    "/in.pdf",
                    &pdf(
                        200.,
                        300.,
                        rotation,
                        if shifted { (10., 20.) } else { (0., 0.) },
                        "",
                    ),
                )
                .unwrap();
                fs.write_file(
                    "/stamp.pdf",
                    &pdf(
                        w,
                        h,
                        0,
                        if shifted { (20., 20.) } else { (0., 0.) },
                        "1 0 0 rg 30 40 20 30 re f",
                    ),
                )
                .unwrap();
                let args = if command == "pdftk" {
                    vec![
                        "/in.pdf",
                        if underlay { "background" } else { "stamp" },
                        "/stamp.pdf",
                        "output",
                        "/out.pdf",
                        "uncompress",
                    ]
                } else {
                    vec![
                        "/in.pdf",
                        "/out.pdf",
                        if underlay { "--underlay" } else { "--overlay" },
                        "/stamp.pdf",
                        "--",
                        "--stream-data=uncompress",
                    ]
                }
                .into_iter()
                .map(String::from)
                .collect::<Vec<_>>();
                let out =
                    try_run_archive_command(command, &args, "", "/", &Default::default(), &fs)
                        .unwrap();
                assert_eq!(out.exit_code, 0, "{command}: {}", out.stderr);
                // Pixel bounds qualified with native PDFtk/qpdf at 72 DPI. The
                // shifted PDFtk case retains the existing SDK's size-only contract.
                let args =
                    ["-png", "-r", "72", "-singlefile", "/out.pdf", "/page"].map(String::from);
                let rendered =
                    try_run_archive_command("pdftoppm", &args, "", "/", &Default::default(), &fs)
                        .unwrap();
                assert_eq!(rendered.exit_code, 0, "{}", rendered.stderr);
                let args = ["/page.png", "/page.ppm"].map(String::from);
                let converted =
                    try_run_archive_command("convert", &args, "", "/", &Default::default(), &fs)
                        .unwrap();
                assert_eq!(converted.exit_code, 0, "{}", converted.stderr);
                let ppm = fs.read_file("/page.ppm").unwrap();
                let (pw, ph) = if rotation == 90 || rotation == 270 {
                    (300, 200)
                } else {
                    (200, 300)
                };
                let header = format!("P6\n{pw} {ph}\n255\n");
                let pixels = ppm.strip_prefix(header.as_bytes()).unwrap();
                let mut bounds = (pw, ph, 0, 0);
                for (i, pixel) in pixels.chunks_exact(3).enumerate() {
                    if pixel[1] < 128 && pixel[0] > 200 {
                        bounds.0 = bounds.0.min(i % pw);
                        bounds.1 = bounds.1.min(i / pw);
                        bounds.2 = bounds.2.max(i % pw);
                        bounds.3 = bounds.3.max(i / pw);
                    }
                }
                let expected = if shifted {
                    if command == "pdftk" {
                        (50, 130, 89, 189)
                    } else {
                        (60, 150, 79, 179)
                    }
                } else if w == 400. {
                    (15, 215, 24, 229)
                } else if w == 200. {
                    (30, 230, 49, 259)
                } else if rotation == 90 || rotation == 270 {
                    if command == "pdftk" {
                        (110, 60, 149, 119)
                    } else {
                        (130, 80, 149, 109)
                    }
                } else if command == "pdftk" {
                    (60, 110, 99, 169)
                } else {
                    (80, 130, 99, 159)
                };
                assert_eq!(
                    bounds, expected,
                    "{command} {w}x{h} rotation {rotation} shifted {shifted}"
                );
                let bytes = fs.read_file("/out.pdf").unwrap();
                let text = String::from_utf8_lossy(&bytes);
                let matrix = if command == "pdftk" { pdftk } else { qpdf };
                if matrix.is_empty() {
                    assert!(!text.contains(" cm"), "{text}");
                } else {
                    assert!(
                        text.contains(&format!("{matrix} cm")),
                        "{command} {w}x{h} rotation {rotation} shifted {shifted}: {text}"
                    );
                }
            }
        }
    }
}
