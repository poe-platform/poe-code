use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

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
