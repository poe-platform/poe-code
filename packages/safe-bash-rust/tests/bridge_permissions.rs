use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn typescript_bridge_preserves_modes_and_unreadable_entries() {
    let vfs = MemoryVfs::new();
    vfs.mkdir_all("/work/private").unwrap();
    vfs.write_file("/work/plain.txt", b"plain content").unwrap();
    vfs.write_file("/work/private/locked.txt", b"private content").unwrap();
    vfs.write_file("/work/tool", b"executable content").unwrap();
    vfs.symlink("plain.txt", "/work/link").unwrap();
    vfs.chmod("/work/plain.txt", 0o100640).unwrap();
    vfs.chmod("/work/private/locked.txt", 0o100000).unwrap();
    vfs.chmod("/work/private", 0o40000).unwrap();
    vfs.chmod("/work/tool", 0o100755).unwrap();
    vfs.chmod("/work", 0o40750).unwrap();
    let original = vfs.export_entries().unwrap();
    let mut shell = Shell::new(Arc::new(vfs.clone()), ShellOptions {
        cwd: Some("/work".into()), mode: BackendMode::TypeScriptOnly,
        ..Default::default()
    });
    let result = shell.exec("printf bridge").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "bridge");
    assert_eq!(vfs.export_entries().unwrap(), original);

    let result = shell.exec("chmod 400 plain.txt").unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(vfs.stat("/work/plain.txt").unwrap().mode & 0o7777, 0o400);
    assert_eq!(vfs.read_file("/work/plain.txt").unwrap(), b"plain content");
    assert_eq!(vfs.stat("/work/private").unwrap().mode & 0o7777, 0);
}
