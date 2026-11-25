use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn qpdf_zero_and_nonnumeric_split_groups_preserve_existing_split_files() {
    let input = include_bytes!("fixtures/qpdf-rewrite.pdf");
    for group in ["0", "-0", "junk", "", "+", "\u{85}2", "0x10"] {
        let fs = Arc::new(MemoryVfs::new());
        fs.write_file("/in.pdf", input).unwrap();
        fs.write_file("/out-1.pdf", b"existing split").unwrap();
        let mut shell = Shell::new(
            fs.clone(),
            ShellOptions {
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        let result = shell
            .exec(&format!(
                "qpdf in.pdf --split-pages '--split-pages={group}' out.pdf"
            ))
            .unwrap();
        assert_eq!(
            (
                result.exit_code,
                result.stdout.as_str(),
                result.stderr.as_str()
            ),
            (0, "", ""),
            "{group}"
        );
        assert_eq!(fs.read_file("/in.pdf").unwrap(), input);
        assert_eq!(fs.read_file("/out-1.pdf").unwrap(), b"existing split");
        assert_eq!(fs.read_file("/out.pdf").unwrap(), input);
        assert!(!fs.exists("/out-2.pdf"));
        assert!(!result.used_typescript_bridge);
    }
}

#[test]
fn qpdf_negative_split_groups_fail_before_inspection_or_output() {
    let input = include_bytes!("fixtures/qpdf-rewrite.pdf");
    let overflow = format!("-{}", "9".repeat(400));
    for (group, number) in [
        ("-1", "-1"),
        ("-1junk", "-1"),
        ("-2147483648", "-2147483648"),
        ("-2147483649", "-2147483649"),
        ("-9223372036854775809", "-9223372036854776000"),
        ("-1000000000000000000000", "-1e+21"),
        (overflow.as_str(), "-Infinity"),
    ] {
        for tail in [
            "out.pdf",
            "--show-npages",
            "--split-pages=2 out.pdf",
            "--split-pages=0 --replace-input",
        ] {
            let fs = Arc::new(MemoryVfs::new());
            fs.write_file("/in.pdf", input).unwrap();
            fs.write_file("/out.pdf", b"existing output").unwrap();
            fs.write_file("/out-1.pdf", b"existing split").unwrap();
            let before = fs.read_dir("/").unwrap();
            let mut shell = Shell::new(
                fs.clone(),
                ShellOptions {
                    mode: BackendMode::NativeOnly,
                    ..Default::default()
                },
            );
            let result = shell
                .exec(&format!("qpdf in.pdf '--split-pages={group}' {tail}"))
                .unwrap();
            assert_eq!(
                (result.exit_code, result.stdout.as_str()),
                (2, ""),
                "{group}: {tail}"
            );
            assert_eq!(
                result.stderr,
                format!(
                    "qpdf: integer out of range converting {number} from a 4-byte signed type to a 8-byte unsigned type\n"
                )
            );
            assert_eq!(fs.read_file("/in.pdf").unwrap(), input);
            assert_eq!(fs.read_file("/out.pdf").unwrap(), b"existing output");
            assert_eq!(fs.read_file("/out-1.pdf").unwrap(), b"existing split");
            assert_eq!(fs.read_dir("/").unwrap(), before);
            assert!(!result.used_typescript_bridge);
        }
    }
}

#[test]
fn qpdf_split_names_use_literal_percent_d_without_changing_extensions() {
    for (template, first, last) in [
        ("out-%02d.pdf", "out-%02d-1-2.pdf", "out-%02d-3-3.pdf"),
        ("out-%%d.pdf", "out-%1-2.pdf", "out-%3-3.pdf"),
        ("out-%%-%d-%d.pdf", "out-%%-1-2-%d.pdf", "out-%%-3-3-%d.pdf"),
        ("out.PDF", "out-1-2.PDF", "out-3-3.PDF"),
        ("out", "out-1-2", "out-3-3"),
    ] {
        let fs = Arc::new(MemoryVfs::new());
        fs.write_file("/in.html", b"<p>content</p>").unwrap();
        let mut sh = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
        let source = sh.exec("wkhtmltopdf /in.html /in.html /in.html /in.pdf").unwrap();
        assert_eq!(source.exit_code, 0, "{source:?}");
        let original = fs.read_file("/in.pdf").unwrap();
        let result = sh.exec(&format!("qpdf /in.pdf --split-pages=2 /{template}")).unwrap();
        assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (0, "", ""), "{template}");
        for (file, pages) in [(first, "2\n"), (last, "1\n")] {
            let check = sh.exec(&format!("qpdf /{file} --show-npages")).unwrap();
            assert_eq!((check.exit_code, check.stdout.as_str(), check.stderr.as_str()), (0, pages, ""), "{file}");
        }
        assert_eq!(fs.read_file("/in.pdf").unwrap(), original);
        let mut names = fs.read_dir("/").unwrap();
        names.sort();
        let mut expected = vec!["dev".to_owned(), "in.html".to_owned(), "in.pdf".to_owned(), first.to_owned(), last.to_owned()];
        expected.sort();
        assert_eq!(names, expected);
    }
}
