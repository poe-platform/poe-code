use safe_bash_rust::{commands::archive::try_run_archive_command, MemoryVfs, SafeBashFs};
const PDF: &[u8] = include_bytes!("fixtures/pdf-appearances.pdf");

#[test]
fn visible_appearance_streams_match_pdfium_and_hidden_appearances_stay_hidden() {
    // PDFium controls: stamps, /Off state, placement, flags, page-state isolation,
    // reversed rectangles, opacity, BBox clipping, stacking and page rotation.
    for command in ["pdftoppm", "pdftocairo"] {
        let fs = MemoryVfs::new();
        fs.write_file("/input.pdf", PDF).unwrap();
        let args = ["-png", "-r", "72", "/input.pdf", "/page"].map(String::from);
        let result =
            try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
        let mut pages = Vec::new();
        for page in 1..=10 {
            let filename = fs
                .list_dir("/")
                .unwrap()
                .into_iter()
                .find(|name| {
                    name.strip_prefix("page-")
                        .and_then(|s| s.strip_suffix(".png"))
                        .and_then(|s| s.parse::<usize>().ok())
                        == Some(page)
                })
                .unwrap();
            let args = [format!("/{filename}"), "/decoded.ppm".into()];
            let result =
                try_run_archive_command("convert", &args, "", "/", &Default::default(), &fs)
                    .unwrap();
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            let ppm = fs.read_file("/decoded.ppm").unwrap();
            pages.push(
                ppm.strip_prefix(b"P6\n100 100\n255\n")
                    .expect("100x100 RGB control")
                    .to_vec(),
            );
        }
        for row in include_str!("fixtures/pdf-appearances.samples").lines() {
            let n = row
                .split_whitespace()
                .map(|s| s.parse::<usize>().unwrap())
                .collect::<Vec<_>>();
            let at = (n[2] * 100 + n[1]) * 3;
            for channel in 0..3 {
                assert!(
                    (pages[n[0] - 1][at + channel] as i32 - n[3 + channel] as i32).abs() <= 2,
                    "{command}: PDFium {row}; actual {:?}",
                    &pages[n[0] - 1][at..at + 3]
                );
            }
        }
        assert_eq!(fs.read_file("/input.pdf").unwrap(), PDF);
    }
}

#[test]
fn hide_annotations_preserves_page_paint_without_appearance_artwork() {
    for command in ["pdftoppm", "pdftocairo"] {
        let fs = MemoryVfs::new();
        fs.write_file("/input.pdf", PDF).unwrap();
        for page in [1, 6] {
            let args = [
                "-hide-annotations",
                "-png",
                "-r",
                "72",
                "-singlefile",
                "-f",
                &page.to_string(),
                "/input.pdf",
                "/page",
            ]
            .map(String::from);
            let out =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            assert_eq!(out.exit_code, 0, "{}", out.stderr);
            let args = ["/page.png", "/decoded.ppm"].map(String::from);
            let out = try_run_archive_command("convert", &args, "", "/", &Default::default(), &fs)
                .unwrap();
            assert_eq!(out.exit_code, 0, "{}", out.stderr);
            let bytes = fs.read_file("/decoded.ppm").unwrap();
            let pixels = bytes.strip_prefix(b"P6\n100 100\n255\n").unwrap();
            assert!(pixels.chunks_exact(3).all(|p| p
                == if page == 1 {
                    [255, 255, 255]
                } else {
                    [0, 0, 255]
                }));
        }
    }
}

#[test]
fn null_annotation_array_is_an_empty_page_not_a_rendering_failure() {
    let mut bytes = PDF.to_vec();
    let at = bytes.windows(9).position(|s| s == b"/Annots [").unwrap() + 8;
    let end = at + bytes[at..].iter().position(|&b| b == b']').unwrap() + 1;
    bytes[at..end].fill(b' ');
    bytes[at..at + 4].copy_from_slice(b"null");
    for command in ["pdftoppm", "pdftocairo"] {
        let fs = MemoryVfs::new();
        fs.write_file("/input.pdf", &bytes).unwrap();
        let args = ["-png", "-r", "72", "-singlefile", "/input.pdf", "/page"].map(String::from);
        let out =
            try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(out.exit_code, 0, "{}", out.stderr);
    }
}
