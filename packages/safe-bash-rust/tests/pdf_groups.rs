use safe_bash_rust::{
    MemoryVfs, SafeBashFs,
    commands::{archive::try_run_archive_command, codecs::inflate_raw},
};

#[test]
fn transparency_forms_composite_once() {
    for (name, pdf) in [
        (
            "group-backdrop-false",
            include_bytes!("fixtures/group-backdrop-false.pdf").as_slice(),
        ),
        (
            "group-backdrop-true",
            include_bytes!("fixtures/group-backdrop-true.pdf").as_slice(),
        ),
        (
            "group-blend-false",
            include_bytes!("fixtures/group-blend-false.pdf").as_slice(),
        ),
        (
            "group-blend-true",
            include_bytes!("fixtures/group-blend-true.pdf").as_slice(),
        ),
        (
            "group-false",
            include_bytes!("fixtures/group-false.pdf").as_slice(),
        ),
        (
            "group-nested-false",
            include_bytes!("fixtures/group-nested-false.pdf").as_slice(),
        ),
        (
            "group-nested-true",
            include_bytes!("fixtures/group-nested-true.pdf").as_slice(),
        ),
        (
            "group-none",
            include_bytes!("fixtures/group-none.pdf").as_slice(),
        ),
        (
            "group-true",
            include_bytes!("fixtures/group-true.pdf").as_slice(),
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
            for line in include_str!("fixtures/pdf-groups.txt")
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
fn unsupported_groups_and_intermediate_limits_preserve_output() {
    let input = include_bytes!("fixtures/group-true.pdf");
    let mut invalid = Vec::new();
    for (from, to) in [
        ("/K false", "/K true "),
        ("/I true", "/I nope"),
        ("/I true /K false", "/CS /DeviceCMYK "),
        ("/S /Transparency", "/S /Unsupported "),
    ] {
        let mut bytes = input.to_vec();
        let at = bytes
            .windows(from.len())
            .position(|v| v == from.as_bytes())
            .unwrap();
        assert_eq!(from.len(), to.len());
        bytes[at..at + from.len()].copy_from_slice(to.as_bytes());
        invalid.push((bytes, "100"));
    }
    // The page alone fits; one group at 1100px, or two nested groups at
    // 900px, exceed the 16 MiB aggregate surface budget.
    invalid.push((input.to_vec(), "1100"));
    invalid.push((
        include_bytes!("fixtures/group-nested-true.pdf").to_vec(),
        "900",
    ));
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
