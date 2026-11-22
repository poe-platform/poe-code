use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn missing_pdfdetach_option_values_fail_before_input_or_output_access() {
    let fs = Arc::new(MemoryVfs::new());
    fs.write_file("/out", b"original").unwrap();
    let mut shell = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    for flag in ["-save", "-savefile", "-o", "-upw", "-opw", "-enc"] {
        for prefix in ["missing.pdf", "-saveall -o out missing.pdf"] {
            let result = shell.exec(&format!("pdfdetach {prefix} {flag}")).unwrap();
            assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()),
                (99, "", "Usage: pdfdetach [options] <PDF-file>\n"), "{prefix} {flag}");
            assert_eq!(fs.read_file("/out").unwrap(), b"original");
        }
    }
}

#[test]
fn pdfdetach_rejects_invalid_file_numbers_and_extra_inputs_before_reading() {
    let fs = Arc::new(MemoryVfs::new());
    let mut shell = Shell::new(fs, ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    for value in ["x", "1x", "1.5", "", "+", "-", " 1", "0x1", "0", "-0", "9007199254740992", "-9007199254740992"] {
        let result = shell.exec(&format!("pdfdetach -save '{value}' missing.pdf")).unwrap();
        assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()),
            (99, "", "Usage: pdfdetach [options] <PDF-file>\n"), "{value:?}");
    }
    for operands in ["missing.pdf extra.pdf", "- missing.pdf", "-save -1 missing.pdf"] {
        let result = shell.exec(&format!("pdfdetach {operands}")).unwrap();
        let message = if operands.starts_with("-save") { "Command Line Error: Invalid file number\n" }
            else { "Usage: pdfdetach [options] <PDF-file>\n" };
        assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (99, "", message));
    }
    for value in ["1", "+01", "0001", "9007199254740991"] {
        let result = shell.exec(&format!("pdfdetach -save {value} missing.pdf")).unwrap();
        assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()),
            (1, "", "I/O Error: Couldn't open file 'missing.pdf'\n"), "{value}");
    }
}
