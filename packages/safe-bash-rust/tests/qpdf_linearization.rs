use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn linearization_writes_real_page_and_shared_hints_with_two_xrefs() {
    let fs = Arc::new(MemoryVfs::new());
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    fs.write_file("/in.pdf", include_bytes!("fixtures/linearize-input.pdf")).unwrap();
    fs.write_file("/note", b"note").unwrap();
    let result = shell.exec("qpdf in.pdf --linearize --add-attachment note -- out.pdf").unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
    let bytes = fs.read_file("/out.pdf").unwrap();
    let expected = include_bytes!("fixtures/linearize-output.pdf");
    assert_eq!(bytes.len(), expected.len());
    assert_eq!(bytes.iter().zip(expected).position(|(a,b)|a!=b), None);
    let report = shell.exec("qpdf out.pdf --show-linearization").unwrap();
    assert_eq!((report.exit_code, report.stderr.as_str()), (0, ""));
    assert_eq!(report.stdout, include_str!("fixtures/linearize-report.txt"));
    let repeated = shell.exec("qpdf out.pdf --linearize again.pdf").unwrap();
    assert_eq!((repeated.exit_code, repeated.stderr.as_str()), (0, ""));
    assert_eq!(fs.read_file("/again.pdf").unwrap(), bytes);
}

#[test]
fn linearization_reports_existing_native_hint_tables_and_plain_documents() {
    let fs = Arc::new(MemoryVfs::new());
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    fs.write_file("/out.pdf", include_bytes!("fixtures/linearize-output.pdf")).unwrap();
    let report = shell.exec("qpdf out.pdf --show-linearization").unwrap();
    assert_eq!((report.exit_code, report.stderr.as_str()), (0, ""));
    assert_eq!(report.stdout, include_str!("fixtures/linearize-report.txt"));
    fs.write_file("/plain", include_bytes!("fixtures/linearize-input.pdf")).unwrap();
    let plain = shell.exec("qpdf plain --show-linearization").unwrap();
    assert_eq!((plain.exit_code, plain.stdout.as_str(), plain.stderr.as_str()), (0, "plain is not linearized\n", ""));
}

#[test]
fn linearization_preserves_requested_object_streams_in_the_remaining_section() {
    let fs = Arc::new(MemoryVfs::new());
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    fs.write_file("/in.pdf", include_bytes!("fixtures/linearize-input.pdf")).unwrap();
    fs.write_file("/note", b"note").unwrap();
    let result = shell.exec("qpdf in.pdf --linearize --object-streams=generate --add-attachment note -- out.pdf").unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
    let bytes = fs.read_file("/out.pdf").unwrap();
    let expected = include_bytes!("fixtures/linearize-packed.pdf");
    assert_eq!(bytes.len(), expected.len());
    assert_eq!(bytes.iter().zip(expected).position(|(a,b)|a!=b), None);
    assert_eq!(shell.exec("qpdf out.pdf --show-npages").unwrap().stdout, "2\n");
}

#[test]
fn linearization_reports_independent_qpdf_bit_packed_hints_and_object_placement() {
    let fs = Arc::new(MemoryVfs::new());
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    fs.write_file("/in.pdf", include_bytes!("../../safe-bash-command-qpdf/src/fixtures/linearized.pdf")).unwrap();
    let report = shell.exec("qpdf in.pdf --show-linearization").unwrap();
    assert_eq!((report.exit_code, report.stderr.as_str()), (0, ""));
    assert_eq!(report.stdout, include_str!("fixtures/native-linearize-report.txt"));
}

#[test]
fn linearization_checks_the_final_size_before_publishing_output() {
    let expected = include_bytes!("fixtures/linearize-output.pdf");
    for limit in [expected.len() - 1, expected.len()] {
        let fs = Arc::new(MemoryVfs::new());
        let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
        let input = include_bytes!("fixtures/linearize-input.pdf");
        fs.write_file("/in.pdf", input).unwrap();
        fs.write_file("/note", b"note").unwrap();
        fs.write_file("/out.pdf", b"original").unwrap();
        shell.set_limits(safe_bash_rust::budget::ShellLimits { max_output_bytes: limit, ..Default::default() });
        let result = shell.exec("qpdf in.pdf --linearize --add-attachment note -- out.pdf").unwrap();
        if limit == expected.len() {
            assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
            assert_eq!(fs.read_file("/out.pdf").unwrap(), expected);
        } else {
            assert_ne!(result.exit_code, 0);
            assert_eq!(fs.read_file("/out.pdf").unwrap(), b"original");
        }
        assert_eq!(fs.read_file("/in.pdf").unwrap(), input);
    }
}

#[test]
fn linearization_assignments_use_compressed_objects_containers() {
    let fs = Arc::new(MemoryVfs::new());
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    fs.write_file("/in.pdf", include_bytes!("fixtures/native-linearize-packed.pdf")).unwrap();
    let result = shell.exec("qpdf in.pdf --show-linearization").unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
    assert_eq!(result.stdout, include_str!("fixtures/native-linearize-packed-report.txt"));
}
