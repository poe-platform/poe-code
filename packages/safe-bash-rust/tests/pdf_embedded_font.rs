use safe_bash_rust::{MemoryVfs, SafeBashFs, commands::archive::try_run_archive_command};

const PDF: &[u8] = include_bytes!("fixtures/embedded-font.pdf");

#[test]
fn embedded_simple_truetype_text_is_visible() {
    let fs = MemoryVfs::new();
    fs.write_file("/input.pdf", PDF).unwrap();
    let args = ["-r", "72", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
    let result =
        try_run_archive_command("pdftoppm", &args, "", "/", &Default::default(), &fs).unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let ppm = fs.read_file("/page.ppm").unwrap();
    let pixels = &ppm[ppm.len() - 320 * 160 * 3..];
    let dark = (20..115)
        .flat_map(|y| (15..305).map(move |x| (y * 320 + x) * 3))
        .filter(|&i| pixels[i..i + 3].iter().all(|&c| c < 60))
        .count();
    assert!(dark > 1000, "only {dark} dark text pixels");
}

fn replace(bytes: &[u8], from: &[u8], to: &[u8]) -> Vec<u8> {
    assert_eq!(from.len(), to.len());
    let mut bytes = bytes.to_vec();
    let at = bytes.windows(from.len()).position(|w| w == from).unwrap();
    bytes[at..at + from.len()].copy_from_slice(to);
    bytes
}

#[test]
fn empty_embedded_glyphs_stay_blank_and_standard_fonts_still_render() {
    let blank = replace(
        &replace(PDF, b"Invoice 0123", b"            "),
        b"Text must survive",
        b"                 ",
    );
    let standard = replace(
        &replace(
            &replace(PDF, b"/FontDescriptor", b"/UnusedFontDesc"),
            b"/DejaVuSans",
            b"/Helvetica ",
        ),
        b"/TrueType",
        b"/Type1   ",
    );
    for (bytes, visible) in [(blank, false), (standard, true)] {
        let fs = MemoryVfs::new();
        fs.write_file("/input.pdf", &bytes).unwrap();
        let args = ["-r", "72", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
        let result =
            try_run_archive_command("pdftoppm", &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let ppm = fs.read_file("/page.ppm").unwrap();
        let pixels = &ppm[ppm.len() - 320 * 160 * 3..];
        let dark = (20..115)
            .flat_map(|y| (15..305).map(move |x| (y * 320 + x) * 3))
            .filter(|&i| pixels[i..i + 3].iter().all(|&c| c < 60))
            .count();
        if visible {
            assert!(dark > 1000);
        } else {
            assert_eq!(dark, 0);
        }
    }
}

#[test]
fn invalid_or_unsupported_embedded_fonts_preserve_output() {
    for bytes in [
        replace(PDF, b"/FontFile2 6", b"/FontFile2 5"),
        replace(PDF, b"/WinAnsiEncoding", b"/MacRomanEncodin"),
        replace(PDF, b"/FontFile2", b"/FontFile3"),
        replace(PDF, b"/TrueType", b"/Type0   "),
        replace(PDF, b"/FontFile2 6 0 R", b"/FontFile2 9 0 R"),
    ] {
        for command in ["pdftoppm", "pdftocairo"] {
            let fs = MemoryVfs::new();
            fs.write_file("/input.pdf", &bytes).unwrap();
            fs.write_file("/page.png", b"existing").unwrap();
            let args =
                ["-png", "-r", "72", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
            let result =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            assert_ne!(result.exit_code, 0, "{command} accepted invalid font");
            assert_eq!(fs.read_file("/page.png").unwrap(), b"existing");
        }
    }
}

#[test]
fn embedded_font_streams_share_the_decoded_byte_budget() {
    // An incremental page revision refers to the same compressed font under
    // enough resource names to exceed the aggregate decoded-stream allowance.
    let mut bytes = PDF.to_vec();
    let offset = bytes.len();
    let fonts = (0..32).map(|i| format!("/F{i} 4 0 R ")).collect::<String>();
    bytes.extend_from_slice(format!("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 160] /Resources << /Font << {fonts} >> >> /Contents 5 0 R >>\nendobj\n").as_bytes());
    let xref = bytes.len();
    bytes.extend_from_slice(format!("xref\n3 1\n{offset:010} 00000 n \ntrailer\n<< /Size 8 /Root 1 0 R /Prev 380391 >>\nstartxref\n{xref}\n%%EOF\n").as_bytes());
    for command in ["pdftoppm", "pdftocairo"] {
        let fs = MemoryVfs::new();
        fs.write_file("/input.pdf", &bytes).unwrap();
        fs.write_file("/page.png", b"existing").unwrap();
        let args = ["-png", "-r", "72", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
        let result =
            try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
        assert_ne!(result.exit_code, 0);
        assert_eq!(fs.read_file("/page.png").unwrap(), b"existing");
    }
}
