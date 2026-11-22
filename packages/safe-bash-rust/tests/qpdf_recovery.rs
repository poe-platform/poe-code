use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn document(length: &str, filter: &str, xref: bool) -> (Vec<u8>, usize) {
    let mut text = String::from("%PDF-1.4\n");
    let mut offsets = Vec::new();
    for (i, object) in [
        "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Contents 4 0 R >>".to_owned(),
        format!("<< {length} {filter} >>\nstream\nABCDEF\nendstream"),
    ].iter().enumerate() {
        offsets.push(text.len());
        text.push_str(&format!("{} 0 obj\n{object}\nendobj\n", i + 1));
    }
    let stream = text.find("ABCDEF").unwrap();
    let at = text.len();
    if xref {
        text.push_str("xref\n0 5\n0000000000 65535 f \n");
        for offset in offsets { text.push_str(&format!("{offset:010} 00000 n \n")); }
    }
    text.push_str(&format!("trailer << /Size 5 /Root 1 0 R >>\nstartxref\n{at}\n%%EOF"));
    (text.into_bytes(), stream)
}

#[test]
fn qpdf_reports_recovery_without_losing_output() {
    let fs = Arc::new(MemoryVfs::new());
    let mut sh = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    for length in ["/Length 2", "", "/Length 1 /Length 2"] {
        let (bytes, offset) = document(length, "", true);
        fs.write_file("/in", &bytes).unwrap();
        let warning = format!("WARNING: in: Recovered stream length at byte offset {offset}\nqpdf: operation succeeded with warnings\n");
        for mode in ["--show-npages", "--check", "--show-object=4", "--show-object=4 --raw-stream-data", "out", "--pages . 1 -- out"] {
            for flag in ["", "--warning-exit-0"] {
                let result = sh.exec(&format!("qpdf in {mode} {flag}")).unwrap();
                assert_eq!(result.exit_code, if flag.is_empty() { 3 } else { 0 }, "{mode}: {result:?}");
                assert_eq!(result.stderr, warning, "{mode}");
                if mode == "--show-object=4 --raw-stream-data" { assert_eq!(result.stdout, "ABCDEF"); }
                if mode == "--check" { assert!(!result.stdout.contains("No syntax or stream encoding errors")); }
                if mode.ends_with("out") {
                    let pages = sh.exec("qpdf out --show-pages").unwrap();
                    assert_eq!((pages.exit_code, pages.stderr.as_str()), (0, ""));
                    let content = pages.stdout.split("  content:\n").nth(1).unwrap().split_whitespace().next().unwrap();
                    let check = sh.exec(&format!("qpdf out --show-object={content} --filtered-stream-data")).unwrap();
                    assert_eq!((check.exit_code, check.stdout.as_str(), check.stderr.as_str()), (0, "ABCDEF", ""));
                }
            }
        }
    }
}

#[test]
fn qpdf_warns_on_xref_reconstruction_but_does_not_decode_inspection_streams() {
    let fs = Arc::new(MemoryVfs::new());
    let mut sh = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    for xref in [false, true] {
        let (bytes, _) = document("/Length 6", "/Filter /FlateDecode", xref);
        fs.write_file("/in", &bytes).unwrap();
        let result = sh.exec("qpdf in --show-object=4 --raw-stream-data").unwrap();
        assert_eq!(result.stdout, "ABCDEF");
        assert_eq!(result.exit_code, if xref { 0 } else { 3 });
        assert_eq!(result.stderr, if xref { "" } else { "WARNING: in: Damaged cross-reference data; reconstructing cross-reference table\nqpdf: operation succeeded with warnings\n" });
    }
}

#[test]
fn qpdf_reports_missing_page_tree_without_recovery_success_warnings() {
    let fs = Arc::new(MemoryVfs::new());
    let mut sh = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    for bytes in [
        &b"prefix\n%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n"[..],
        &b"%PDF-1.7\n12 0 obj << /Title (no catalog) >> endobj\ntrailer << /Root 12 0 R >>"[..],
        &b"%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 12 0 R >> endobj\n"[..],
    ] {
        fs.write_file("/in", bytes).unwrap();
        fs.write_file("/out", b"original").unwrap();
        for mode in ["--show-npages", "--show-xref", "--check", "--json --json-key=pages out", "out"] {
            let result = sh.exec(&format!("qpdf in {mode}")).unwrap();
            assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()),
                (2, "", "qpdf: in: unable to find page tree\n"), "{mode}");
            assert_eq!(fs.read_file("/out").unwrap(), b"original");
        }
        let result = sh.exec("cat in | qpdf - --json=1 --json-key=qpdf out").unwrap();
        assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()),
            (2, "", "qpdf: -: unable to find page tree\n"));
        assert_eq!(fs.read_file("/out").unwrap(), b"original");
    }
    fs.write_file("/in", b"%PDF-1.7\n12 0 obj << /Title (no catalog) >> endobj\n").unwrap();
    let result = sh.exec("qpdf in --show-npages").unwrap();
    assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()),
        (2, "", "qpdf: in: Unable to repair PDF: no /Type /Catalog object found\n"));
}
