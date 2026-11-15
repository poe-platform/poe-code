use safe_bash_rust::{MemoryVfs, SafeBashFs, commands::archive::try_run_archive_command};
#[test]
fn checked_unchecked_and_captioned_buttons_render_without_appearances() {
    let pdf = include_bytes!("fixtures/pdf-buttons.pdf");
    for command in ["pdftoppm", "pdftocairo"] {
        let fs = MemoryVfs::new();
        fs.write_file("/input.pdf", pdf).unwrap();
        let args = ["-png", "-r", "144", "/input.pdf", "/page"].map(String::from);
        let result =
            try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let pixels = (1..=6)
            .map(|i| {
                let args = [format!("/page-{i}.png"), "/decoded.ppm".into()];
                let result =
                    try_run_archive_command("convert", &args, "", "/", &Default::default(), &fs)
                        .unwrap();
                assert_eq!(result.exit_code, 0, "{}", result.stderr);
                fs.read_file("/decoded.ppm")
                    .unwrap()
                    .strip_prefix(b"P6\n400 200\n255\n")
                    .unwrap()
                    .to_vec()
            })
            .collect::<Vec<_>>();
        let at = |i: usize, x: usize, y: usize| &pixels[i][(y * 400 + x) * 3..][..3];
        for i in [0, 1, 4] {
            for (c, expected) in [229i32, 242, 255].into_iter().enumerate() {
                let actual = at(i, if i == 4 { 350 } else { 110 }, 145)[c] as i32;
                assert!(
                    (actual - expected).abs() <= 2,
                    "{command} page {} background channel {c}: {actual}",
                    i + 1
                );
            }
        }
        let dark = |i| {
            (90..150)
                .flat_map(|y| (50..110).map(move |x| (x, y)))
                .filter(|&(x, y)| at(i, x, y).iter().all(|v| *v < 100))
                .count()
        };
        assert!(dark(0) > 100);
        assert_eq!(dark(1), 0);
        assert!(at(2, 80, 120).iter().all(|v| *v < 100));
        assert!(at(3, 80, 120)[0] > 220);
        assert_eq!(at(2, 42, 82), [255, 255, 255]);
        assert!((90..145).any(|y| (100..300).any(|x| at(4, x, y).iter().all(|v| *v < 100))));
        assert!(pixels[5].iter().all(|v| *v == 255));
        assert_eq!(fs.read_file("/input.pdf").unwrap(), pdf);
    }
}

#[test]
fn button_states_appearance_precedence_and_custom_marks() {
    let pdf = include_bytes!("fixtures/pdf-buttons-extended.pdf");
    for command in ["pdftoppm", "pdftocairo"] {
        let fs = MemoryVfs::new();
        fs.write_file("/input.pdf", pdf).unwrap();
        let args = ["-png", "-r", "144", "/input.pdf", "/page"].map(String::from);
        let result =
            try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let pixels = (1..=30)
            .map(|i| {
                let args = [format!("/page-{i:02}.png"), "/decoded.ppm".into()];
                let out =
                    try_run_archive_command("convert", &args, "", "/", &Default::default(), &fs)
                        .unwrap();
                assert_eq!(out.exit_code, 0, "{}", out.stderr);
                fs.read_file("/decoded.ppm")
                    .unwrap()
                    .strip_prefix(b"P6\n400 200\n255\n")
                    .unwrap()
                    .to_vec()
            })
            .collect::<Vec<_>>();
        for i in [6, 7] {
            assert_eq!(pixels[1], pixels[i]);
        }
        for i in [9, 10] {
            assert_eq!(pixels[3], pixels[i]);
        }
        for i in [8, 16, 25] {
            assert_eq!(pixels[0], pixels[i]);
        }
        for i in [5, 20, 21, 22] {
            assert!(
                pixels[i].iter().all(|v| *v == 255),
                "hidden/empty page {}",
                i + 1
            );
        }
        let at = |i: usize, x: usize, y: usize| &pixels[i][(y * 400 + x) * 3..][..3];
        assert!(at(18, 80, 120)[0] > 220);
        assert!(at(18, 240, 120).iter().all(|v| *v < 100));
        assert_eq!(at(19, 80, 120), [0, 255, 0]);
        assert!(at(28, 44, 84)[0] < 240, "rectangular custom radio control");
        for i in 11..16 {
            for j in i + 1..16 {
                assert_ne!(pixels[i], pixels[j], "distinct custom marks");
            }
        }
        assert_ne!(pixels[0], pixels[24], "rotated check mark");
        assert!(
            (90..140).any(|y| (80..320).any(|x| {
                let p = at(29, x, y);
                p[0] > 100 && p[1] < 100 && p[2] < 120
            })),
            "inherited caption color"
        );
        assert_eq!(fs.read_file("/input.pdf").unwrap(), pdf);
    }
}
