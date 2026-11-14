use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn pdf(content: &str) -> String {
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> /XObject << /Fm 6 0 R /Im 7 0 R >> >> >>".to_owned(),
        format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned(),
        "<< /Type /XObject /Subtype /Form /BBox [0 0 100 100] /Length 44 >>\nstream\n40 40 20 20 re W n 1 0 0 rg 0 0 100 100 re f\nendstream".to_owned(),
        "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\nff0000>\nendstream".to_owned(),
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
fn path_clipping_pixels() {
    for line in include_str!("../../safe-bash-command-pdftoppm/src/testing/path-clipping.txt").lines() {
        let parts: Vec<_> = line.split('|').collect();
        for command in ["pdftoppm", "pdftocairo"] {
            let fs = MemoryVfs::new();
            fs.write_file("/input.pdf", pdf(parts[1]).as_bytes())
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
            for probe in parts[2].split_whitespace() {
                let p: Vec<usize> = probe.split(',').map(|v| v.parse().unwrap()).collect();
                let i = (p[1] * 100 + p[0]) * 3;
                assert_eq!(
                    &pixels[i..i + 3],
                    &p[2..].iter().map(|&v| v as u8).collect::<Vec<_>>(),
                    "{} {command} at {probe}",
                    parts[0]
                );
            }
        }
    }
}

#[test]
fn clipping_budget_failure_preserves_output() {
    let fs = MemoryVfs::new();
    fs.write_file(
        "/input.pdf",
        pdf("0 0 100 100 re W n 1 0 0 rg 0 0 100 100 re f").as_bytes(),
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
    shell.set_limits(safe_bash_rust::ShellLimits {
        max_input_bytes: 40_000,
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

#[test]
fn malformed_clips_preserve_output() {
    for content in ["20 20 60 60 re 1 W n", "20 20 60 60 re W"] {
        let fs = MemoryVfs::new();
        fs.write_file("/input.pdf", pdf(content).as_bytes())
            .unwrap();
        let mut shell = Shell::new(
            Arc::new(fs.clone()),
            ShellOptions {
                cwd: Some("/".into()),
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        for command in ["pdftoppm", "pdftocairo"] {
            fs.write_file("/page.png", b"existing").unwrap();
            let result = shell
                .exec(&format!(
                    "{command} -png -r 72 -singlefile /input.pdf /page"
                ))
                .unwrap();
            assert_ne!(result.exit_code, 0, "accepted {content}");
            assert_eq!(fs.read_file("/page.png").unwrap(), b"existing");
        }
    }
}
