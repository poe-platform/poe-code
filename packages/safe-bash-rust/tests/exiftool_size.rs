use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn exiftool_file_size_preserves_native_unit_thresholds() {
    let fs = Arc::new(MemoryVfs::new());
    let mut sh = Shell::new(fs.clone(), ShellOptions { mode: BackendMode::NativeOnly, ..Default::default() });
    for (size, display) in [
        (999, "999 bytes"), (1000, "1000 bytes"), (1999, "1999 bytes"),
        (2000, "2.0 kB"), (4023, "4.0 kB"), (9999, "10.0 kB"),
        (10000, "10 kB"), (12345, "12 kB"), (1999999, "2000 kB"),
        (2000000, "2.0 MB"),
    ] {
        fs.write_file("/f", &vec![0; size]).unwrap();
        for (flag, expected) in [("-FileSize", display.to_owned()), ("-FileSize#", size.to_string()), ("-n -FileSize", size.to_string())] {
            let result = sh.exec(&format!("exiftool -s3 {flag} /f")).unwrap();
            assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()), (0, format!("{expected}\n").as_str(), ""), "{size}: {flag}");
        }
    }
}
