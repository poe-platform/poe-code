use safe_bash_rust::{
    MemoryVfs, SafeBashFs,
    commands::{archive::try_run_archive_command, codecs::inflate_raw},
};
const PDF: &[u8] = include_bytes!("fixtures/axial-shading.pdf");

#[test]
fn axial_gradient() {
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

        for x in [10usize, 50, 90] {
            let i = 50 * (100 * channels + 1) + 1 + x * channels;
            let expected = [255 - (x * 255 / 100) as u8, 0, (x * 255 / 100) as u8];
            for k in 0..3 {
                assert!(
                    raw[i + k].abs_diff(expected[k]) <= 2,
                    "{command} x={x}: {:?}",
                    &raw[i..i + 3]
                );
            }
        }
    }
}

fn pdf(content: &str, settings: &str) -> String {
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /Shading << /Blend 5 0 R >> /XObject << /Fm 7 0 R >> >> >>".to_owned(),
        format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
        format!("<< /ShadingType 2 /ColorSpace /DeviceRGB /Function 6 0 R {settings} >>"),
        "<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>".to_owned(),
        "<< /Type /XObject /Subtype /Form /BBox [20 20 80 80] /Matrix [0.5 0 0 0.5 25 25] /Resources << /Shading << /Blend 5 0 R >> >> /Length 9 >>\nstream\n/Blend sh\nendstream".to_owned(),
    ];
    let mut bytes = String::from("%PDF-1.4\n");
    let mut offsets = vec![0];
    for (i, object) in objects.iter().enumerate() {
        offsets.push(bytes.len());
        bytes.push_str(&format!("{} 0 obj\n{object}\nendobj\n", i + 1));
    }
    let xref = bytes.len();
    bytes.push_str(&format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len()));
    for offset in &offsets[1..] {
        bytes.push_str(&format!("{offset:010} 00000 n \n"));
    }
    bytes.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
        offsets.len()
    ));
    bytes
}

#[test]
fn axial_transforms_extend_and_clipping() {
    use safe_bash_rust::{BackendMode, Shell, ShellOptions};
    use std::sync::Arc;
    for line in include_str!("fixtures/axial-shading.txt").lines() {
        let parts: Vec<_> = line.split('|').collect();
        for command in ["pdftoppm", "pdftocairo"] {
            let fs = MemoryVfs::new();
            fs.write_file("/input.pdf", pdf(parts[1], parts[2]).as_bytes())
                .unwrap();
            let mut shell = Shell::new(
                Arc::new(fs.clone()),
                ShellOptions {
                    cwd: Some("/".into()),
                    mode: BackendMode::NativeOnly,
                    ..Default::default()
                },
            );
            let result = shell.exec(&format!("{command} -png -r 72 -singlefile /input.pdf /page && convert /page.png /page.ppm")).unwrap();
            assert_eq!(result.exit_code, 0, "{}: {}", parts[0], result.stderr);
            let ppm = fs.read_file("/page.ppm").unwrap();
            let pixels = &ppm[ppm.len() - 100 * 100 * 3..];
            for probe in parts[3].split_whitespace() {
                let p: Vec<usize> = probe.split(',').map(|v| v.parse().unwrap()).collect();
                let i = (p[1] * 100 + p[0]) * 3;
                for k in 0..3 {
                    assert!(
                        pixels[i + k].abs_diff(p[2 + k] as u8) <= 3,
                        "{} {command} at {probe}: {:?}",
                        parts[0],
                        &pixels[i..i + 3]
                    );
                }
            }
        }
    }
}

#[test]
fn malformed_and_unsupported_shading_preserve_output() {
    for settings in [
        "/Coords [0 0 100 0] /Extend [bad true]",
        "/Coords [0 0 0 0]",
        "/ShadingType 3 /Coords [0 0 100 0]",
        "/Coords [0 0 100 0] /Function << /FunctionType 4 >>",
    ] {
        for command in ["pdftoppm", "pdftocairo"] {
            let fs = MemoryVfs::new();
            fs.write_file("/input.pdf", pdf("/Blend sh", settings).as_bytes())
                .unwrap();
            fs.write_file("/page.png", b"existing").unwrap();
            let args =
                ["-png", "-r", "72", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
            let result =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            assert_ne!(result.exit_code, 0, "{command}: {settings}");
            assert_eq!(fs.read_file("/page.png").unwrap(), b"existing");
        }
    }
}

#[test]
fn shading_work_budget_preserves_output() {
    use safe_bash_rust::{BackendMode, Shell, ShellLimits, ShellOptions};
    use std::sync::Arc;
    let fs = MemoryVfs::new();
    fs.write_file(
        "/input.pdf",
        pdf(&"/Blend sh ".repeat(20), "/Coords [0 0 100 0]").as_bytes(),
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
    shell.set_limits(ShellLimits {
        max_input_bytes: 100_000,
        ..Default::default()
    });
    for command in ["pdftoppm", "pdftocairo"] {
        fs.write_file("/page.png", b"existing").unwrap();
        let result = shell
            .exec(&format!(
                "{command} -png -r 72 -singlefile /input.pdf /page"
            ))
            .unwrap();
        assert_ne!(result.exit_code, 0);
        assert_eq!(fs.read_file("/page.png").unwrap(), b"existing");
    }
}
