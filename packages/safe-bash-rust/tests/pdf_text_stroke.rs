use safe_bash_rust::{MemoryVfs, SafeBashFs, commands::archive::try_run_archive_command};

fn pdf(stream: &str) -> Vec<u8> {
    let contents = format!(
        "<< /Length {} >>\nstream\n{stream}\nendstream",
        stream.len()
    );
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        &contents,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let mut out = String::from("%PDF-1.4\n");
    let mut offsets = vec![0];
    for (i, object) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.push_str(&format!("{} 0 obj\n{object}\nendobj\n", i + 1));
    }
    let xref = out.len();
    out.push_str("xref\n0 6\n0000000000 65535 f \n");
    for offset in &offsets[1..] {
        out.push_str(&format!("{offset:010} 00000 n \n"));
    }
    out.push_str(&format!(
        "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    ));
    out.into_bytes()
}

fn render(command: &str, stream: &str) -> Vec<u8> {
    let fs = MemoryVfs::new();
    fs.write_file("/input.pdf", &pdf(stream)).unwrap();
    let args = ["-png", "-r", "72", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
    let result =
        try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let args = ["/page.png", "/page.ppm"].map(str::to_owned);
    let result =
        try_run_archive_command("convert", &args, "", "/", &Default::default(), &fs).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let ppm = fs.read_file("/page.ppm").unwrap();
    ppm[ppm.len() - 100 * 100 * 3..].to_vec()
}

#[test]
fn text_stroke_modes_colors_and_transforms() {
    for command in ["pdftoppm", "pdftocairo"] {
        for matrix in [
            "1 0 0 1 0 0 cm",
            "1 .2 .3 1 0 0 cm",
            "0 1 -1 0 100 0 cm",
            "-1 0 0 1 100 0 cm",
        ] {
            for mode in 0..8 {
                let pixels = render(
                    command,
                    &format!(
                        "{matrix} 1 0 0 rg 0 0 1 RG 1 w BT /F1 60 Tf {mode} Tr 10 20 Td (A) Tj ET"
                    ),
                );
                let red = pixels
                    .as_chunks::<3>()
                    .0
                    .iter()
                    .filter(|p| p[0] > 180 && p[1] < 100 && p[2] < 100)
                    .count();
                let blue = pixels
                    .as_chunks::<3>()
                    .0
                    .iter()
                    .filter(|p| p[0] < 150 && p[1] < 150 && p[2] > 180)
                    .count();
                assert_eq!(
                    red > 100,
                    matches!(mode, 0 | 2 | 4 | 6),
                    "{command} mode {mode} red={red} {matrix}"
                );
                assert_eq!(
                    blue > 100,
                    matches!(mode, 1 | 2 | 5 | 6),
                    "{command} mode {mode} blue={blue} {matrix}"
                );
                if matches!(mode, 3 | 7) {
                    assert!(pixels.iter().all(|&v| v == 255));
                }
            }
        }
    }
}

#[test]
fn text_stroke_width_dash_and_graphics_state() {
    for command in ["pdftoppm", "pdftocairo"] {
        let text = "BT /F1 60 Tf 1 Tr 10 20 Td (A) Tj ET";
        let thin = render(command, &format!("0 0 1 RG 1 w {text}"));
        let wide = render(command, &format!("0 0 1 RG 3 w {text}"));
        let dashed = render(command, &format!("0 0 1 RG 3 w [3 3] 1 d {text}"));
        let count = |pixels: &[u8]| {
            pixels
                .as_chunks::<3>()
                .0
                .iter()
                .filter(|p| p[0] < 180)
                .count()
        };
        assert!(count(&wide) > count(&thin) * 2);
        assert!(count(&dashed) < count(&wide) * 3 / 4);
        assert_eq!(
            thin,
            render(
                command,
                &format!("0 0 1 RG 1 w q 1 0 0 RG 9 w [3 3] 1 d 1 j 1 J Q {text}")
            )
        );
        // Font scaling changes the contour, not the user-space stroke width.
        assert_eq!(
            wide,
            render(
                command,
                "0 0 1 RG 3 w BT /F1 30 Tf 1 Tr 2 0 0 2 10 20 Tm (A) Tj ET"
            )
        );
    }
}

#[test]
fn text_stroke_geometry_failure_preserves_output() {
    let input = pdf("[.000000001 .000000001] 0 d BT /F1 60 Tf 1 Tr 10 20 Td (A) Tj ET");
    for command in ["pdftoppm", "pdftocairo"] {
        for existing in [false, true] {
            let fs = MemoryVfs::new();
            fs.write_file("/input.pdf", &input).unwrap();
            if existing {
                fs.write_file("/page.png", b"existing").unwrap();
            }
            let args =
                ["-png", "-r", "72", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
            let result =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            assert_ne!(result.exit_code, 0);
            if existing {
                assert_eq!(fs.read_file("/page.png").unwrap(), b"existing");
            } else {
                assert!(fs.read_file("/page.png").is_err());
            }
        }
    }
}
