use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn native_long_listing_reports_metadata_without_a_typescript_host() {
    let fs = MemoryVfs::new();
    fs.mkdir_all("/work").unwrap();
    fs.write_file("/work/note.txt", b"shared notes").unwrap();
    fs.chmod("/work/note.txt", 0o100640).unwrap();
    fs.symlink("note.txt", "/work/link").unwrap();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/work".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let result = shell
        .exec("printf once >> calls; ls -l note.txt link; printf after")
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert!(!result.used_typescript_bridge);
    assert!(result.stderr.is_empty());
    let file = result
        .stdout
        .lines()
        .find(|line| line.ends_with("note.txt") && line.starts_with('-'))
        .unwrap();
    assert!(file.starts_with("-rw-r----- "), "{file}");
    assert_eq!(file.split_whitespace().nth(4), Some("12"));
    let link = result
        .stdout
        .lines()
        .find(|line| line.starts_with('l'))
        .unwrap();
    assert!(link.ends_with("link -> note.txt"), "{link}");
    assert!(result.stdout.ends_with("\nafter"));
    assert_eq!(fs.read_file("/work/calls").unwrap(), b"once");
    let directory = shell.exec("ls -lad .").unwrap();
    assert_eq!(directory.exit_code, 0, "{}", directory.stderr);
    assert!(directory.stdout.starts_with('d'));
    assert!(!directory.used_typescript_bridge);
    let missing = shell.exec("ls -l missing").unwrap();
    assert_eq!(missing.exit_code, 1);
    assert!(missing.stderr.contains("ENOENT"));
    assert!(!missing.used_typescript_bridge);
}
