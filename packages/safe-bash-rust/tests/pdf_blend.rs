use safe_bash_rust::{
    MemoryVfs, SafeBashFs,
    commands::{archive::try_run_archive_command, codecs::inflate_raw},
};
const PDF: &[u8] = include_bytes!("fixtures/blend-modes.pdf");

#[test]
fn blend_modes_cover_paints_alpha_and_scopes() {
    let mut array = PDF.to_vec();
    let at = array
        .windows(15)
        .position(|w| w == b"/BM /Difference")
        .unwrap()
        + 4;
    array[at..at + 11].copy_from_slice(b"[/Multiply]");
    for (input, last) in [(PDF, [255, 0, 255]), (array.as_slice(), [0, 0, 0])] {
        for command in ["pdftoppm", "pdftocairo"] {
            let fs = MemoryVfs::new();
            fs.write_file("/input.pdf", input).unwrap();
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
            for (row, blend) in [[0u8, 0, 255], [0, 0, 0], [255, 0, 255], last]
                .into_iter()
                .enumerate()
            {
                let y = 85 - row * 20;
                for (column, x) in [8, 28, 48, 68, 84, 108, 128, 148, 168, 188]
                    .into_iter()
                    .enumerate()
                {
                    let expected = match column {
                        5 => [255, 0, 255],
                        7 => [
                            (255 + u16::from(blend[0])).div_ceil(2) as u8,
                            0,
                            blend[2].div_ceil(2),
                        ],
                        8 => [0, 0, 255],
                        _ => blend,
                    };
                    let at = y * (200 * channels + 1) + 1 + x * channels;
                    let pixel = &raw[at..at + 3];
                    for i in 0..3 {
                        assert!(
                            pixel[i].abs_diff(expected[i]) <= 2,
                            "{command} ({x},{y}): {pixel:?}, expected {expected:?}"
                        );
                    }
                }
            }
            let at = 5 * (200 * channels + 1) + 1 + 8 * channels;
            assert_eq!(&raw[at..at + 3], &[0, 255, 0]);
        }
    }
}

#[test]
fn invalid_blend_preserves_output() {
    for value in [
        "/Unknown ",
        "123456789",
        "[]       ",
        "[/Bad]   ",
        "null     ",
        "9 0 R    ",
        "[/Bad 1] ",
    ] {
        let mut bytes = PDF.to_vec();
        let at = bytes.windows(9).position(|w| w == b"/Multiply").unwrap();
        let at = bytes[at + 9..]
            .windows(9)
            .position(|w| w == b"/Multiply")
            .unwrap()
            + at
            + 9;
        bytes[at..at + 9].copy_from_slice(value.as_bytes());
        for command in ["pdftoppm", "pdftocairo"] {
            let fs = MemoryVfs::new();
            fs.write_file("/input.pdf", &bytes).unwrap();
            fs.write_file("/page.png", b"existing").unwrap();
            let args =
                ["-png", "-r", "72", "-singlefile", "/input.pdf", "/page"].map(str::to_owned);
            let result =
                try_run_archive_command(command, &args, "", "/", &Default::default(), &fs).unwrap();
            assert_ne!(result.exit_code, 0, "{command}: {value}");
            assert_eq!(fs.read_file("/page.png").unwrap(), b"existing");
        }
    }
}
