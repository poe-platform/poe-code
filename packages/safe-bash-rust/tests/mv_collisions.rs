use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn fixture() -> (Shell, MemoryVfs) {
    let fs = MemoryVfs::new();
    fs.write_file("/teamA/report", b"alpha\n").unwrap();
    fs.write_file("/teamB/report", b"beta\n").unwrap();
    fs.mkdir_all("/dest").unwrap();
    let shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            mode: BackendMode::NativeOnly,
        },
    );
    (shell, fs)
}

#[test]
fn mv_rejects_colliding_operands_and_preserves_reports() {
    for options in ["", "-f", "-b", "-t dest"] {
        for existing in [false, true] {
            let (mut shell, fs) = fixture();
            if existing {
                fs.write_file("/dest/report", b"old\n").unwrap();
            }
            let destination = if options == "-t dest" { "" } else { "dest" };
            let result = shell
                .exec(&format!(
                    "mv {options} teamA/report teamB/report {destination}"
                ))
                .unwrap();
            assert_eq!(
                result.exit_code, 1,
                "{options}, existing={existing}: {result:?}"
            );
            assert_eq!(
                result.stderr,
                "mv: will not overwrite just-created 'dest/report' with 'teamB/report'\n"
            );
            assert_eq!(fs.read_file("/dest/report").unwrap(), b"alpha\n");
            assert!(fs.lstat("/teamA/report").is_err());
            assert_eq!(fs.read_file("/teamB/report").unwrap(), b"beta\n");
            if existing && options == "-b" {
                assert_eq!(fs.read_file("/dest/report~").unwrap(), b"old\n");
            }
        }
    }
}

#[test]
fn mv_collision_continues_and_tracking_resets() {
    let (mut shell, fs) = fixture();
    fs.write_file("/teamB/other", b"other").unwrap();
    let result = shell
        .exec("mv -v teamA/report teamB/report teamB/other dest")
        .unwrap();
    assert_eq!(result.exit_code, 1);
    assert_eq!(
        result.stdout,
        "renamed 'teamA/report' -> 'dest/report'\nrenamed 'teamB/other' -> 'dest/other'\n"
    );
    assert_eq!(fs.read_file("/dest/other").unwrap(), b"other");
    let later = shell.exec("mv teamB/report dest").unwrap();
    assert_eq!(later.exit_code, 0, "{later:?}");
    assert_eq!(fs.read_file("/dest/report").unwrap(), b"beta\n");
}

#[test]
fn mv_numbered_backups_preserve_colliding_reports() {
    let (mut shell, fs) = fixture();
    let result = shell
        .exec("mv --backup=numbered teamA/report teamB/report dest")
        .unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(fs.read_file("/dest/report").unwrap(), b"beta\n");
    assert_eq!(fs.read_file("/dest/report.~1~").unwrap(), b"alpha\n");
}

#[test]
fn mv_no_clobber_skips_collision() {
    let (mut shell, fs) = fixture();
    let result = shell.exec("mv -n teamA/report teamB/report dest").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(fs.read_file("/dest/report").unwrap(), b"alpha\n");
    assert_eq!(fs.read_file("/teamB/report").unwrap(), b"beta\n");
}

#[test]
fn mv_interactive_confirmation_cannot_overwrite_just_created_report() {
    let (mut shell, fs) = fixture();
    let result = shell
        .exec("printf 'y\\n' | mv -i teamA/report teamB/report dest")
        .unwrap();
    assert_eq!(result.exit_code, 1, "{result:?}");
    assert_eq!(
        result.stderr,
        "mv: overwrite 'dest/report'? mv: will not overwrite just-created 'dest/report' with 'teamB/report'\n"
    );
    assert_eq!(fs.read_file("/dest/report").unwrap(), b"alpha\n");
    assert_eq!(fs.read_file("/teamB/report").unwrap(), b"beta\n");
}

#[test]
fn mv_failed_or_declined_move_does_not_reserve_destination() {
    for setup in ["rm teamA/report", "printf old > dest/report"] {
        let (mut shell, fs) = fixture();
        assert_eq!(shell.exec(setup).unwrap().exit_code, 0);
        let result = shell
            .exec("printf 'n\\ny\\n' | mv -i teamA/report teamB/report dest")
            .unwrap();
        assert_eq!(result.exit_code, 1, "{result:?}");
        assert!(!result.stderr.contains("just-created"), "{result:?}");
        assert_eq!(fs.read_file("/dest/report").unwrap(), b"beta\n");
    }
}

#[test]
fn mv_cross_device_collision_preserves_second_source() {
    use safe_bash_rust::MountVfs;
    let source = Arc::new(MemoryVfs::new());
    let destination = Arc::new(MemoryVfs::new());
    source.write_file("/teamA/report", b"alpha\n").unwrap();
    source.write_file("/teamB/report", b"beta\n").unwrap();
    let fs = MountVfs::new(source.clone()).with_mount("/dest", destination.clone());
    let mut shell = Shell::new(
        Arc::new(fs),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..ShellOptions::default()
        },
    );
    let result = shell.exec("mv teamA/report teamB/report dest").unwrap();
    assert_eq!(result.exit_code, 1, "{result:?}");
    assert_eq!(destination.read_file("/report").unwrap(), b"alpha\n");
    assert!(!source.exists("/teamA/report"));
    assert_eq!(source.read_file("/teamB/report").unwrap(), b"beta\n");
}
