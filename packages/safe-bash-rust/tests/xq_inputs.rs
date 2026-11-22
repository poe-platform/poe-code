use safe_bash_rust::{MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn xq_input_reads_one_document_without_draining_later_operands() {
    let fs = MemoryVfs::new();
    fs.write_file("/xml", b"<r>ok</r>").unwrap();
    let mut sh = Shell::new(Arc::new(fs), ShellOptions::default());
    let result = sh.exec("xq -nc input /xml /missing").unwrap();
    assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (0, "{\"r\":\"ok\"}\n", ""));
}

#[test]
fn xq_reports_missing_file_before_xml_conversion_failure() {
    let fs = MemoryVfs::new();
    fs.write_file("/xml", b"<r>ok</r>").unwrap();
    let mut sh = Shell::new(Arc::new(fs), ShellOptions::default());
    let warning = "jq: error: Could not open file missing: No such file or directory\n";
    for (source, status, output, diagnostic) in [
        ("xq -c . xml missing", 1, "{\"r\":\"ok\"}\n", "jq: Invalid XML: incomplete document\n"),
        ("xq -nc input missing", 2, "", "jq: error (at missing:0): Invalid XML: incomplete document\n"),
        ("xq -nc 'try inputs catch .' missing", 2, "\"Invalid XML: incomplete document\"\n", ""),
        ("xq -nc 7 missing", 1, "7\n", "jq: Invalid XML: incomplete document\n"),
        ("xq -nc 'try input catch halt' missing", 0, "", ""),
    ] {
        let result = sh.exec(source).unwrap();
        assert_eq!(result.exit_code, status, "{source}: {result:?}");
        assert_eq!(result.stdout, output, "{source}");
        assert_eq!(result.stderr, format!("{warning}{diagnostic}"), "{source}");
    }
    let result = sh.exec("xq -nc 'try input catch .' missing 2>&1").unwrap();
    assert_eq!(result.exit_code, 2);
    assert_eq!(result.stdout, format!("{warning}\"Invalid XML: incomplete document\"\n"));
    assert_eq!(result.stderr, "");
}

#[test]
fn xq_reports_open_errors_without_suppressing_the_conversion_failure() {
    let fs = MemoryVfs::new();
    fs.mkdir_all("/directory").unwrap();
    fs.write_file("/locked", b"<r/>").unwrap();
    fs.chmod("/locked", 0).unwrap();
    fs.symlink("loop", "/loop").unwrap();
    let mut sh = Shell::new(Arc::new(fs), ShellOptions::default());
    for (path, description) in [
        ("directory", "Illegal operation on a directory"),
        ("locked", "Permission denied"),
        ("loop", "Too many symbolic links encountered"),
    ] {
        let result = sh.exec(&format!("xq -c . {path}")).unwrap();
        assert_eq!(result.exit_code, 1, "{result:?}");
        assert_eq!(result.stdout, "");
        assert_eq!(result.stderr, format!("jq: error: Could not open file {path}: {description}\njq: Invalid XML: incomplete document\n"));
    }
}
