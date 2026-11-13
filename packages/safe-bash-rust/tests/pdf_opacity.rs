use safe_bash_rust::{
    MemoryVfs, SafeBashFs,
    commands::{archive::try_run_archive_command, codecs::inflate_raw},
};
const PDF: &[u8] = include_bytes!("fixtures/constant-opacity.pdf");

#[test]
fn constant_fill_and_stroke_opacity_and_scopes() {
    for command in ["pdftoppm", "pdftocairo"] {
        let fs = MemoryVfs::new();
        fs.write_file("/input.pdf", PDF).unwrap();
        let args = ["-png", "-r", "72", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
        let result =
            try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let png = fs.read_file("/page.png").unwrap();
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
        for y in [20, 40, 50, 60, 70, 80, 90, 95] {
            let row = &raw[y * (100 * channels + 1)..];
            assert_eq!(row[0], 0);
            let expected = match y {
                50 => [[255u8, 0, 0], [0, 0, 255], [255, 0, 0]],
                95 => [[127, 0, 128], [191, 0, 64], [255, 0, 0]],
                _ => [[255, 0, 0], [128, 0, 128], [0, 0, 255]],
            };
            for (x, expected) in [20, 50, 80].into_iter().zip(expected) {
                let pixel = &row[1 + x * channels..1 + x * channels + 3];
                for i in 0..3 {
                    assert!(
                        pixel[i].abs_diff(expected[i]) <= 1,
                        "{command} ({x},{y}) {pixel:?}"
                    );
                }
            }
        }
    }
}

#[test]
fn malformed_opacity_preserves_existing_output() {
    for (from, to) in [
        ("/ca 0.5", "/ca bad"),
        ("/ca 0.5", "/ca 2.0"),
        ("/CA 0.5", "/CA -01"),
        ("/half 5 0 R", "/half 9 0 R"),
        ("/half gs", "/lost gs"),
        ("<< /Type /ExtGState /ca 0.5 /CA 0.5 >>", "5 0 R"),
    ] {
        let mut bytes = PDF.to_vec();
        let at = bytes
            .windows(from.len())
            .position(|w| w == from.as_bytes())
            .unwrap();
        bytes[at..at + from.len()].fill(b' ');
        bytes[at..at + to.len()].copy_from_slice(to.as_bytes());
        for command in ["pdftoppm", "pdftocairo"] {
            let fs = MemoryVfs::new();
            fs.write_file("/input.pdf", &bytes).unwrap();
            fs.write_file("/page.png", b"existing").unwrap();
            let args =
                ["-png", "-r", "72", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
            let result =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            assert_ne!(result.exit_code, 0);
            assert_eq!(fs.read_file("/page.png").unwrap(), b"existing");
        }
    }
}

#[test]
fn opacity_does_not_bypass_raster_budget() {
    for command in ["pdftoppm", "pdftocairo"] {
        let fs = MemoryVfs::new();
        fs.write_file("/input.pdf", PDF).unwrap();
        fs.write_file("/page.png", b"existing").unwrap();
        let args = ["-png", "-r", "72000", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
        let result =
            try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
        assert_ne!(result.exit_code, 0);
        assert_eq!(fs.read_file("/page.png").unwrap(), b"existing");
    }
}
