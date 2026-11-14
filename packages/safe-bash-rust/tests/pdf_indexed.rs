use safe_bash_rust::{
    MemoryVfs, SafeBashFs,
    commands::{archive::try_run_archive_command, codecs::inflate_raw},
};

#[test]
fn indexed_images_render_and_invalid_palettes_preserve_output() {
    for (name, pdf) in [
        (
            "indexed-1bit",
            include_bytes!("fixtures/indexed/indexed-1bit.pdf").as_slice(),
        ),
        (
            "bad-base",
            include_bytes!("fixtures/indexed/bad-base.pdf").as_slice(),
        ),
        (
            "bad-bits",
            include_bytes!("fixtures/indexed/bad-bits.pdf").as_slice(),
        ),
        (
            "bad-cycle",
            include_bytes!("fixtures/indexed/bad-cycle.pdf").as_slice(),
        ),
        (
            "bad-decode",
            include_bytes!("fixtures/indexed/bad-decode.pdf").as_slice(),
        ),
        (
            "bad-decode-name",
            include_bytes!("fixtures/indexed/bad-decode-name.pdf").as_slice(),
        ),
        (
            "bad-decode-empty",
            include_bytes!("fixtures/indexed/bad-decode-empty.pdf").as_slice(),
        ),
        (
            "bad-decode-type",
            include_bytes!("fixtures/indexed/bad-decode-type.pdf").as_slice(),
        ),
        (
            "bad-decode-extra-type",
            include_bytes!("fixtures/indexed/bad-decode-extra-type.pdf").as_slice(),
        ),
        (
            "bad-fraction",
            include_bytes!("fixtures/indexed/bad-fraction.pdf").as_slice(),
        ),
        (
            "bad-high",
            include_bytes!("fixtures/indexed/bad-high.pdf").as_slice(),
        ),
        (
            "bad-lookup",
            include_bytes!("fixtures/indexed/bad-lookup.pdf").as_slice(),
        ),
        (
            "bad-negative",
            include_bytes!("fixtures/indexed/bad-negative.pdf").as_slice(),
        ),
        (
            "bad-resource",
            include_bytes!("fixtures/indexed/bad-resource.pdf").as_slice(),
        ),
        (
            "bad-short",
            include_bytes!("fixtures/indexed/bad-short.pdf").as_slice(),
        ),
        (
            "bad-stream",
            include_bytes!("fixtures/indexed/bad-stream.pdf").as_slice(),
        ),
        (
            "clamp-8",
            include_bytes!("fixtures/indexed/clamp-8.pdf").as_slice(),
        ),
        (
            "cmyk",
            include_bytes!("fixtures/indexed/cmyk.pdf").as_slice(),
        ),
        (
            "decode-null",
            include_bytes!("fixtures/indexed/decode-null.pdf").as_slice(),
        ),
        (
            "decode-indirect-null",
            include_bytes!("fixtures/indexed/decode-indirect-null.pdf").as_slice(),
        ),
        (
            "decode-1",
            include_bytes!("fixtures/indexed/decode-1.pdf").as_slice(),
        ),
        (
            "decode-domain",
            include_bytes!("fixtures/indexed/decode-domain.pdf").as_slice(),
        ),
        (
            "decode-reverse",
            include_bytes!("fixtures/indexed/decode-reverse.pdf").as_slice(),
        ),
        (
            "form-resource",
            include_bytes!("fixtures/indexed/form-resource.pdf").as_slice(),
        ),
        (
            "indexed-8bit",
            include_bytes!("fixtures/indexed/indexed-8bit.pdf").as_slice(),
        ),
        (
            "indexed-gray",
            include_bytes!("fixtures/indexed/indexed-gray.pdf").as_slice(),
        ),
        (
            "indirect-string",
            include_bytes!("fixtures/indexed/indirect-string.pdf").as_slice(),
        ),
        (
            "inline",
            include_bytes!("fixtures/indexed/inline.pdf").as_slice(),
        ),
        (
            "interpolate",
            include_bytes!("fixtures/indexed/interpolate.pdf").as_slice(),
        ),
        (
            "key-1",
            include_bytes!("fixtures/indexed/key-1.pdf").as_slice(),
        ),
        (
            "key-8",
            include_bytes!("fixtures/indexed/key-8.pdf").as_slice(),
        ),
        (
            "literal",
            include_bytes!("fixtures/indexed/literal.pdf").as_slice(),
        ),
        (
            "packed-2",
            include_bytes!("fixtures/indexed/packed-2.pdf").as_slice(),
        ),
        (
            "packed-4",
            include_bytes!("fixtures/indexed/packed-4.pdf").as_slice(),
        ),
        (
            "resource",
            include_bytes!("fixtures/indexed/resource.pdf").as_slice(),
        ),
        (
            "rgb-control",
            include_bytes!("fixtures/indexed/rgb-control.pdf").as_slice(),
        ),
        (
            "rgb-interpolate",
            include_bytes!("fixtures/indexed/rgb-interpolate.pdf").as_slice(),
        ),
        (
            "soft-mask",
            include_bytes!("fixtures/indexed/soft-mask.pdf").as_slice(),
        ),
        (
            "stream",
            include_bytes!("fixtures/indexed/stream.pdf").as_slice(),
        ),
    ] {
        for command in ["pdftoppm", "pdftocairo"] {
            let fs = MemoryVfs::new();
            fs.write_file("/input.pdf", pdf).unwrap();
            fs.write_file("/page.png", b"existing").unwrap();
            let args =
                ["-png", "-r", "72", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
            let result =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            let png = fs.read_file("/page.png").unwrap();
            if name.starts_with("bad-") {
                assert_ne!(result.exit_code, 0, "{name} {command}");
                assert_eq!(png, b"existing", "{name} {command}");
                continue;
            }
            assert_eq!(result.exit_code, 0, "{name} {command}: {}", result.stderr);
            let digest = safe_bash_rust::commands::archive::sha256_bytes(&png)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>();
            assert!(
                include_str!("fixtures/indexed/png-sha256.txt")
                    .lines()
                    .any(|line| line == format!("{name} {command} {digest}")),
                "native/Wasm PNG parity: {name} {command}"
            );
            if name == "interpolate" {
                fs.write_file(
                    "/input.pdf",
                    include_bytes!("fixtures/indexed/rgb-interpolate.pdf"),
                )
                .unwrap();
                let rgb =
                    try_run_archive_command(command, &args, "", "/", &Default::default(), &fs)
                        .unwrap();
                assert_eq!(rgb.exit_code, 0, "{}", rgb.stderr);
                assert_eq!(
                    png,
                    fs.read_file("/page.png").unwrap(),
                    "{command}: interpolate colors, not indices"
                );
            }
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
            for line in include_str!("fixtures/indexed/pixels.txt")
                .lines()
                .chain(include_str!("fixtures/indexed/spec-pixels.txt").lines())
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
