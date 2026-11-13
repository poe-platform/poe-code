use safe_bash_rust::{
    MemoryVfs, SafeBashFs,
    commands::{archive::try_run_archive_command, codecs::inflate_raw},
};

#[test]
fn graphics_state_soft_masks() {
    for (name, pdf) in [
        (
            "mask-alpha",
            include_bytes!("fixtures/mask-alpha.pdf").as_slice(),
        ),
        (
            "mask-luminosity",
            include_bytes!("fixtures/mask-luminosity.pdf").as_slice(),
        ),
        (
            "mask-reset",
            include_bytes!("fixtures/mask-reset.pdf").as_slice(),
        ),
        (
            "mask-none",
            include_bytes!("fixtures/mask-none.pdf").as_slice(),
        ),
        (
            "mask-transform",
            include_bytes!("fixtures/mask-transform.pdf").as_slice(),
        ),
        (
            "mask-nested",
            include_bytes!("fixtures/mask-nested.pdf").as_slice(),
        ),
        (
            "mask-group",
            include_bytes!("fixtures/mask-group.pdf").as_slice(),
        ),
        (
            "mask-form",
            include_bytes!("fixtures/mask-form.pdf").as_slice(),
        ),
        (
            "mask-backdrop",
            include_bytes!("fixtures/mask-backdrop.pdf").as_slice(),
        ),
        (
            "mask-image",
            include_bytes!("fixtures/mask-image.pdf").as_slice(),
        ),
        (
            "mask-paints",
            include_bytes!("fixtures/mask-paints.pdf").as_slice(),
        ),
        (
            "mask-text",
            include_bytes!("fixtures/mask-text.pdf").as_slice(),
        ),
        (
            "mask-alpha-backdrop",
            include_bytes!("fixtures/mask-alpha-backdrop.pdf").as_slice(),
        ),
        (
            "mask-constant",
            include_bytes!("fixtures/mask-constant.pdf").as_slice(),
        ),
    ] {
        for command in ["pdftoppm", "pdftocairo"] {
            let fs = MemoryVfs::new();
            fs.write_file("/input.pdf", pdf).unwrap();
            let args =
                ["-png", "-r", "72", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
            let result =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            let png = fs.read_file("/page.png").unwrap();
            let digest = safe_bash_rust::commands::archive::sha256_bytes(&png)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>();
            assert!(
                include_str!("fixtures/pdf-soft-mask-png-sha256.txt")
                    .lines()
                    .any(|line| line == format!("{name} {command} {digest}")),
                "PNG parity: {name} {command} {digest}"
            );
            let mut compressed = Vec::new();
            let mut at = 8;
            while at < png.len() {
                let len = u32::from_be_bytes(png[at..at + 4].try_into().unwrap()) as usize;
                if &png[at + 4..at + 8] == b"IDAT" {
                    compressed.extend_from_slice(&png[at + 8..at + 8 + len]);
                }
                at += len + 12;
            }
            let (raw, _) = inflate_raw(&compressed[2..]).unwrap();
            let channels = if png[25] == 6 { 4 } else { 3 };
            for line in include_str!("fixtures/pdf-soft-masks.txt")
                .lines()
                .filter(|l| l.starts_with(&format!("{name} ")))
            {
                let values: Vec<usize> = line
                    .split_whitespace()
                    .skip(1)
                    .map(|n| n.parse().unwrap())
                    .collect();
                let [x, y, r, g, b] = values[..] else {
                    panic!("bad probe")
                };
                let at = y * (100 * channels + 1) + 1 + x * channels;
                for (i, expected) in [r, g, b].into_iter().enumerate() {
                    assert!(
                        raw[at + i].abs_diff(expected as u8) <= 2,
                        "{command} {line}: {:?}",
                        &raw[at..at + 3]
                    );
                }
            }
        }
    }
}

#[test]
fn invalid_masks_and_surface_limits_preserve_output() {
    let alpha = include_bytes!("fixtures/mask-alpha.pdf");
    let nested = include_bytes!("fixtures/mask-nested.pdf");
    let backdrop = include_bytes!("fixtures/mask-backdrop.pdf");
    let mut invalid = Vec::new();
    for (input, from, to) in [
        (alpha.as_slice(), "/S /Alpha", "/S /Bogus"),
        (alpha.as_slice(), "/G 6 0 R", "/G 5 0 R"),
        (nested.as_slice(), "/G 7 0 R", "/G 6 0 R"),
        (backdrop.as_slice(), "/Identity", "/Invertxx"),
        (alpha.as_slice(), "/DeviceRGB", "/DeviceXYZ"),
    ] {
        let mut pdf = input.to_vec();
        let at = pdf
            .windows(from.len())
            .position(|v| v == from.as_bytes())
            .unwrap();
        assert_eq!(from.len(), to.len());
        pdf[at..at + from.len()].copy_from_slice(to.as_bytes());
        invalid.push((pdf, "100"));
    }
    // The page fits, but its group and retained mask exceed the shared budget.
    invalid.push((alpha.to_vec(), "900"));
    invalid.push((nested.to_vec(), "750"));
    for (pdf, scale) in invalid {
        for command in ["pdftoppm", "pdftocairo"] {
            let fs = MemoryVfs::new();
            fs.write_file("/input.pdf", &pdf).unwrap();
            fs.write_file("/page.png", b"existing").unwrap();
            let args = [
                "-png",
                "-scale-to",
                scale,
                "-singlefile",
                "/input.pdf",
                "/page",
            ]
            .map(str::to_owned);
            let result =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            assert_ne!(result.exit_code, 0, "{command} scale {scale}");
            assert_eq!(fs.read_file("/page.png").unwrap(), b"existing");
        }
    }
}

#[test]
fn text_in_soft_masks_is_not_page_text() {
    let fs = MemoryVfs::new();
    fs.write_file("/input.pdf", include_bytes!("fixtures/mask-text.pdf"))
        .unwrap();
    let args = ["/input.pdf", "-"].map(str::to_owned);
    let result =
        try_run_archive_command("pdftotext", &args, "", "/", &Default::default(), &fs).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert!(!result.stdout.contains('H'), "{}", result.stdout);
}
