use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn document(content: &[u8], filter: &str) -> Vec<u8> {
    let mut bodies = vec![
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec(),
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>".to_vec(),
    ];
    let mut stream = format!("<< /Length {} {filter} >>\nstream\n", content.len()).into_bytes();
    stream.extend_from_slice(content); stream.extend_from_slice(b"\nendstream"); bodies.push(stream);
    let mut out = b"%PDF-1.4\n".to_vec(); let mut offsets = Vec::new();
    for (i, body) in bodies.iter().enumerate() {
        offsets.push(out.len()); out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
        out.extend_from_slice(body); out.extend_from_slice(b"\nendobj\n");
    }
    let start = out.len(); out.extend_from_slice(b"xref\n0 5\n0000000000 65535 f \n");
    for offset in offsets { out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes()); }
    out.extend_from_slice(format!("trailer << /Size 5 /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n").as_bytes());
    out
}

#[test]
fn rewrite_compresses_unfiltered_streams_with_canonical_dictionary_order() {
    let fs = Arc::new(MemoryVfs::new());
    fs.write_file("/in", &document(b"q Q", "")).unwrap();
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    let result = shell.exec("qpdf in out").unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
    let output = fs.read_file("/out").unwrap();
    assert!(output.windows(b"/Filter /FlateDecode\n/Length ".len()).any(|w| w == b"/Filter /FlateDecode\n/Length "));
    let stream = shell.exec("qpdf out --show-object=4 --filtered-stream-data").unwrap();
    assert_eq!((stream.exit_code, stream.stdout.as_str()), (0, "q Q"));
}

#[test]
fn normalization_decodes_contents_and_preserves_inline_image_bytes() {
    let fs = Arc::new(MemoryVfs::new());
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    for (content, filter, expected) in [
        (b"710d0a510d>".as_slice(), "/Filter /ASCIIHexDecode", b"q\nQ\n".as_slice()),
        (b"q\r\nBI /W 2 /H 1 /CS /G /BPC 8 ID \r\n EI\r\nQ\r".as_slice(), "", b"q\nBI /W 2 /H 1 /CS /G /BPC 8 ID \r\n EI\nQ\n".as_slice()),
    ] {
        fs.write_file("/in", &document(content, filter)).unwrap();
        let result = shell.exec("qpdf in --stream-data=uncompress out").unwrap();
        assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
        let result = shell.exec("qpdf out --show-object=4 --raw-stream-data").unwrap();
        assert_eq!((result.exit_code, safe_bash_rust::vfs::stream_string_to_bytes(&result.stdout)), (0, expected.to_vec()));
    }
}

#[test]
fn rewrite_drops_stale_object_stream_containers_but_preserves_members() {
    let fs = Arc::new(MemoryVfs::new());
    fs.write_file("/in", include_bytes!("../../safe-bash-command-qpdf/src/fixtures/compressed-pages.pdf")).unwrap();
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    let result = shell.exec("qpdf in out").unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
    assert!(!fs.read_file("/out").unwrap().windows(13).any(|w| w == b"/Type /ObjStm\n"));
    let pages = shell.exec("qpdf out --show-npages").unwrap();
    assert_eq!((pages.exit_code, pages.stdout.as_str(), pages.stderr.as_str()), (0, "3\n", ""));
}

#[test]
fn split_completes_form_placeholders_before_writing_valid_pdf_objects() {
    let fs = Arc::new(MemoryVfs::new());
    // Input and exact outputs independently captured from the JavaScript qpdf
    // retained path: inherited resources, rotations, Unicode metadata and forms.
    let input = include_bytes!("fixtures/qpdf-split-form.pdf");
    fs.write_file("/in", input).unwrap();
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    let result = shell.exec("qpdf in --split-pages part-%d.pdf").unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
    for (page, expected) in [include_bytes!("fixtures/qpdf-split-form-page-1.pdf").as_slice(), include_bytes!("fixtures/qpdf-split-form-page-2.pdf").as_slice(), include_bytes!("fixtures/qpdf-split-form-page-3.pdf").as_slice()].into_iter().enumerate() {
        let got = fs.read_file(&format!("/part-{}.pdf", page + 1)).unwrap();
        assert!(got == expected, "page {}: first differing byte {:?}", page + 1, got.iter().zip(expected).position(|(a,b)|a!=b));
    }
    assert_eq!(fs.read_file("/in").unwrap(), input);
}

#[test]
fn attachments_are_removed_by_key_and_failed_removals_preserve_destination() {
    let fs = Arc::new(MemoryVfs::new());
    fs.write_file("/in", &document(b"q Q", "")).unwrap(); fs.write_file("/data", b"attachment").unwrap();
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    assert_eq!(shell.exec("qpdf in --add-attachment data --key=one --filename=report.txt -- attached").unwrap().exit_code, 0);
    let input = fs.read_file("/attached").unwrap();
    fs.write_file("/out", b"preserved").unwrap();
    for destination in ["out", "absent"] {
        let result = shell.exec(&format!("qpdf attached --remove-attachment=report.txt {destination}")).unwrap();
        assert_eq!((result.exit_code, result.stderr.as_str()), (2, "qpdf: attachment report.txt not found\n"));
        assert_eq!(fs.read_file("/out").unwrap(), b"preserved"); assert!(fs.read_file("/absent").is_err());
        assert_eq!(fs.read_file("/attached").unwrap(), input);
    }
    assert_eq!(shell.exec("qpdf attached --remove-attachment=one out").unwrap().exit_code, 0);
    assert_eq!(shell.exec("qpdf out --list-attachments").unwrap().stdout, "out has no embedded files\n");
}

#[test]
fn pdfunite_omits_document_metadata_from_the_merged_output() {
    let fs = Arc::new(MemoryVfs::new());
    fs.write_file("/in", include_bytes!("fixtures/qpdf-split-form.pdf")).unwrap();
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    let result = shell.exec("pdfunite in in out").unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
    let info = shell.exec("qpdf out --show-object=3").unwrap();
    assert_eq!((info.exit_code, info.stdout.as_str()), (0, "<<  >>\n"));
    assert!(!shell.exec("qpdf out --show-object=trailer").unwrap().stdout.contains("/Info"));
    assert_eq!(shell.exec("qpdf out --show-npages").unwrap().stdout, "6\n");
}

#[test]
fn overlays_repeat_source_pages_only_with_an_explicit_repeat_range() {
    let fs = Arc::new(MemoryVfs::new());
    fs.write_file("/base", &document(b"BT (Base) Tj ET", "")).unwrap();
    fs.write_file("/layer", &document(b"BT (Layer) Tj ET", "")).unwrap();
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    assert_eq!(shell.exec("pdfunite base base base in").unwrap().exit_code, 0);
    for (repeat, expected) in [("", 1), ("--repeat=1", 3)] {
        let result = shell.exec(&format!("qpdf in --overlay layer {repeat} -- out")).unwrap();
        assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
        let pages = shell.exec("qpdf out --show-pages").unwrap();
        let mut count = 0;
        for page in pages.stdout.split("  content:\n").skip(1) {
            let id = page.split_whitespace().next().unwrap();
            let content = shell.exec(&format!("qpdf out --show-object={id} --filtered-stream-data")).unwrap();
            assert_eq!(content.exit_code, 0);
            count += usize::from(content.stdout.contains("Layer"));
        }
        assert_eq!(count, expected, "{repeat}");
    }
}
