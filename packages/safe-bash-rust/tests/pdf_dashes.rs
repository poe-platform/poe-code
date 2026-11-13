use safe_bash_rust::{MemoryVfs, SafeBashFs, commands::archive::try_run_archive_command};

const PDF: &[u8] = include_bytes!("fixtures/dashed.pdf");

fn with_content(content: &str) -> Vec<u8> {
    let mut pdf = PDF.to_vec();
    let offset = pdf.len();
    let content = format!("1 0 0 RG 4 w {content}\n");
    pdf.extend_from_slice(
        format!(
            "4 0 obj\n<< /Length {} >>\nstream\n{content}endstream\nendobj\n",
            content.len()
        )
        .as_bytes(),
    );
    let xref = pdf.len();
    pdf.extend_from_slice(format!("xref\n4 1\n{offset:010} 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R /Prev 319 >>\nstartxref\n{xref}\n%%EOF\n").as_bytes());
    pdf
}

fn render(command: &str, pdf: &[u8]) -> Vec<u8> {
    let fs = MemoryVfs::new();
    fs.write_file("/input.pdf", pdf).unwrap();
    for (command, args) in [
        (
            command,
            vec!["-png", "-r", "72", "-singlefile", "/input.pdf", "/page"],
        ),
        ("convert", vec!["/page.png", "/page.ppm"]),
    ] {
        let args = args.into_iter().map(str::to_owned).collect::<Vec<_>>();
        let result =
            try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
    }
    let ppm = fs.read_file("/page.ppm").unwrap();
    assert!(ppm.starts_with(b"P6\n100 100\n255\n"));
    ppm[ppm.len() - 100 * 100 * 3..].to_vec()
}

#[test]
fn attached_pdf_has_four_dashes_and_white_gaps() {
    for command in ["pdftoppm", "pdftocairo"] {
        let pixels = render(command, PDF);
        assert_eq!(&pixels[(50 * 100 + 25) * 3..][..3], &[255; 3], "{command}");
        assert_eq!(
            pixels.chunks_exact(3).filter(|p| *p != [255; 3]).count(),
            160,
            "{command}"
        );
    }
}

#[test]
fn dash_semantics_match_the_shared_pixel_cases() {
    for line in include_str!("fixtures/pdf-dashes.txt")
        .lines()
        .filter(|s| !s.starts_with('#'))
    {
        let fields = line.split(" | ").collect::<Vec<_>>();
        for command in ["pdftoppm", "pdftocairo"] {
            let pixels = render(command, &with_content(fields[1]));
            for probe in fields[2].split_whitespace() {
                let p = probe.split(',').collect::<Vec<_>>();
                let x = p[0].parse::<usize>().unwrap();
                let y = p[1].parse::<usize>().unwrap();
                let expected = if p[2] == "red" { [255, 0, 0] } else { [255; 3] };
                assert_eq!(
                    &pixels[(y * 100 + x) * 3..][..3],
                    &expected,
                    "{command}, {}, {probe}",
                    fields[0]
                );
            }
        }
    }
}

#[test]
fn excessive_dash_expansion_preserves_existing_output() {
    for command in ["pdftoppm", "pdftocairo"] {
        let fs = MemoryVfs::new();
        fs.write_file(
            "/input.pdf",
            &with_content("[0.000000001 0.000000001] 0 d 10 50 m 90 50 l S"),
        )
        .unwrap();
        fs.write_file("/page.png", b"existing").unwrap();
        let args = ["-png", "-r", "72", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
        let result =
            try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
        assert_ne!(result.exit_code, 0, "{command}");
        assert_eq!(fs.read_file("/page.png").unwrap(), b"existing");
    }
}
