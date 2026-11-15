use safe_bash_rust::{MemoryVfs, SafeBashFs, commands::archive::try_run_archive_command};

#[test]
fn filled_text_and_choice_widgets_render_without_supplied_appearances() {
    let pdf = include_bytes!("fixtures/pdf-widgets.pdf");
    for command in ["pdftoppm", "pdftocairo"] {
        let fs = MemoryVfs::new();
        fs.write_file("/input.pdf", pdf).unwrap();
        let args = ["-png", "-r", "144", "/input.pdf", "/page"].map(String::from);
        let result =
            try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        for i in 1..=6 {
            let args = [format!("/page-{i}.png"), "/decoded.ppm".into()];
            let result =
                try_run_archive_command("convert", &args, "", "/", &Default::default(), &fs)
                    .unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            let ppm = fs.read_file("/decoded.ppm").unwrap();
            let pixels = ppm.strip_prefix(b"P6\n400 200\n255\n").unwrap();
            if i == 6 {
                assert!(pixels.iter().all(|p| *p == 255));
                continue;
            }
            for (c, expected) in [229i32, 242, 255].into_iter().enumerate() {
                let actual = pixels[(145 * 400 + 250) * 3 + c] as i32;
                assert!(
                    (actual - expected).abs() <= 2,
                    "{command}: page {i} background channel {c}: {actual}"
                );
            }
            assert!(
                (44..156).any(|y| (44..356)
                    .any(|x| pixels[(y * 400 + x) * 3..][..3].iter().all(|v| *v < 100))),
                "{command}: page {i} field text"
            );
        }
        assert_eq!(fs.read_file("/input.pdf").unwrap(), pdf);
    }
}

#[test]
fn widget_layout_and_field_settings() {
    let fs = MemoryVfs::new();
    let pdf = include_bytes!("fixtures/pdf-widgets-extended.pdf");
    fs.write_file("/input.pdf", pdf).unwrap();
    for command in ["pdftoppm", "pdftocairo"] {
        let args = ["-png", "-r", "144", "/input.pdf", "/page"].map(String::from);
        let result =
            try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(
            fs.read_file("/page-02.png").unwrap(),
            fs.read_file("/page-03.png").unwrap(),
            "password masking"
        );
        let pixels = |i: usize| {
            let args = [format!("/page-{i:02}.png"), "/decoded.ppm".into()];
            let result =
                try_run_archive_command("convert", &args, "", "/", &Default::default(), &fs)
                    .unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            fs.read_file("/decoded.ppm")
                .unwrap()
                .strip_prefix(b"P6\n400 200\n255\n")
                .unwrap()
                .to_vec()
        };
        assert!(pixels(5).iter().all(|v| *v == 255), "NoView");
        let supplied = pixels(7);
        assert_eq!(
            &supplied[(100 * 400 + 200) * 3..][..3],
            &[0, 255, 0],
            "supplied appearance"
        );
        let choice = pixels(8);
        assert!(
            (88..112)
                .any(|y| (80..110)
                    .any(|x| choice[(y * 400 + x) * 3..][..3].iter().all(|v| *v < 100))),
            "display label extends beyond single export code"
        );
        let list = pixels(10);
        for y in [60, 118] {
            assert_eq!(
                &list[(y * 400 + 300) * 3..][..3],
                &[0, 51, 113],
                "selected list rows"
            );
        }
        assert!(list[(88 * 400 + 300) * 3] > 220, "unselected list row");
        for i in [11, 19, 20] {
            assert!(
                pixels(i)[(60 * 400 + 80) * 3] < 100,
                "comb divider page {i}"
            );
        }
        let rotated = pixels(18);
        assert!(
            (50..150)
                .any(|y| (190..210)
                    .any(|x| rotated[(y * 400 + x) * 3..][..3].iter().all(|v| *v < 100))),
            "vertical field text"
        );
        assert!(pixels(17)[(40 * 400 + 50) * 3] > 220, "legacy dash gap");
        assert_eq!(fs.read_file("/input.pdf").unwrap(), pdf);
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
fn invalid_widgets_fail_before_replacing_output_and_can_be_hidden() {
    let cases = [
        "/Rect [1 2 3]".to_owned(),
        "/MK << /BG [1 2] >>".into(),
        "/Ff 16777216 /MaxLen 65537".into(),
        format!("/V ({})", "x".repeat(65537)),
        "/MK << /BC [0] >> /BS << /S /D /D [-1] >>".into(),
        "/Parent 4 0 R".into(),
    ];
    for command in ["pdftoppm", "pdftocairo"] {
        for extra in &cases {
            let source = annotation_pdf(&format!("/Subtype /Widget /FT /Tx {extra}"));
            let fs = MemoryVfs::new();
            fs.write_file("/in.pdf", &source).unwrap();
            fs.write_file("/out-1.png", b"sentinel").unwrap();
            let args = ["-png", "-r", "72", "/in.pdf", "/out"].map(String::from);
            let result =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            assert_ne!(
                result.exit_code,
                0,
                "accepted {}",
                &extra[..extra.len().min(80)]
            );
            assert_eq!(fs.read_file("/out-1.png").unwrap(), b"sentinel");
            assert_eq!(fs.read_file("/in.pdf").unwrap(), source);
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

#[test]
fn name_valued_text_fields_keep_their_visible_value() {
    let fs = MemoryVfs::new();
    for (name, value) in [("name", "/RESEARCH"), ("string", "(RESEARCH)")] {
        let pdf = annotation_pdf(&format!("/Subtype /Widget /FT /Tx /V {value}"));
        fs.write_file("/input.pdf", &pdf).unwrap();
        let args = ["-png", "-r", "72", "/input.pdf", name].map(String::from);
        let result =
            try_run_archive_command("pdftocairo", &args, "", "/", &Default::default(), &fs)
                .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
    }
    assert_eq!(
        fs.read_file("/name-1.png").unwrap(),
        fs.read_file("/string-1.png").unwrap()
    );
}

#[test]
fn malformed_buttons_preserve_existing_outputs() {
    let cases = [
        "/Rect [1 2 3]".to_owned(),
        "/MK << /BG [1 2] >>".into(),
        "/MK << /R 13 >>".into(),
        "/MK << /BC [0] >> /BS << /S /D /D [-1] >>".into(),
        "/Parent 4 0 R".into(),
        format!("/MK << /CA ({}) >>", "x".repeat(65537)),
    ];
    for command in ["pdftoppm", "pdftocairo"] {
        for extra in &cases {
            let pdf = annotation_pdf(&format!("/Subtype /Widget /FT /Btn /Ff 65536 {extra}"));
            let fs = MemoryVfs::new();
            fs.write_file("/input.pdf", &pdf).unwrap();
            fs.write_file("/out-1.png", b"sentinel").unwrap();
            let args = ["-png", "-r", "72", "/input.pdf", "/out"].map(String::from);
            let result =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            assert_ne!(result.exit_code, 0, "accepted malformed button");
            assert_eq!(fs.read_file("/out-1.png").unwrap(), b"sentinel");
            assert_eq!(fs.read_file("/input.pdf").unwrap(), pdf);
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
