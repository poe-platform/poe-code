use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn readlink_only_reports_operand_errors_in_verbose_mode() {
    let fs = MemoryVfs::new();
    fs.mkdir_all("/locked").unwrap();
    fs.chmod("/locked", 0).unwrap();
    fs.symlink("loop", "/loop").unwrap();
    let mut sh = Shell::new(Arc::new(fs), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    for path in ["/locked/f", "/loop/f", "/missing"] {
        for flag in ["", "-q", "-v -q"] {
            let result = sh.exec(&format!("readlink {flag} {path}")).unwrap();
            assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (1, "", ""), "{flag} {path}");
        }
        let result = sh.exec(&format!("readlink -v {path}")).unwrap();
        assert_eq!(result.exit_code, 1);
        assert!(result.stderr.starts_with("readlink: "), "{path}: {result:?}");
    }
}
