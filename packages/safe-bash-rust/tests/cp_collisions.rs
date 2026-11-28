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
fn cp_rejects_colliding_operands_and_preserves_all_three_files() {
    for options in ["", "-f", "--remove-destination", "-b", "-t dest"] {
        for existing in [false, true] {
            let (mut shell, fs) = fixture();
            if existing {
                fs.write_file("/dest/report", b"old\n").unwrap();
            }
            let destination = if options == "-t dest" { "" } else { "dest" };
            let result = shell
                .exec(&format!(
                    "cp {options} teamA/report teamB/report {destination}"
                ))
                .unwrap();
            assert_eq!(
                result.exit_code, 1,
                "{options}, existing={existing}: {result:?}"
            );
            assert_eq!(result.stdout, "");
            assert_eq!(
                result.stderr,
                "cp: will not overwrite just-created 'dest/report' with 'teamB/report'\n"
            );
            for (path, contents) in [
                ("/dest/report", b"alpha\n".as_slice()),
                ("/teamA/report", b"alpha\n"),
                ("/teamB/report", b"beta\n"),
            ] {
                assert_eq!(fs.read_file(path).unwrap(), contents, "{path}");
            }
            if existing && options == "-b" {
                assert_eq!(fs.read_file("/dest/report~").unwrap(), b"old\n");
            }
        }
    }
}

#[test]
fn cp_collision_keeps_processing_other_operands_and_resets_on_next_invocation() {
    let (mut shell, fs) = fixture();
    fs.write_file("/teamB/other", b"other\n").unwrap();
    let result = shell
        .exec("cp -v teamA/report teamB/report teamB/other dest")
        .unwrap();
    assert_eq!(result.exit_code, 1);
    assert_eq!(
        result.stdout,
        "'teamA/report' -> 'dest/report'\n'teamB/other' -> 'dest/other'\n"
    );
    assert_eq!(fs.read_file("/dest/other").unwrap(), b"other\n");
    let later = shell.exec("cp teamB/report dest").unwrap();
    assert_eq!(later.exit_code, 0, "{later:?}");
    assert_eq!(fs.read_file("/dest/report").unwrap(), b"beta\n");
}

#[test]
fn cp_no_clobber_skips_colliding_operands() {
    let (mut shell, fs) = fixture();
    let result = shell.exec("cp -n teamA/report teamB/report dest").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stderr, "");
    assert_eq!(fs.read_file("/dest/report").unwrap(), b"alpha\n");
}

#[test]
fn cp_numbered_backups_preserve_each_colliding_copy() {
    let (mut shell, fs) = fixture();
    let result = shell
        .exec("cp --backup=numbered teamA/report teamB/report dest")
        .unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stderr, "");
    assert_eq!(fs.read_file("/dest/report").unwrap(), b"beta\n");
    assert_eq!(fs.read_file("/dest/report.~1~").unwrap(), b"alpha\n");
}

#[test]
fn cp_failed_or_declined_copy_does_not_reserve_destination() {
    for setup in ["chmod 000 teamA/report", "printf old > dest/report"] {
        let (mut shell, fs) = fixture();
        assert_eq!(shell.exec(setup).unwrap().exit_code, 0);
        let result = shell
            .exec("printf 'n\ny\n' | cp -i teamA/report teamB/report dest")
            .unwrap();
        assert_eq!(result.exit_code, 1, "{result:?}");
        assert!(!result.stderr.contains("just-created"), "{result:?}");
        assert_eq!(fs.read_file("/dest/report").unwrap(), b"beta\n");
    }
}

#[test]
fn cp_recursive_operands_still_merge_directories() {
    let (mut shell, fs) = fixture();
    fs.write_file("/teamA/folder/file", b"first").unwrap();
    fs.write_file("/teamB/folder/file", b"second").unwrap();
    let result = shell.exec("cp -R teamA/folder teamB/folder dest").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(result.stderr, "");
    assert_eq!(fs.read_file("/dest/folder/file").unwrap(), b"second");
}

#[test]
fn cp_interactive_confirmation_cannot_overwrite_a_just_created_file() {
    let (mut shell, fs) = fixture();
    let result = shell
        .exec("printf 'y\n' | cp -i teamA/report teamB/report dest")
        .unwrap();
    assert_eq!(result.exit_code, 1, "{result:?}");
    assert_eq!(
        result.stderr,
        "cp: overwrite 'dest/report'? cp: will not overwrite just-created 'dest/report' with 'teamB/report'\n"
    );
    assert_eq!(fs.read_file("/dest/report").unwrap(), b"alpha\n");
}

#[test]
fn cp_repeating_the_same_source_is_not_a_destination_collision() {
    let (mut shell, fs) = fixture();
    let result = shell.exec("cp teamA/report teamA/report dest").unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert_eq!(fs.read_file("/dest/report").unwrap(), b"alpha\n");
}
