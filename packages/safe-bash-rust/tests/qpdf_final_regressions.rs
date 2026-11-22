use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn document() -> String {
    let mut text = String::from("%PDF-1.4\n");
    let mut offsets = Vec::new();
    for (i, body) in [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] >>",
    ].iter().enumerate() {
        offsets.push(text.len());
        text.push_str(&format!("{} 0 obj\n{body}\nendobj\n", i + 1));
    }
    let at = text.len();
    text.push_str("xref\n0 4\n0000000000 65535 f \n");
    for offset in offsets { text.push_str(&format!("{offset:010} 00000 n \n")); }
    text.push_str(&format!("trailer << /Size 4 /Root 1 0 R >>\nstartxref\n{at}\n%%EOF"));
    text
}

#[test]
fn qpdf_distinguishes_repaired_object_offsets_from_rebuilt_cross_references() {
    let fs = Arc::new(MemoryVfs::new());
    let original = document();
    let row = format!("{:010} 00000 n", original.find("3 0 obj").unwrap());
    fs.write_file("/in", original.replace(&row, "0000000001 00000 n").as_bytes()).unwrap();
    let mut shell = Shell::new(fs, ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    for option in ["--check", "--show-pages", "--show-xref", "--json --json-key=pages", "out"] {
        let result = shell.exec(&format!("qpdf in {option}")).unwrap();
        assert_eq!((result.exit_code, result.stderr.as_str()), (3,
            "WARNING: in: Recovered object 3 from damaged cross-reference data\nqpdf: operation succeeded with warnings\n"), "{option}");
        if option == "--show-xref" { assert!(result.stdout.ends_with("3/0: uncompressed; offset = 1\n")); }
        if option == "--check" { assert_eq!(result.stdout, "checking in\nPDF Version: 1.4\nFile is not encrypted\nFile is not linearized\n"); }
    }
}

#[test]
fn qpdf_does_not_replace_an_explicit_invalid_catalog_with_an_unreferenced_catalog() {
    let fs = Arc::new(MemoryVfs::new());
    fs.write_file("/in", document().replace("/Root 1 0 R", "/Root 2 0 R").as_bytes()).unwrap();
    fs.write_file("/out", b"preserved").unwrap();
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    for option in ["--check", "--show-pages", "--show-xref", "--json --json-key=pages out", "out"] {
        let result = shell.exec(&format!("qpdf in {option}")).unwrap();
        assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()),
            (2, "", "qpdf: in: unable to find page tree\n"), "{option}");
        assert_eq!(fs.read_file("/out").unwrap(), b"preserved");
    }
}

#[test]
fn qpdf_reconstructed_object_stream_members_report_their_recovered_value_types() {
    let values = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] >>",
        "[1 2]", "(text)", "42", "true", "/Name", "null", "1 0 R",
    ];
    let mut header = String::new();
    let mut body = String::new();
    for (i, value) in values.iter().enumerate() {
        header.push_str(&format!("{} {} ", i + 1, body.len()));
        body.push_str(value); body.push('\n');
    }
    let data = format!("{header}{body}");
    let source = format!("%PDF-1.5\n11 0 obj\n<< /Type /ObjStm /N 10 /First {} /Length {} >>\nstream\n{data}\nendstream\nendobj\ntrailer << /Root 1 0 R /Size 12 >>", header.len(), data.len());
    let fs = Arc::new(MemoryVfs::new()); fs.write_file("/in", source.as_bytes()).unwrap();
    let mut shell = Shell::new(fs, ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    let result = shell.exec("qpdf in --show-xref").unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (3,
        "WARNING: in: Damaged cross-reference data; reconstructing cross-reference table\nqpdf: operation succeeded with warnings\n"));
    assert_eq!(result.stdout, "1/0: uncompressed; type = dict\n2/0: uncompressed; type = dict\n3/0: uncompressed; type = dict\n4/0: uncompressed; type = array\n5/0: uncompressed; type = string\n6/0: uncompressed; type = number\n7/0: uncompressed; type = boolean\n8/0: uncompressed; type = name\n9/0: uncompressed; type = null\n10/0: uncompressed; type = ref\n11/0: uncompressed; offset = 9\n");
}

#[test]
fn qpdf_decryption_rewrites_alias_filters_using_the_original_dictionary() {
    let fs = Arc::new(MemoryVfs::new());
    // Independent JavaScript command output: ASCIIHexDecode, Crypt and FlateDecode
    // through /F and /DP aliases. Default compression retains alias entries while
    // adding the canonical Filter that describes the rewritten stream.
    let input = include_bytes!("fixtures/qpdf-crypt-chain.pdf");
    let expected = include_bytes!("fixtures/qpdf-crypt-chain-decrypted.pdf");
    fs.write_file("/in", input).unwrap();
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    let result = shell.exec("qpdf in --password=reader --decrypt out").unwrap();
    assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (0, "", ""));
    let actual = fs.read_file("/out").unwrap();
    assert_eq!(actual.len(), expected.len());
    assert_eq!(actual.iter().zip(expected).position(|(a,b)|a!=b), None);
    assert_eq!(fs.read_file("/in").unwrap(), input);
}
