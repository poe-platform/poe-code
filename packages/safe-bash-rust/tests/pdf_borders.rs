// Relief bands follow PDFium 156.0.8076.0 interactive forms, not MuPDF 1.23.10.
// Existing radio contours and text sizing are intentionally preserved.
use safe_bash_rust::{MemoryVfs, SafeBashFs, commands::archive::try_run_archive_command};
fn verify(style: usize, upper: [i32; 3], lower: [i32; 3]) {
    let pdf = include_bytes!("fixtures/pdf-borders.pdf");
    let mut failures = Vec::new();
    for command in ["pdftoppm", "pdftocairo"] {
        let fs = MemoryVfs::new();
        fs.write_file("/input.pdf", pdf).unwrap();
        let args = ["-png", "-r", "144", "/input.pdf", "/page"].map(String::from);
        let result =
            try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        for page in (style..=15).step_by(3) {
            let args = [format!("/page-{page:02}.png"), "/decoded.ppm".into()];
            let r = try_run_archive_command("convert", &args, "", "/", &Default::default(), &fs)
                .unwrap();
            assert_eq!(r.exit_code, 0);
            let ppm = fs.read_file("/decoded.ppm").unwrap();
            let pixels = ppm.strip_prefix(b"P6\n400 200\n255\n").unwrap();
            if page >= 13 {
                if style == 1 {
                    assert_eq!(&pixels[(60 * 400 + 200) * 3..][..3], &[204, 217, 230]);
                    continue;
                }
                let lower = if style == 2 { [140, 153, 166] } else { lower };
                for (start, expected) in [(45, upper), (145, lower)] {
                    if !(start..=start + 10).any(|y| {
                        (0..3).all(|c| {
                            (pixels[(y * 400 + 200) * 3 + c] as i32 - expected[c]).abs() <= 2
                        })
                    }) {
                        failures.push(format!(
                            "{command} page {page}: missing circular shade {expected:?}"
                        ));
                    }
                }
                continue;
            }
            for (y, expected) in [(48, upper), (152, lower)] {
                let actual = &pixels[(y * 400 + 100) * 3..][..3];
                if (0..3).any(|c| (actual[c] as i32 - expected[c]).abs() > 2) {
                    failures.push(format!(
                        "{command} page {page} row {y}: {actual:?} != {expected:?}"
                    ));
                }
            }
        }
        assert_eq!(fs.read_file("/input.pdf").unwrap(), pdf);
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
#[test]
fn beveled_borders() {
    verify(2, [255, 255, 255], [102, 108, 115]);
}
#[test]
fn inset_borders() {
    verify(3, [128, 128, 128], [191, 191, 191]);
}
#[test]
fn solid_control() {
    verify(1, [204, 217, 230], [204, 217, 230]);
}

#[test]
fn relief_defaults_rotation_clipping_and_appearance_precedence() {
    let pdf = include_bytes!("fixtures/pdf-borders-extended.pdf");
    for command in ["pdftoppm", "pdftocairo"] {
        let fs = MemoryVfs::new();
        fs.write_file("/input.pdf", pdf).unwrap();
        let args = ["-png", "-r", "144", "/input.pdf", "/page"].map(String::from);
        let result =
            try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        for offset in [0, 15] {
            let pages = (1..=15)
                .map(|i| {
                    let args = [
                        format!("/page-{:02}.png", offset + i),
                        "/decoded.ppm".into(),
                    ];
                    let result = try_run_archive_command(
                        "convert",
                        &args,
                        "",
                        "/",
                        &Default::default(),
                        &fs,
                    )
                    .unwrap();
                    assert_eq!(result.exit_code, 0, "{}", result.stderr);
                    fs.read_file("/decoded.ppm")
                        .unwrap()
                        .strip_prefix(b"P6\n400 200\n255\n")
                        .unwrap()
                        .to_vec()
                })
                .collect::<Vec<_>>();
            let near = |i: usize, x: usize, y: usize, expected: [i32; 3]| {
                let actual = &pages[i][(y * 400 + x) * 3..][..3];
                assert!(
                    (0..3).all(|c| (actual[c] as i32 - expected[c]).abs() <= 2),
                    "{command} page {} at {x},{y}: {actual:?} != {expected:?}",
                    offset + i + 1
                );
            };
            let upper = if offset == 0 {
                [255, 255, 255]
            } else {
                [128, 128, 128]
            };
            let lower = if offset == 0 {
                [102, 108, 115]
            } else {
                [191, 191, 191]
            };
            for i in [0, 2] {
                near(i, 100, 48, upper);
                near(i, 100, 152, lower);
            }
            near(
                1,
                100,
                152,
                if offset == 0 { [128, 128, 128] } else { lower },
            );
            near(3, 100, 152, if offset == 0 { [77, 77, 77] } else { lower });
            // Existing CMYK conversion is preserved; PDFium's profile differs slightly.
            near(
                4,
                100,
                152,
                if offset == 0 { [227, 232, 236] } else { lower },
            );
            let shade = if offset == 0 { [191, 191, 191] } else { lower };
            assert!((145..=155).any(|y| {
                (0..3).all(|c| (pages[14][(y * 400 + 200) * 3 + c] as i32 - shade[c]).abs() <= 2)
            }));
            for i in [8, 9] {
                near(i, 100, 48, lower);
                near(i, 100, 152, upper);
            }
            near(10, 100, 48, upper);
            near(10, 100, 152, lower);
            for i in [5, 6] {
                near(i, 100, 42, [204, 217, 230]);
            }
            near(6, 100, 41, upper);
            near(6, 100, 158, lower);
            near(7, 39, 158, [255, 255, 255]);
            near(7, 45, 158, [255, 255, 255]);
            for i in [11, 13] {
                assert!(pages[i].iter().all(|v| *v == 255));
            }
            near(12, 100, 100, [0, 255, 0]);
        }
        assert_eq!(fs.read_file("/input.pdf").unwrap(), pdf);
    }
}
