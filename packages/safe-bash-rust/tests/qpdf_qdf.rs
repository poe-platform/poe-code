use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellLimits, ShellOptions};
use std::sync::Arc;

#[test]
fn qdf_matches_javascript_with_sparse_ids_comments_and_binary_streams() {
    let fs = Arc::new(MemoryVfs::new());
    let input = include_bytes!("fixtures/qdf-input.pdf");
    let expected = include_bytes!("fixtures/qdf-output.pdf");
    fs.write_file("/in", input).unwrap();
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    for options in ["--qdf --normalize-content=n", "--object-streams=generate --qdf --normalize-content=n"] {
        let result = shell.exec(&format!("qpdf in {options} out")).unwrap();
        assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (0, "", ""), "{options}");
        let actual = fs.read_file("/out").unwrap();
        assert_eq!(actual.len(), expected.len(), "{options}");
        assert_eq!(actual.iter().zip(expected).position(|(a,b)| a != b), None, "{options}");
        for (object, bytes) in [(7, b"".as_slice()), (9, b"q Q"), (11, b"q\r\nQ\r\n"), (13, b"\0\xff\x80\nendstream\n")] {
            let result = shell.exec(&format!("qpdf out --show-object={object} --raw-stream-data > stream")).unwrap();
            assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
            assert_eq!(fs.read_file("/stream").unwrap(), bytes);
        }
        assert_eq!(fs.read_file("/in").unwrap(), input);
    }
}

#[test]
fn qdf_output_limit_admits_exact_size_and_preserves_destination_below_it() {
    let fs = Arc::new(MemoryVfs::new());
    let input = include_bytes!("fixtures/qdf-input.pdf");
    let expected = include_bytes!("fixtures/qdf-output.pdf");
    fs.write_file("/in", input).unwrap();
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    shell.set_limits(ShellLimits { max_output_bytes: expected.len(), ..Default::default() });
    let result = shell.exec("qpdf in --qdf --normalize-content=n out").unwrap();
    assert_eq!((result.exit_code, result.stderr.as_str()), (0, ""));
    assert_eq!(fs.read_file("/out").unwrap(), expected);
    for destination in ["out", "absent"] {
        shell.set_limits(ShellLimits { max_output_bytes: expected.len() - 1, ..Default::default() });
        let result = shell.exec(&format!("qpdf in --qdf --normalize-content=n {destination}")).unwrap();
        assert_ne!(result.exit_code, 0);
        assert!(result.stderr.contains("limit"), "{}", result.stderr);
        assert_eq!(fs.read_file("/out").unwrap(), expected);
        assert!(fs.read_file("/absent").is_err());
        assert_eq!(fs.read_file("/in").unwrap(), input);
    }
}
