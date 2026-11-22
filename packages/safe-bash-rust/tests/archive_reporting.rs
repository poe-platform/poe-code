use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn shell(fs: &MemoryVfs) -> Shell {
    Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    )
}

#[test]
fn unzip_reports_only_unmatched_exclusions_without_changing_success_status() {
    let fs = MemoryVfs::new();
    fs.mkdir_all("/dir").unwrap();
    fs.write_file("/dir/Ä.txt", b"a").unwrap();
    let mut sh = shell(&fs);
    assert_eq!(sh.exec("zip -0q seed.zip dir/Ä.txt").unwrap().exit_code, 0);
    for (command, status, stdout, stderr) in [
        (
            "unzip -Z -1 seed.zip -x Ä.txt",
            0,
            "dir/Ä.txt\n",
            "caution: excluded filename not matched:  Ä.txt\n",
        ),
        ("unzip -Z -1 -C seed.zip -x 'DIR/ä.*'", 11, "", ""),
        (
            "unzip -Z -1 seed.zip -x '*' 'dir/*'",
            11,
            "",
            "caution: excluded filename not matched:  dir/*\n",
        ),
        (
            "unzip -Z -1 seed.zip missing -x 'dir/*'",
            11,
            "",
            "caution: filename not matched:  missing\ncaution: excluded filename not matched:  dir/*\n",
        ),
        (
            "unzip -tqq seed.zip -x absent",
            0,
            "caution: excluded filename not matched:  absent\n",
            "",
        ),
        (
            "unzip -oq seed.zip -x absent",
            0,
            "",
            "caution: excluded filename not matched:  absent\n",
        ),
    ] {
        let result = sh.exec(command).unwrap();
        assert_eq!(
            (
                result.exit_code,
                result.stdout.as_str(),
                result.stderr.as_str()
            ),
            (status, stdout, stderr),
            "{command}"
        );
    }
    assert!(
        sh.exec("unzip -l seed.zip -x absent")
            .unwrap()
            .stderr
            .is_empty()
    );
}

#[test]
fn zstd_test_mode_reports_decoded_sizes_and_respects_quiet() {
    let fs = MemoryVfs::new();
    fs.write_file("/plain", b"abc").unwrap();
    fs.write_file("/empty.zst", &[0x28, 0xb5, 0x2f, 0xfd, 0x30, 0, 1, 0, 0])
        .unwrap();
    let mut sh = shell(&fs);
    assert_eq!(sh.exec("zstd -c plain > frame.zst").unwrap().exit_code, 0);
    for (command, stderr) in [
        (
            "unzstd --pass-through -t /empty.zst",
            "/empty.zst          : 0 bytes \n",
        ),
        ("zstd -t frame.zst", "frame.zst           : 3 bytes \n"),
        ("zstd -t < frame.zst", "/*stdin*\\           : 3 bytes \n"),
        (
            "zstd -t frame.zst empty.zst",
            "2 files decompressed :   3 bytes total \n",
        ),
        ("zstd -t -q frame.zst", ""),
        ("zstd -qt frame.zst", ""),
    ] {
        let result = sh.exec(command).unwrap();
        assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
        assert!(result.stdout.is_empty(), "{command}");
        assert_eq!(result.stderr, stderr, "{command}");
    }
    assert_eq!(fs.read_file("/plain").unwrap(), b"abc");
    assert!(fs.exists("/frame.zst") && fs.exists("/empty.zst"));
}
