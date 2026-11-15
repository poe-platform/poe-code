use safe_bash_rust::{MemoryVfs, SafeBashFs, commands::archive::try_run_archive_command};
fn check(controls: bool) {
    let pdf = include_bytes!("fixtures/pdf-button-icons.pdf");
    let mut failures = Vec::new();
    for command in ["pdftoppm", "pdftocairo"] {
        let fs = MemoryVfs::new();
        fs.write_file("/input.pdf", pdf).unwrap();
        let args = ["-png", "-r", "144", "/input.pdf", "/page"].map(String::from);
        let result =
            try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        for page in 1..=25 {
            let control = [1, 21, 22, 23, 24].contains(&page);
            if control != controls {
                continue;
            }
            let args = [format!("/page-{page:02}.png"), "/pixels.ppm".into()];
            let result =
                try_run_archive_command("convert", &args, "", "/", &Default::default(), &fs)
                    .unwrap();
            assert_eq!(result.exit_code, 0);
            let ppm = fs.read_file("/pixels.ppm").unwrap();
            let pixels = ppm.strip_prefix(b"P6\n400 200\n255\n").unwrap();
            let red = pixels.chunks_exact(3).filter(|v| *v == [255, 0, 0]).count();
            let blue = pixels.chunks_exact(3).filter(|v| *v == [0, 0, 255]).count();
            let magenta = pixels
                .chunks_exact(3)
                .filter(|v| *v == [255, 0, 255])
                .count();
            let ok = match page {
                1 => red + blue == 0,
                21 => magenta > 1000 && red + blue == 0,
                22..=24 => pixels.iter().all(|v| *v == 255),
                16 => red > 1000,
                _ => red > 1000 && blue > 1000,
            };
            let expected = match page {
                2 | 14 | 15 | 18 | 20 | 25 => Some(12544),
                3 | 4 => Some(7056),
                9 | 11 | 12 | 17 => Some(1600),
                13 => Some(19200),
                _ => None,
            };
            if let Some(expected) = expected {
                assert_eq!(red, expected, "{command} page {page}");
            }
            let at = |x: usize, y: usize| &pixels[(y * 400 + x) * 3..][..3];
            match page {
                11 => assert_eq!(at(44, 154), [255, 0, 0]),
                12 => assert_eq!(at(354, 44), [0, 0, 255]),
                19 => {
                    assert_eq!(at(180, 140), [255, 0, 0]);
                    assert_eq!(at(180, 60), [0, 0, 255]);
                }
                _ => {}
            }
            if !ok {
                failures.push(format!(
                    "{command} page {page}: red={red} blue={blue} magenta={magenta}"
                ));
            }
        }
        assert_eq!(fs.read_file("/input.pdf").unwrap(), pdf);
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
#[test]
fn normal_icons_are_preserved() {
    check(false);
}
#[test]
fn invalid_later_icons_preserve_all_outputs() {
    for pdf in [
        include_bytes!("fixtures/pdf-icons-bad-bbox.pdf").as_slice(),
        include_bytes!("fixtures/pdf-icons-recursive.pdf").as_slice(),
    ] {
        for command in ["pdftoppm", "pdftocairo"] {
            for existing in [false, true] {
                let fs = MemoryVfs::new();
                fs.write_file("/input.pdf", pdf).unwrap();
                if existing {
                    for page in 1..=2 {
                        fs.write_file(&format!("/page-{page}.png"), b"KEEP")
                            .unwrap();
                    }
                }
                let args = ["-png", "-r", "144", "/input.pdf", "/page"].map(String::from);
                let result =
                    try_run_archive_command(command, &args, "", "/", &Default::default(), &fs)
                        .unwrap();
                assert_ne!(result.exit_code, 0, "{command} accepted invalid icon");
                for page in 1..=2 {
                    let output = fs.read_file(&format!("/page-{page}.png"));
                    if existing {
                        assert_eq!(output.unwrap(), b"KEEP", "{command} page {page}");
                    } else {
                        assert!(output.is_err(), "{command} published page {page}");
                    }
                }
                assert_eq!(fs.read_file("/input.pdf").unwrap(), pdf);
            }
        }
    }
}
#[test]
fn caption_appearance_and_hidden_controls() {
    check(true);
}

fn icon_pdf(mk: &str, geometry: &str, content: &str, child: &str, rect: &str) -> Vec<u8> {
    use std::fmt::Write;
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".into(),
        "<< /Type /Pages /Count 1 /Kids [3 0 R] >>".into(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Annots [4 0 R] >>"
            .into(),
        format!(
            "<< /Subtype /Widget /FT /Btn /Ff 65536 /Rect [{rect}] /MK << /I 5 0 R /TP 1 /IF << /SW /N >> {mk} >> >>"
        ),
        format!(
            "<< /Subtype /Form /BBox [0 0 40 20] {geometry} /Length {} >>\nstream\n{content}\nendstream",
            content.len()
        ),
        child.into(),
    ];
    let mut pdf = String::from("%PDF-1.7\n");
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
fn pixels(fs: &MemoryVfs, file: &str) -> Vec<u8> {
    let result = try_run_archive_command(
        "convert",
        &[file.into(), "/pixels.ppm".into()],
        "",
        "/",
        &Default::default(),
        fs,
    )
    .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    fs.read_file("/pixels.ppm")
        .unwrap()
        .strip_prefix(b"P6\n400 200\n255\n")
        .unwrap()
        .to_vec()
}
#[test]
fn icon_geometry_and_standard_alignment() {
    let paint = "1 0 0 rg 0 0 40 20 re f 0 0 1 rg 20 0 20 20 re f";
    let child = format!(
        "<< /Subtype /Form /BBox [0 0 40 20] /Length {} >>\nstream\n{paint}\nendstream",
        paint.len()
    );
    for command in ["pdftoppm", "pdftocairo"] {
        for (geometry, content, rect, red) in [
            ("", paint, "20 20 180 80", 1600),
            (
                "/Resources << /XObject << /Child 6 0 R >> >>",
                "/Child Do",
                "20 20 180 80",
                1600,
            ),
            ("", paint, "20 20 20 80", 0),
            ("", paint, "20 20 20.001 20.001", 0),
            ("/BBox [0 0 0 20]", paint, "20 20 180 80", 0),
        ] {
            let fs = MemoryVfs::new();
            let pdf = icon_pdf("", geometry, content, &child, rect);
            fs.write_file("/input.pdf", &pdf).unwrap();
            let args = ["-png", "-r", "144", "/input.pdf", "/page"].map(String::from);
            let result =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            let p = pixels(&fs, "/page-1.png");
            assert_eq!(p.chunks_exact(3).filter(|v| *v == [255, 0, 0]).count(), red);
            if red > 0 {
                assert_eq!(&p[(80 * 400 + 160) * 3..][..3], &[255, 0, 0]);
            }
            assert_eq!(fs.read_file("/input.pdf").unwrap(), pdf);
        }
        let fs = MemoryVfs::new();
        fs.write_file("/input.pdf", include_bytes!("fixtures/pdf-icon-forms.pdf"))
            .unwrap();
        let result = try_run_archive_command(
            command,
            &["-png", "-r", "144", "/input.pdf", "/page"].map(String::from),
            "",
            "/",
            &Default::default(),
            &fs,
        )
        .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        for i in 1..=3 {
            let p = pixels(&fs, &format!("/page-{i}.png"));
            for color in [[255, 0, 0], [0, 0, 255]] {
                assert_eq!(p.chunks_exact(3).filter(|v| *v == color).count(), 6400);
            }
        }
    }
}
#[test]
fn invalid_cyclic_and_oversized_icons_preserve_outputs() {
    let cases = [
        ("/TP 7", "", "", "null"),
        ("/TP 1.5", "", "", "null"),
        ("/TP (1)", "", "", "null"),
        ("/I 1", "", "", "null"),
        ("/IF (bad)", "", "", "null"),
        ("/IF << /SW /bad >>", "", "", "null"),
        ("/IF << /S 1 >>", "", "", "null"),
        ("/IF << /FB 1 >>", "", "", "null"),
        ("/IF << /A [0] >>", "", "", "null"),
        ("/IF << /A [-1 0] >>", "", "", "null"),
        ("/IF << /A (bad) >>", "", "", "null"),
        ("", "/BBox [0 0 40]", "", "null"),
        ("", "/BBox (bad)", "", "null"),
        ("", "/Matrix [1 0 0 1 0]", "", "null"),
        ("", "/Matrix (bad)", "", "null"),
        ("", "/Subtype /Image", "", "null"),
        ("", "/Resources (bad)", "", "null"),
        (
            "",
            "/Resources << /XObject << /Self 5 0 R >> >>",
            "/Self Do",
            "null",
        ),
        (
            "",
            "/Resources << /XObject << /Image 6 0 R >> >>",
            "/Image Do",
            "<< /Subtype /Image /Width 1000000000 /Height 1000000000 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Length 0 >>\nstream\n\nendstream",
        ),
    ];
    for command in ["pdftoppm", "pdftocairo"] {
        for (mk, geometry, content, child) in cases {
            let pdf = icon_pdf(mk, geometry, content, child, "20 20 180 80");
            let fs = MemoryVfs::new();
            fs.write_file("/input.pdf", &pdf).unwrap();
            fs.write_file("/out-1.png", b"sentinel").unwrap();
            let args = ["-png", "-r", "72", "/input.pdf", "/out"].map(String::from);
            let result =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            assert_ne!(result.exit_code, 0, "accepted {mk} {geometry}");
            assert_eq!(fs.read_file("/out-1.png").unwrap(), b"sentinel");
            assert_eq!(fs.read_file("/input.pdf").unwrap(), pdf);
        }
    }
}

#[test]
fn aggregate_raster_limit_preserves_all_outputs() {
    use safe_bash_rust::{BackendMode, Shell, ShellLimits, ShellOptions};
    use std::sync::Arc;
    for command in ["pdftoppm", "pdftocairo"] {
        let fs = MemoryVfs::new();
        fs.write_file(
            "/input.pdf",
            include_bytes!("fixtures/pdf-button-icons.pdf"),
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
        let invocation = format!("{command} -png -r 72 -f 1 -l 2 /input.pdf /page");
        let result = shell.exec(&invocation).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let total = fs.read_file("/page-01.png").unwrap().len()
            + fs.read_file("/page-02.png").unwrap().len();
        for page in 1..=2 {
            fs.write_file(&format!("/page-{page:02}.png"), b"KEEP")
                .unwrap();
        }
        shell.set_limits(ShellLimits {
            max_output_bytes: total - 1,
            ..Default::default()
        });
        let result = shell.exec(&invocation).unwrap();
        assert_ne!(result.exit_code, 0);
        for page in 1..=2 {
            assert_eq!(
                fs.read_file(&format!("/page-{page:02}.png")).unwrap(),
                b"KEEP"
            );
        }
    }
}

#[test]
fn legacy_icons_inherit_page_resources_and_allow_form_overrides() {
    for pdf in [
        include_bytes!("fixtures/pdf-icon-resources-page.pdf").as_slice(),
        include_bytes!("fixtures/pdf-icon-resources-tree.pdf").as_slice(),
        include_bytes!("fixtures/pdf-icon-resources-override.pdf").as_slice(),
    ] {
        for command in ["pdftoppm", "pdftocairo"] {
            let fs = MemoryVfs::new();
            fs.write_file("/input.pdf", pdf).unwrap();
            let args = ["-png", "-r", "144", "/input.pdf", "/page"].map(String::from);
            let result = try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            let p = pixels(&fs, "/page-1.png");
            for color in [[255, 0, 0], [0, 0, 255]] {
                assert_eq!(p.chunks_exact(3).filter(|v| *v == color).count(), 1600, "{command}");
            }
            assert_eq!(fs.read_file("/input.pdf").unwrap(), pdf);
        }
    }
}
