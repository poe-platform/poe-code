use safe_bash_rust::{MemoryVfs, SafeBashFs, commands::archive::try_run_archive_command};

// Pillow/libpng-compatible 8x6 RGBA fixture, every pixel (230,40,80,255).
const PNG: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 8, 0, 0, 0, 6, 8, 6, 0,
    0, 0, 254, 5, 223, 251, 0, 0, 0, 22, 73, 68, 65, 84, 120, 156, 99, 124, 166, 17, 240, 159, 1,
    15, 96, 194, 39, 57, 88, 20, 0, 0, 211, 69, 2, 105, 155, 13, 34, 220, 0, 0, 0, 0, 73, 69, 78,
    68, 174, 66, 96, 130,
];

#[test]
fn damaged_critical_png_checksums_do_not_publish_output() {
    for chunk in [b"IHDR", b"IDAT", b"IEND"] {
        let mut bytes = PNG.to_vec();
        let mut at = 8;
        while at < bytes.len() {
            let len = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
            if &bytes[at + 4..at + 8] == chunk {
                bytes[at + 8 + len] ^= 1;
                break;
            }
            at += len + 12;
        }
        for existing in [false, true] {
            let fs = MemoryVfs::new();
            fs.write_file("/source.png", &bytes).unwrap();
            if existing {
                fs.write_file("/result.png", b"existing output").unwrap();
            }
            let args = ["/source.png", "/result.png"].map(String::from);
            let out = try_run_archive_command("convert", &args, "", "/", &Default::default(), &fs)
                .unwrap();
            assert_ne!(out.exit_code, 0, "accepted damaged {:?}", chunk);
            assert!(out.stderr.contains("CRC"), "{}", out.stderr);
            if existing {
                assert_eq!(fs.read_file("/result.png").unwrap(), b"existing output");
            } else {
                assert!(!fs.exists("/result.png"));
            }
        }
    }
    let fs = MemoryVfs::new();
    fs.write_file("/source.png", PNG).unwrap();
    let args = ["/source.png", "/result.png"].map(String::from);
    let out = try_run_archive_command("convert", &args, "", "/", &Default::default(), &fs).unwrap();
    assert_eq!(out.exit_code, 0, "{}", out.stderr);
    assert!(fs.exists("/result.png"));
}

#[test]
fn incomplete_iend_checksums_do_not_publish_output() {
    for missing in 1..=4 {
        for existing in [false, true] {
            let fs = MemoryVfs::new();
            fs.write_file("/source.png", &PNG[..PNG.len() - missing])
                .unwrap();
            if existing {
                fs.write_file("/result.png", b"existing output").unwrap();
            }
            let args = ["/source.png", "/result.png"].map(String::from);
            let out = try_run_archive_command("convert", &args, "", "/", &Default::default(), &fs)
                .unwrap();
            assert_ne!(
                out.exit_code, 0,
                "accepted IEND missing {missing} CRC bytes"
            );
            assert!(out.stderr.contains("Truncated"), "{}", out.stderr);
            if existing {
                assert_eq!(fs.read_file("/result.png").unwrap(), b"existing output");
            } else {
                assert!(!fs.exists("/result.png"));
            }
        }
    }
}

#[test]
fn ancillary_crc_errors_skip_metadata_but_keep_pixels() {
    // Independent pHYs chunk specifying 144 DPI (5669 pixels per meter).
    const PHYS: &[u8] = &[
        0, 0, 0, 9, 112, 72, 89, 115, 0, 0, 22, 37, 0, 0, 22, 37, 1, 73, 82, 36, 240,
    ];
    for corrupt in [false, true] {
        let mut bytes = PNG[..33].to_vec();
        bytes.extend_from_slice(PHYS);
        if corrupt {
            *bytes.last_mut().unwrap() ^= 1;
        }
        bytes.extend_from_slice(&PNG[33..]);
        let fs = MemoryVfs::new();
        fs.write_file("/source.png", &bytes).unwrap();
        let args = ["-format", "%w %h %x", "/source.png"].map(String::from);
        let info =
            try_run_archive_command("identify", &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(info.exit_code, 0, "{}", info.stderr);
        assert_eq!(info.stdout, if corrupt { "8 6 72" } else { "8 6 144" });
        let args = ["/source.png", "/result.ppm"].map(String::from);
        let out =
            try_run_archive_command("convert", &args, "", "/", &Default::default(), &fs).unwrap();
        assert_eq!(out.exit_code, 0, "{}", out.stderr);
        let ppm = fs.read_file("/result.ppm").unwrap();
        let header = b"P6\n8 6\n255\n";
        assert!(ppm.starts_with(header));
        assert_eq!(&ppm[header.len()..], [230, 40, 80].repeat(8 * 6));
    }
}
