use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn shell(fs: &MemoryVfs) -> Shell {
    Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    )
}

#[test]
fn zip_preserves_access_time_only_in_local_timestamp_metadata() {
    let fs = MemoryVfs::new();
    fs.write_file("/file", b"a").unwrap();
    fs.set_times("/file", Some(1_700_000_002_000.), Some(1_700_000_000_000.))
        .unwrap();
    let mut sh = shell(&fs);
    let result = sh.exec("zip -0q out.zip file").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let bytes = fs.read_file("/out.zip").unwrap();
    let local = 30 + 4;
    assert_eq!(&bytes[local..local + 5], b"UT\x09\0\x03");
    assert_eq!(
        &bytes[local + 5..local + 9],
        &1_700_000_000u32.to_le_bytes()
    );
    assert_eq!(
        &bytes[local + 9..local + 13],
        &1_700_000_002u32.to_le_bytes()
    );
    let central = bytes.windows(4).position(|b| b == b"PK\x01\x02").unwrap() + 46 + 4;
    assert_eq!(&bytes[central..central + 5], b"UT\x05\0\x01");
    assert_eq!(sh.exec("unzip -t out.zip").unwrap().exit_code, 0);
}

#[test]
fn unzip_listing_uses_month_day_year() {
    let fs = MemoryVfs::new();
    fs.write_file("/file", b"a").unwrap();
    fs.set_times("/file", None, Some(1_700_000_000_000.))
        .unwrap();
    let mut sh = shell(&fs);
    assert_eq!(sh.exec("zip -0q out.zip file").unwrap().exit_code, 0);
    for option in ["-l", "-v"] {
        let result = sh.exec(&format!("unzip {option} out.zip")).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert!(
            result.stdout.contains("11-14-2023 22:13"),
            "{}",
            result.stdout
        );
    }
}

#[test]
fn unzip_updates_use_extended_timestamp_precision_when_available() {
    let fs = MemoryVfs::new();
    let mut sh = shell(&fs);
    for (extra, expected) in [("", &b"new"[..]), ("-X", &b"old"[..])] {
        fs.write_file("/file", b"new").unwrap();
        fs.set_times("/file", None, Some(1_700_000_000_000.))
            .unwrap();
        let result = sh.exec(&format!("zip -0q {extra} out.zip file")).unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        fs.write_file("/file", b"old").unwrap();
        fs.set_times("/file", None, Some(1_699_999_999_999.))
            .unwrap();
        let result = sh.exec("unzip -ouq out.zip").unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(fs.read_file("/file").unwrap(), expected, "extra={extra}");
        assert_eq!(sh.exec("rm out.zip").unwrap().exit_code, 0);
    }
}

#[test]
fn compression_errors_identify_named_and_standard_input() {
    let fs = MemoryVfs::new();
    fs.write_file("/input", b"").unwrap();
    let mut sh = shell(&fs);
    for (command, source, code) in [
        ("bunzip2 -c /input", "/input", 2),
        ("bunzip2 < /input", "(stdin)", 2),
        ("zstdcat /input", "/input", 1),
        ("zstdcat < /input", "stdin", 1),
    ] {
        let result = sh.exec(command).unwrap();
        assert_eq!(result.exit_code, code, "{command}");
        let name = command.split_whitespace().next().unwrap();
        assert_eq!(
            result.stderr,
            format!("{name}: {source}: unexpected end of file\n")
        );
    }
}

#[test]
fn bzip2_distinguishes_unrecognized_input_from_corrupt_data() {
    let fs = MemoryVfs::new();
    let mut sh = shell(&fs);
    for (input, message) in [
        (
            &b"plain"[..],
            "bad magic number (file not created by bzip2)",
        ),
        (&b"BZh9\0\0\0\0\0\0"[..], "data integrity (CRC) error"),
    ] {
        fs.write_file("/input", input).unwrap();
        let result = sh.exec("bunzip2 -c /input").unwrap();
        assert_eq!(result.exit_code, 2);
        assert_eq!(result.stderr, format!("bunzip2: /input: {message}\n"));
        assert_eq!(fs.read_file("/input").unwrap(), input);
    }
}

#[test]
fn tar_ignores_unknown_pax_metadata_but_rejects_unsupported_member_semantics() {
    let fs = MemoryVfs::new();
    fs.write_file("/file", b"a").unwrap();
    let mut sh = shell(&fs);
    assert_eq!(
        sh.exec("tar --format=ustar -cf seed file")
            .unwrap()
            .exit_code,
        0
    );
    let seed = fs.read_file("/seed").unwrap();
    for (value, error) in [
        ("alien=x\n", None),
        ("GNU.sparse.size=1\n", Some("GNU.sparse.size")),
        ("SCHILY.realsize=1\n", Some("SCHILY.realsize")),
    ] {
        // Derive PAX framing from the key/value rather than assuming digit count.
        let mut size = value.len() + 2;
        loop {
            let next = value.len() + size.to_string().len() + 1;
            if next == size {
                break;
            }
            size = next;
        }
        let record = format!("{size} {value}");
        let mut head = seed[..512].to_vec();
        head[156] = b'x';
        head[124..136].copy_from_slice(format!("{:011o}\0", record.len()).as_bytes());
        head[148..156].fill(b' ');
        let sum: u32 = head.iter().map(|&b| u32::from(b)).sum();
        head[148..156].copy_from_slice(format!("{sum:06o}\0 ").as_bytes());
        let mut input = head;
        input.extend_from_slice(record.as_bytes());
        input.resize(1024, 0);
        input.extend_from_slice(&seed);
        fs.write_file("/out", &input).unwrap();
        let result = sh.exec("tar rf out file").unwrap();
        if let Some(key) = error {
            assert_eq!(result.exit_code, 2);
            assert_eq!(
                result.stderr,
                format!("tar: unsupported PAX keyword: {key}\n")
            );
            assert_eq!(fs.read_file("/out").unwrap(), input);
        } else {
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            assert!(fs.read_file("/out").unwrap().starts_with(&input[..2048]));
        }
    }
}
